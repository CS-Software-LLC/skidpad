/**
 * Record a lap of the sandbox track as an input trace, once, offline.
 *
 *   pnpm --filter @skidpad/determinism-tests run record:lap [presetId ...]
 *
 * A pure-pursuit driver with a curvature-limited speed profile drives the
 * preset round the sandbox loop (the same control points the sandbox draws),
 * then brakes to a stop and pulls the handbrake. The inputs it produced are
 * written to `data/lap-<preset>.json`, quantised to thousandths, and the
 * determinism scenario replays them open-loop in every engine. Recording may
 * use any maths it likes (this file uses `Math.*` freely): only the replay
 * has to be bit-exact, and a replay is plain arithmetic on stored integers.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { init } from "@skidpad/core";
import { preset, presetIds, type PresetId } from "@skidpad/presets";
import { TRACK_POINTS, TRACK_WIDTH } from "../../../apps/sandbox/src/track.js";
import { LAP_RATE, LAP_QUANTUM, type LapTrace } from "./lap-format.js";

// --- the centreline in core coordinates --------------------------------------
// three.js (x, y up, z) → core ISO (x, y left, z up): (x, z) → (x, −z).
const control = TRACK_POINTS.map((p) => [p.x, -p.z] as const);

/** Centripetal Catmull-Rom through the closed control polygon, as three.js draws it. */
function centreline(samples: number): { x: number; y: number }[] {
  const n = control.length;
  const out: { x: number; y: number }[] = [];
  const pt = (i: number) => control[(i + n) % n]!;
  const perSegment = Math.ceil(samples / n);
  for (let seg = 0; seg < n; seg++) {
    const p0 = pt(seg - 1);
    const p1 = pt(seg);
    const p2 = pt(seg + 1);
    const p3 = pt(seg + 2);
    const d = (a: readonly [number, number], b: readonly [number, number]) =>
      Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])); // centripetal: alpha = 0.5
    let dt0 = d(p0, p1);
    let dt1 = d(p1, p2);
    let dt2 = d(p2, p3);
    if (dt1 < 1e-4) dt1 = 1;
    if (dt0 < 1e-4) dt0 = dt1;
    if (dt2 < 1e-4) dt2 = dt1;
    const coeffs = (x0: number, x1: number, x2: number, x3: number) => {
      let t1 = (x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1;
      let t2 = (x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2;
      t1 *= dt1;
      t2 *= dt1;
      return {
        c0: x1,
        c1: t1,
        c2: -3 * x1 + 3 * x2 - 2 * t1 - t2,
        c3: 2 * x1 - 2 * x2 + t1 + t2,
      };
    };
    const cx = coeffs(p0[0], p1[0], p2[0], p3[0]);
    const cy = coeffs(p0[1], p1[1], p2[1], p3[1]);
    for (let k = 0; k < perSegment; k++) {
      const t = k / perSegment;
      const ev = (c: typeof cx) => c.c0 + c.c1 * t + c.c2 * t * t + c.c3 * t * t * t;
      out.push({ x: ev(cx), y: ev(cy) });
    }
  }
  return out;
}

const path = centreline(4000);
const N = path.length;
const ds: number[] = [];
let trackLength = 0;
for (let i = 0; i < N; i++) {
  const a = path[i]!;
  const b = path[(i + 1) % N]!;
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  ds.push(l);
  trackLength += l;
}
/** Signed curvature at each sample from the neighbouring points. */
const curvature: number[] = [];
for (let i = 0; i < N; i++) {
  const a = path[(i - 1 + N) % N]!;
  const b = path[i]!;
  const c = path[(i + 1) % N]!;
  const ax = b.x - a.x;
  const ay = b.y - a.y;
  const bx = c.x - b.x;
  const by = c.y - b.y;
  const cross = ax * by - ay * bx;
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  const lc = Math.hypot(c.x - a.x, c.y - a.y);
  curvature.push(la * lb * lc > 0 ? (2 * cross) / (la * lb * lc) : 0);
}

