/**
 * Isolates the effect of Chrono's static toe on the step and sine steer, which
 * Skidpad cannot represent: a minimal planar four-wheel model (lateral
 * velocity, yaw rate, roll) with Chrono's TMsimple tires, run with and
 * without the toe Chrono measures at rest. Everything else is held equal,
 * so the difference between the two runs is the toe's effect alone.
 *
 *   pnpm toe-check
 *
 * Model: constant forward speed; each wheel's slip angle from its own
 * velocity and road-wheel angle (steer ± toe); lateral force from the
 * TMsimple curve at its load; load transfer per axle split into the
 * geometric part (roll centre, instantaneous) and the elastic part (roll
 * angle times that axle's share of roll stiffness); roll as a damped
 * second-order mode. Parameters are the derived ones used for the Skidpad
 * model (`vehicle.ts`), the roll stiffness from Chrono's roll gradient.
 */
import { pathToFileURL } from "node:url";
import { TIRE_FRONT, TIRE_REAR } from "./chrono-e90.js";
import { loadReference, at } from "./run.js";
import { tmForce } from "./tire-fit.js";
import { derive, loadStatic } from "./vehicle.js";

const G = 9.81;

export interface ToeRun {
  /** Step steer: yaw rate 90 % response time from 50 % of the steer input, s. */
  responseTime: number;
  /** Step steer: yaw rate overshoot, %. */
  overshoot: number;
  steadyYawRate: number;
  bodySlipDeg: number;
  /** Sine steer: delay of the first yaw rate peak behind the road-wheel angle's, ms. */
  sineLag: number;
}

export function run(toe: { front: number; rear: number }): ToeRun {
  const step = simulate("stepSteer", 22.2, 8, toe);
  const sine = simulate("sineSteer", 22.2, 4, toe);
  const w = sine.yaw.filter((p) => p.t >= 2 && p.t <= 3.4);
  const yawPeak = w.reduce((a, b2) => (Math.abs(b2.r) > Math.abs(a.r) ? b2 : a)).t;
  const steerPeak = w.reduce((a, b2) => (Math.abs(b2.delta) > Math.abs(a.delta) ? b2 : a)).t;
  const steady = step.yaw.filter((p) => p.t >= 6);
  const ss = steady.reduce((s2, p) => s2 + p.r, 0) / steady.length;
  const t90 = step.yaw.find((p) => p.t > 2 && Math.abs(p.r) >= 0.9 * Math.abs(ss))?.t ?? NaN;
  const peak = Math.max(...step.yaw.map((p) => Math.abs(p.r)));
  return {
    responseTime: t90 - 2.1,
    overshoot: 100 * (peak / Math.abs(ss) - 1),
    steadyYawRate: (Math.abs(ss) * 180) / Math.PI,
    bodySlipDeg: step.slipDeg,
    sineLag: 1000 * (yawPeak - steerPeak),
  };
}

function simulate(
  name: string,
  v: number,
  duration: number,
  toe: { front: number; rear: number },
): { yaw: { t: number; r: number; delta: number }[]; slipDeg: number } {
  const d = derive();
  const s = loadStatic();
  const m = s.mass;
  const iz = s.inertia[2][2];
  const ix = s.inertia[0][0];
  const a = d.cgToFrontAxle;
  const b = d.wheelbase - a;
  const tw = d.trackWidth;
  const h = d.cgHeight;
  // Roll stiffness from Chrono's roll gradient (3.76 deg/g, `pnpm compare`),
  // split by its front share of the elastic load transfer.
  const rollGradient = (3.76 * Math.PI) / 180 / G;
  const hRoll = h - (d.rollCentre.front * b + d.rollCentre.rear * a) / d.wheelbase;
  const kRoll = (m * hRoll) / rollGradient;
  const frontShare = 0.554;
  const cRoll = 2 * 0.4 * Math.sqrt(kRoll * ix);
  const ref = loadReference(name);
  const dt = 1e-4;
  let vy = 0;
  let r = 0;
  let phi = 0;
  let phiDot = 0;
  const yaw: { t: number; r: number; delta: number }[] = [];
  let slip = 0;
  for (let k = 0; k * dt < duration; k++) {
    const t = k * dt;
    const delta = 0.5 * (at(ref, t, "delta0") + at(ref, t, "delta1"));
    const ay = v * r; // quasi-steady lateral acceleration for the geometric transfer
    const geoF = (m * ay * (b / d.wheelbase) * d.rollCentre.front) / tw;
    const geoR = (m * ay * (a / d.wheelbase) * d.rollCentre.rear) / tw;
    const elF = (frontShare * kRoll * phi) / tw;
    const elR = ((1 - frontShare) * kRoll * phi) / tw;
    // + ay (left) loads the right wheels; roll + (left side up) does too.
    const fz = [
      d.frontLoad - geoF - elF,
      d.frontLoad + geoF + elF,
      d.rearLoad - geoR - elR,
      d.rearLoad + geoR + elR,
    ];
    // Positions (x fwd, y left) and road-wheel angles (+ left); toe-in
    // points each wheel toward the centreline.
    const wheels = [
      { x: a, y: tw / 2, steer: delta - toe.front, tire: TIRE_FRONT },
      { x: a, y: -tw / 2, steer: delta + toe.front, tire: TIRE_FRONT },
      { x: -b, y: tw / 2, steer: -toe.rear, tire: TIRE_REAR },
      { x: -b, y: -tw / 2, steer: toe.rear, tire: TIRE_REAR },
    ];
    let fyTotal = 0;
    let mz = 0;
    wheels.forEach((w, i) => {
      const wx = v - r * w.y;
      const wy = vy + r * w.x;
      const alpha = Math.atan2(wy, wx) - w.steer;
      const mag = tmForce(w.tire, Math.max(fz[i]!, 0), Math.abs(Math.tan(alpha)), "y");
      const fyWheel = -Math.sign(alpha) * mag;
      // Into the body frame.
      const fx = -fyWheel * Math.sin(w.steer);
      const fy = fyWheel * Math.cos(w.steer);
      fyTotal += fy;
      mz += w.x * fy - w.y * fx;
    });
    const vyDot = fyTotal / m - v * r;
    const rDot = mz / iz;
    // Lateral acceleration + (left) rolls the body right side down: + roll is left side up.
    const phiDDot = (m * (vyDot + v * r) * hRoll - kRoll * phi - cRoll * phiDot) / ix;
    vy += vyDot * dt;
    r += rDot * dt;
    phiDot += phiDDot * dt;
    phi += phiDot * dt;
    slip = Math.atan2(vy, v);
    if (k % 100 === 0) yaw.push({ t, r, delta });
  }
  return { yaw, slipDeg: (slip * 180) / Math.PI };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const s = loadStatic();
  const toe = { front: (s.toe[1] - s.toe[0]) / 2, rear: (s.toe[3] - s.toe[2]) / 2 };
  const fmt = (x: ToeRun) =>
    `step: response ${x.responseTime.toFixed(3)} s, overshoot ${x.overshoot.toFixed(1)} %, steady yaw ${x.steadyYawRate.toFixed(2)} deg/s, body slip ${x.bodySlipDeg.toFixed(2)} deg; sine: yaw lag ${x.sineLag.toFixed(0)} ms`;
  console.log(`no toe:      ${fmt(run({ front: 0, rear: 0 }))}`);
  console.log(`Chrono toe:  ${fmt(run(toe))}`);
}
