/**
 * Travel curves of Chrono's BMW_E90 suspensions (ADR-0026): toe, camber,
 * roll-centre height and the anti-pitch fractions against wheel travel, as
 * a kinematics-and-compliance rig would measure them with the body held
 * level.
 *
 * Roll-centre heights and anti fractions come from the hardpoints, through
 * the front-view solver in `geometry.ts`, whose spindle positions match
 * Chrono's to 0.1 mm. Toe and camber come from Chrono itself, the heave
 * sweep of `chrono/kc.py` (`reference/bmw_e90/kc.csv`): the 3D hardpoint
 * solve below reproduces the rear's (rest toe within 0.01°, bump steer and
 * camber within 0.06°), but gives the front a tenth of the bump steer
 * Chrono's car shows, so it is kept as a cross-check, not a source
 * (docs/validation/chrono-bmw-e90.md).
 *
 * The 3D solve needs the upright's full pose. Each upright is a rigid
 * body placed by its joints (Milliken & Milliken, Race Car Vehicle
 * Dynamics, ch. 17):
 *
 *   - double wishbone: each arm's outer joint stays on the circle about
 *     its chassis axis (two distance constraints per arm), and the toe link
 *     keeps its length;
 *   - MacPherson strut: the lower arm as above, the strut axis (rigid with
 *     the upright, which slides and turns on it) passes through the top
 *     mount, and the tie rod keeps its length, with the rack centred.
 *
 * The spindle height closes the system. It is solved by Gauss-Newton on the
 * upright's rotation vector and translation. Roll-centre heights and the
 * side-view instant centres come from the front-view solver in
 * `geometry.ts` at the same spindle height.
 *
 * Frames follow Chrono: x forward, y left, z up, metres, the left side's
 * suspension frame. Chrono places the hardpoints at the design position,
 * with the spindle at z = 0.
 */
import { DESIGN_ANGLES, DOUBLE_WISHBONE, MACPHERSON, type Point3 } from "./chrono-e90.js";
import { doubleWishboneRollCentre, macphersonRollCentre, type RollCentre } from "./geometry.js";
import { loadKc, type KcRow } from "./reference.js";

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: V) => Math.sqrt(dot(a, a));
const DEG = 180 / Math.PI;

/** Rotate `v` by the rotation vector `r` (Rodrigues). */
function rotate(r: V, v: V): V {
  const th = norm(r);
  if (th < 1e-14) return add(v, cross(r, v));
  const k = scale(r, 1 / th);
  const c = Math.cos(th);
  const s = Math.sin(th);
  return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
}

/** A pose of the upright: rotation vector and spindle displacement from design. */
type Pose = [number, number, number, number, number, number];

function place(q: Pose, spindle: V, p: V): V {
  const r: V = [q[0], q[1], q[2]];
  return add(add(spindle, [q[3], q[4], q[5]]), rotate(r, sub(p, spindle)));
}

/** Least-squares solve of `residuals(q) = 0` from `q0` by Gauss-Newton. */
function solve(residuals: (q: Pose) => number[], q0: Pose): Pose {
  let q = [...q0] as Pose;
  for (let it = 0; it < 50; it++) {
    const r = residuals(q);
    if (Math.max(...r.map(Math.abs)) < 1e-12) break;
    const h = 1e-7;
    const jac = q.map((_, j) => {
      const qp = [...q] as Pose;
      qp[j] = qp[j]! + h;
      return residuals(qp).map((v, i) => (v - r[i]!) / h);
    });
    // Normal equations J^T J dq = -J^T r, 6 × 6.
    const a = q.map((_, i) => q.map((_, j) => jac[i]!.reduce((s, v, k) => s + v * jac[j]![k]!, 0)));
    const b = q.map((_, i) => -jac[i]!.reduce((s, v, k) => s + v * r[k]!, 0));
    const dq = gauss(a, b);
    q = q.map((v, i) => v + dq[i]!) as Pose;
  }
  const worst = Math.max(...residuals(q).map(Math.abs));
  if (!(worst < 1e-9)) throw new Error(`linkage did not close (residual ${worst})`);
  return q;
}