function nearestIndex(x: number, y: number, hint: number): number {
  // Search a window around the previous match, then widen if needed.
  let best = hint;
  let bestD = Infinity;
  const window = 400;
  for (let k = -window; k <= window; k++) {
    const i = (hint + k + N) % N;
    const d = Math.hypot(path[i]!.x - x, path[i]!.y - y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function advance(i: number, distance: number): number {
  let j = i;
  let acc = 0;
  while (acc < distance) {
    acc += ds[j]!;
    j = (j + 1) % N;
  }
  return j;
}

// --- the driver ---------------------------------------------------------------
interface DriverParams {
  /** Lateral acceleration budget for the speed profile, m/s². */
  latAccel: number;
  /** Braking deceleration the speed profile plans with, m/s². */
  brakeDecel: number;
  /** Top speed, m/s. */
  topSpeed: number;
}

function speedProfile(p: DriverParams): number[] {
  const v = curvature.map((k) =>
    Math.min(p.topSpeed, Math.sqrt(p.latAccel / Math.max(Math.abs(k), 1e-6))),
  );
  // Backward pass around the loop twice so the wrap-around is consistent.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const next = v[(i + 1) % N]!;
      v[i] = Math.min(v[i]!, Math.sqrt(next * next + 2 * p.brakeDecel * ds[i]!));
    }
  }
  return v;
}

async function record(id: PresetId): Promise<LapTrace> {
  const sp = await init();
  const def = sp.completeDefinition(preset(id));
  const maxAngle = (def.steering.maxWheelAngleDeg * Math.PI) / 180;
  const wheelbase = def.chassis.wheelbase;
  const params: DriverParams = { latAccel: 5.5, brakeDecel: 5.0, topSpeed: 32 };
  const profile = speedProfile(params);

  const w = sp.createWorld(1);
  const car = w.addVehicle(def);
  const steer: number[] = [];
  const throttle: number[] = [];
  const brake: number[] = [];
  const handbrake: number[] = [];
  const q = (v: number) =>
    Math.max(-LAP_QUANTUM, Math.min(LAP_QUANTUM, Math.round(v * LAP_QUANTUM)));

  let idx = nearestIndex(0, 0, 0);
  let progress = 0; // metres of track covered
  let lastIdx = idx;
  let maxOffTrack = 0;
  let prevSteer = 0;
  let lapDone = false;
  let stopSteps = 0;
  const dt = 1 / LAP_RATE;
  const maxSteps = 200 * LAP_RATE;
  for (let k = 0; k < maxSteps; k++) {
    const x = w.read(car, "PosX");
    const y = w.read(car, "PosY");
    const yaw = w.read(car, "Yaw");
    const speed = w.read(car, "VelX");
    idx = nearestIndex(x, y, idx);
    const near = path[idx]!;
    maxOffTrack = Math.max(maxOffTrack, Math.hypot(near.x - x, near.y - y));
    // Progress along the loop (forward only; the window search cannot jump back far).
    let delta = idx - lastIdx;
    if (delta < -N / 2) delta += N;
    if (delta > 0) for (let j = 0; j < delta; j++) progress += ds[(lastIdx + j) % N]!;
    lastIdx = idx;

    let s = 0;
    let t = 0;
    let b = 0;
    let hb = 0;
    if (!lapDone && progress >= trackLength) lapDone = true;
    if (!lapDone) {
      // Pure pursuit on a speed-scaled lookahead.
      const lookahead = Math.min(25, Math.max(6, 0.7 * speed + 3));
      const target = path[advance(idx, lookahead)]!;
      const alpha = Math.atan2(target.y - y, target.x - x) - yaw;
      const a = Math.atan2(Math.sin(alpha), Math.cos(alpha));
      const kappa = (2 * Math.sin(a)) / lookahead;
      const delta = Math.atan(wheelbase * kappa) * 1.15; // a little understeer compensation
      // Positive steer input turns right (negative yaw), see the core's convention.
      let si = Math.max(-1, Math.min(1, -delta / maxAngle));
      // A hand can move the wheel only so fast.
      const rate = 3.0 * dt;
      si = Math.max(prevSteer - rate, Math.min(prevSteer + rate, si));
      s = si;
      // Speed from the profile a little ahead, P control with the negative half braking.
      const vTarget = profile[advance(idx, Math.max(2, 0.3 * speed))]!;
      const pedal = 0.5 * (vTarget - speed);
      t = Math.max(0, Math.min(1, pedal));
      b = Math.max(0, Math.min(1, -pedal));
      // A driver's throttle discipline: ease off with steering lock, lift
      // when the driven wheels spin up, and never floor it from a crawl in
      // a corner.
      const slip = Math.max(
        Math.abs(w.read(car, "SlipRatio_F")),
        Math.abs(w.read(car, "SlipRatio_R")),
      );
      t *= Math.max(0.15, 1 - 0.7 * Math.abs(s));
      t *= Math.max(0.1, Math.min(1, 1 - (slip - 0.08) / 0.12));
      if (speed < 0) {
        // Going backwards: brake, straighten up.
        t = 0;
        b = 1;
      }
    } else {
      // Lap done: a firm but unlocked brake to a stop on the straight, then
      // hold the handbrake for two seconds.
      const sp = Math.abs(speed);
      b = sp > 0.3 ? 0.45 : 0;
      hb = sp <= 0.3 ? 1 : 0;
      if (sp <= 0.3) stopSteps++;
      s = prevSteer * 0.9;
    }
    prevSteer = s;
    const frame = { steer: q(s), throttle: q(t), brake: q(b), handbrake: q(hb) };
    steer.push(frame.steer);
    throttle.push(frame.throttle);
    brake.push(frame.brake);
    handbrake.push(frame.handbrake);
    w.setInput(car, {
      steer: frame.steer / LAP_QUANTUM,
      throttle: frame.throttle / LAP_QUANTUM,
      brake: frame.brake / LAP_QUANTUM,
      handbrake: frame.handbrake / LAP_QUANTUM,
    });
    w.step(dt);
    if (process.env.LAP_DEBUG && k % LAP_RATE === 0) {
      console.error(
        `${id} t=${(k / LAP_RATE).toFixed(0)} x=${x.toFixed(1)} y=${y.toFixed(1)} v=${speed.toFixed(1)} off=${Math.hypot(near.x - x, near.y - y).toFixed(2)} steer=${s.toFixed(2)} thr=${t.toFixed(2)} brk=${b.toFixed(2)} progress=${progress.toFixed(0)}/${trackLength.toFixed(0)} slipR=${w.read(car, "SlipRatio_R").toFixed(2)} yawRate=${w.read(car, "YawRate").toFixed(2)}`,
      );
    }
    if (lapDone && stopSteps >= 2 * LAP_RATE) break;
  }
  const lapTime = steer.length / LAP_RATE;
  const finalHash = w.stateHash(car);
  w.free();
  console.log(
    `${id}: ${lapDone ? "lap complete" : "LAP NOT COMPLETED"}, ${lapTime.toFixed(1)} s of inputs, ` +
      `worst centreline offset ${maxOffTrack.toFixed(2)} m (track half-width ${(TRACK_WIDTH / 2).toFixed(1)} m), hash ${finalHash}`,
  );
  if (!lapDone) throw new Error(`${id}: the driver did not complete the lap`);
  if (maxOffTrack > TRACK_WIDTH / 2 + 1) throw new Error(`${id}: the driver left the track`);
  return {
    preset: id,
    rate: LAP_RATE,
    quantum: LAP_QUANTUM,
    trackLength: Math.round(trackLength * 100) / 100,
    steps: steer.length,
    steer,
    throttle,
    brake,
    handbrake,
  };
}

const ids = (process.argv.slice(2) as PresetId[]).filter((id) => presetIds.includes(id));
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
mkdirSync(outDir, { recursive: true });
for (const id of ids.length ? ids : presetIds) {
  const trace = await record(id);
  writeFileSync(join(outDir, `lap-${id}.json`), JSON.stringify(trace));
}