function gauss(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[p]![c]!)) p = r;
    [m[c], m[p]] = [m[p]!, m[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r]![c]! / m[c]![c]!;
      for (let k = c; k <= n; k++) m[r]![k]! -= f * m[c]![k]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

/** Distance of `p` from `a` minus its design distance, for a joint on a link of fixed length. */
const link = (p: V, a: V, design: V) => norm(sub(p, a)) - norm(sub(design, a));

export interface WheelAngles {
  /** Toe-in, degrees: the wheel's front pointing toward the centreline. */
  toeDeg: number;
  /** Camber relative to the body, degrees, negative top-in. */
  camberDeg: number;
}

/** Spindle angles from the upright's pose and the design spindle orientation. */
function angles(q: Pose, design: { camberDeg: number; toeDeg: number }): WheelAngles {
  // Chrono's left spindle: Rz(−toe) · Rx(−camber), so its axis tilts up
  // outboard for negative camber and its front turns inboard for toe-in.
  const r: V = [q[0], q[1], q[2]];
  const spin = (v: V) =>
    rotate([0, 0, -design.toeDeg / DEG], rotate([-design.camberDeg / DEG, 0, 0], v));
  const axis = rotate(r, spin([0, 1, 0]));
  const fwd = rotate(r, spin([1, 0, 0]));
  return {
    toeDeg: -Math.atan2(fwd[1], fwd[0]) * DEG,
    camberDeg: -Math.asin(axis[2]) * DEG,
  };
}

/** The MacPherson strut's upright pose with the spindle at height `spindleZ`. */
export function macphersonPose(spindleZ: number, q0: Pose = [0, 0, 0, 0, 0, 0]): Pose {
  const h = MACPHERSON;
  const s = h.spindle as V;
  const top = h.strutChassis as V;
  const axis0 = sub(top, h.strutUpright as V);
  const unit0 = scale(axis0, 1 / norm(axis0));
  return solve((q) => {
    const lca = place(q, s, h.lcaUpright as V);
    const strut = place(q, s, h.strutUpright as V);
    const dir = rotate([q[0], q[1], q[2]], unit0);
    const w = sub(top, strut);
    const off = sub(w, scale(dir, dot(w, dir)));
    const tie = place(q, s, h.tierodUpright as V);
    return [
      link(lca, h.lcaFront as V, h.lcaUpright as V),
      link(lca, h.lcaBack as V, h.lcaUpright as V),
      ...off,
      link(tie, h.tierodChassis as V, h.tierodUpright as V),
      s[2] + q[5] - spindleZ,
    ];
  }, q0);
}

/** The double wishbone's upright pose with the spindle at height `spindleZ`. */
export function doubleWishbonePose(spindleZ: number, q0: Pose = [0, 0, 0, 0, 0, 0]): Pose {
  const h = DOUBLE_WISHBONE;
  const s = h.spindle as V;
  return solve((q) => {
    const lca = place(q, s, h.lcaUpright as V);
    const uca = place(q, s, h.ucaUpright as V);
    const tie = place(q, s, h.tierodUpright as V);
    return [
      link(lca, h.lcaFront as V, h.lcaUpright as V),
      link(lca, h.lcaBack as V, h.lcaUpright as V),
      link(uca, h.ucaFront as V, h.ucaUpright as V),
      link(uca, h.ucaBack as V, h.ucaUpright as V),
      link(tie, h.tierodChassis as V, h.tierodUpright as V),
      s[2] + q[5] - spindleZ,
    ];
  }, q0);
}

export type Axle = "front" | "rear";

/** Toe and camber of an axle's left wheel with its spindle at `spindleZ`. */
export function wheelAngles(axle: Axle, spindleZ: number): WheelAngles {
  return sweepAngles(axle, [spindleZ])[0]!;
}

/** Toe and camber at each spindle height, continuing each solve from the last. */
function sweepAngles(axle: Axle, heights: number[]): WheelAngles[] {
  const pose = axle === "front" ? macphersonPose : doubleWishbonePose;
  const design = DESIGN_ANGLES[axle];
  // March out from the design position so every solve starts close.
  const order = heights.map((z, i) => ({ z, i })).sort((a, b) => Math.abs(a.z) - Math.abs(b.z));
  const out: WheelAngles[] = new Array(heights.length);
  const last = { up: [0, 0, 0, 0, 0, 0] as Pose, down: [0, 0, 0, 0, 0, 0] as Pose };
  for (const { z, i } of order) {
    const key = z >= 0 ? "up" : "down";
    const q = pose(z, last[key]);
    last[key] = q;
    out[i] = angles(q, design);
  }
  return out;
}

export type Curve = Array<[number, number]>;

export interface TravelCurves {
  toeDeg: Curve;
  camberDeg: Curve;
  rollCenterHeight: Curve;
  /** Side-view anti fraction with the instant centre at each travel; front: anti-dive. */
  anti: Curve;
  /** The values at zero travel (Chrono's rest) that the curves are offsets from. */
  atRest: { toeDeg: number; camberDeg: number; rollCenterHeight: number; anti: number };
}

/**
 * Toe and camber of an axle at each travel (m, + bump) from Chrono's heave
 * sweep: the pass from the chassis raised 6 cm down to 10 cm below rest,
 * each wheel interpolated at the travel and the two wheels averaged.
 * Travel beyond the sweep holds its end values.
 */
export function measuredAngles(
  axle: Axle,
  travels: number[],
  kc: KcRow[] = loadKc(),
): WheelAngles[] {
  const rest = kc.find((r) => r.phase === "rest")!;
  const heave = kc.filter((r) => r.phase === "heave");
  const top = heave.reduce((best, r, i) => (r.heave > heave[best]!.heave ? i : best), 0);
  const pass = heave.slice(top).filter((r, i, a) => i === 0 || r.heave < a[i - 1]!.heave);
  const wheels = axle === "front" ? [0, 1] : [2, 3];
  const at = (w: number, key: "toe" | "camber", travel: number) => {
    const pts = pass.map((r) => [r.z[w]! - rest.z[w]!, r[key][w]!] as [number, number]);
    pts.sort((p, q) => p[0] - q[0]);
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    if (travel <= first[0]) return first[1];
    if (travel >= last[0]) return last[1];
    const k = pts.findIndex((p) => p[0] >= travel);
    const [x0, y0] = pts[k - 1]!;
    const [x1, y1] = pts[k]!;
    return y0 + ((y1 - y0) * (travel - x0)) / (x1 - x0);
  };
  const mean = (key: "toe" | "camber", travel: number) =>
    wheels.reduce((s, w) => s + at(w, key, travel), 0) / wheels.length;
  return travels.map((t) => ({ toeDeg: mean("toe", t), camberDeg: mean("camber", t) }));
}

/**
 * The travel curves of one axle, as offsets from their values at `restZ`
 * (the spindle height Chrono settles at), sampled at `travels` (m, + bump,
 * including zero). `loadedRadius` places the contact patch; `wheelbase`
 * and `cgHeight` turn the side-view instant centre into an anti fraction
 * (ADR-0018).
 */
export function travelCurves(
  axle: Axle,
  restZ: number,
  travels: number[],
  loadedRadius: number,
  wheelbase: number,
  cgHeight: number,
): TravelCurves {
  if (!travels.includes(0)) throw new Error("travels must include zero");
  const heights = travels.map((z) => restZ + z);
  const ang = measuredAngles(axle, travels);
  const rc = heights.map((z): RollCentre =>
    axle === "front"
      ? macphersonRollCentre(z, loadedRadius)
      : doubleWishboneRollCentre(z, loadedRadius),
  );
  const anti = rc.map((r) => antiFraction(axle, r, wheelbase, cgHeight));
  const zero = travels.indexOf(0);
  // Rounded to keep the definition readable; the zero point stays exact.
  const round = (v: number, k: number) => Math.round(v * 10 ** k) / 10 ** k;
  const offset = (v: number[], k: number): Curve =>
    travels.map((z, i) => [z, i === zero ? 0 : round(v[i]! - v[zero]!, k)]);
  return {
    toeDeg: offset(
      ang.map((a) => a.toeDeg),
      4,
    ),
    camberDeg: offset(
      ang.map((a) => a.camberDeg),
      4,
    ),
    rollCenterHeight: offset(
      rc.map((r) => r.height),
      5,
    ),
    anti: offset(anti, 4),
    atRest: {
      toeDeg: ang[zero]!.toeDeg,
      camberDeg: ang[zero]!.camberDeg,
      rollCenterHeight: rc[zero]!.height,
      anti: anti[zero]!,
    },
  };
}

/**
 * Anti fraction from the side-view instant centre, from the wheel centre
 * (Chrono reacts brake torque on the chassis and drives through half-shafts):
 * at the front anti-dive needs the centre behind and above, at the rear
 * anti-lift and anti-squat need it ahead and above.
 */
export function antiFraction(axle: Axle, r: RollCentre, wheelbase: number, cgHeight: number) {
  const [x, z] = r.sideView;
  return ((axle === "front" ? z / -x : z / x) * wheelbase) / cgHeight;
}

export type { Point3 };
