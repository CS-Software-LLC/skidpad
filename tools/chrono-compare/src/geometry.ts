/**
 * Roll-centre heights of Chrono's BMW_E90 suspensions from their hardpoints,
 * by the front-view instant-centre construction (Milliken & Milliken, Race
 * Car Vehicle Dynamics, ch. 17; Gillespie, Fundamentals of Vehicle Dynamics,
 * ch. 7):
 *
 *   - MacPherson strut: the instant centre is where the lower arm's line
 *     meets the line through the strut's top mount perpendicular to the
 *     strut;
 *   - double wishbone: where the two arms' lines meet;
 *   - the roll centre is where the line from the contact patch through the
 *     instant centre crosses the vehicle centreline.
 *
 * The same linkages give the side-view instant centres, from which the
 * anti-dive, anti-lift and anti-squat fractions follow (ADR-0018).
 *
 * Each arm pivots about the axis through its two chassis joints; in front
 * view that axis is taken where it pierces the transverse plane of the arm's
 * outer joint. The hardpoints are quoted at Chrono's design position, and the
 * car settles below its design load, so each linkage is first solved for the
 * spindle height Chrono reports at rest (`reference/bmw_e90/static.json`).
 *
 * Front-view coordinates: [y left, z up], metres, suspension frame.
 */
import { DOUBLE_WISHBONE, MACPHERSON, type Point3 } from "./chrono-e90.js";

type P2 = [number, number];

const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: P2, b: P2): P2 => [a[0] + b[0], a[1] + b[1]];
const rot = (v: P2, t: number): P2 => [
  v[0] * Math.cos(t) - v[1] * Math.sin(t),
  v[0] * Math.sin(t) + v[1] * Math.cos(t),
];
const cross = (a: P2, b: P2) => a[0] * b[1] - a[1] * b[0];
const front = (p: Point3): P2 => [p[1], p[2]];

/** Front-view pivot of an arm: its chassis axis at the x of the outer joint. */
function pivot(a: Point3, b: Point3, outer: Point3): P2 {
  const t = (outer[0] - a[0]) / (b[0] - a[0]);
  return [a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
}

/** Intersection of the line through p with direction u and the one through q with direction v. */
function intersect(p: P2, u: P2, q: P2, v: P2): P2 {
  const s = cross(sub(q, p), v) / cross(u, v);
  return add(p, [u[0] * s, u[1] * s]);
}

/** Root of a monotone-enough function on [lo, hi] by bisection. */
function bisect(f: (x: number) => number, lo: number, hi: number): number {
  let flo = f(lo);
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    const fm = f(mid);
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
  return 0.5 * (lo + hi);
}

export interface RollCentre {
  /** Roll-centre height above the ground, m. */
  height: number;
  /** Spindle lateral position at the solved pose, m (a check against static.json). */
  spindleY: number;
  /** Instant centre, [y, z] in the suspension frame, m. */
  instantCentre: P2;
  /**
   * Side-view instant centre relative to the wheel centre, [x forward,
   * z up], m: the outer joints at the solved pose, each moving
   * perpendicular to its arm's pivot axis (and the strut sliding through its
   * top mount), give the lines it lies on (Milliken & Milliken, ch. 17).
   */
  sideView: P2;
}

/** MacPherson strut at the spindle height `spindleZ`, loaded tire radius `r`. */
export function macphersonRollCentre(spindleZ: number, r: number): RollCentre {
  const h = MACPHERSON;
  const p = pivot(h.lcaFront, h.lcaBack, h.lcaUpright);
  const a0 = front(h.lcaUpright);
  const u0 = front(h.strutUpright);
  const s0 = front(h.spindle);
  const c = front(h.strutChassis);
  const d0 = sub(c, u0);
  // For a lower-arm angle, the upright rotation that keeps the top mount on
  // the strut axis (the strut is rigid with the upright).
  const pose = (theta: number) => {
    const a = add(p, rot(sub(a0, p), theta));
    const phi = bisect((f) => cross(rot(d0, f), sub(c, add(a, rot(sub(u0, a0), f)))), -0.5, 0.5);
    return { a, phi, s: add(a, rot(sub(s0, a0), phi)) };
  };
  const theta = bisect((t) => pose(t).s[1] - spindleZ, -0.5, 0.5);
  const { a, phi, s } = pose(theta);
  const axis = rot(d0, phi);
  const ic = intersect(p, sub(a, p), c, [-axis[1], axis[0]]);
  // Side view: the lower joint moves perpendicular to the arm's pivot axis,
  // so the instant centre lies on the line through it parallel to the axis;
  // the upright slides along the strut through the top mount, so it also
  // lies on the perpendicular to the strut there.
  const u = add(a, rot(sub(u0, a0), phi));
  const joint: P2 = [h.lcaUpright[0], a[1]];
  const top: P2 = [h.strutChassis[0], h.strutChassis[2]];
  const strut = sub(top, [h.strutUpright[0], u[1]]);
  const side = intersect(joint, sideAxis(h.lcaFront, h.lcaBack), top, [-strut[1], strut[0]]);
  return { ...rollCentreFrom(ic, s, r), sideView: [side[0] - h.spindle[0], side[1] - s[1]] };
}

/** Double wishbone at the spindle height `spindleZ`, loaded tire radius `r`. */
export function doubleWishboneRollCentre(spindleZ: number, r: number): RollCentre {
  const h = DOUBLE_WISHBONE;
  const pu = pivot(h.ucaFront, h.ucaBack, h.ucaUpright);
  const pl = pivot(h.lcaFront, h.lcaBack, h.lcaUpright);
  const au0 = front(h.ucaUpright);
  const al0 = front(h.lcaUpright);
  const s0 = front(h.spindle);
  const ru = Math.hypot(...sub(au0, pu));
  const pose = (theta: number) => {
    const al = add(pl, rot(sub(al0, pl), theta));
    const phi = bisect(
      (f) => Math.hypot(...sub(add(al, rot(sub(au0, al0), f)), pu)) - ru,
      -0.3,
      0.3,
    );
    return {
      al,
      au: add(al, rot(sub(au0, al0), phi)),
      s: add(al, rot(sub(s0, al0), phi)),
    };
  };
  const theta = bisect((t) => pose(t).s[1] - spindleZ, -0.5, 0.5);
  const { al, au, s } = pose(theta);
  const ic = intersect(pu, sub(au, pu), pl, sub(al, pl));
  // Side view: each outer joint moves perpendicular to its arm's pivot axis.
  const side = intersect(
    [h.ucaUpright[0], au[1]],
    sideAxis(h.ucaFront, h.ucaBack),
    [h.lcaUpright[0], al[1]],
    sideAxis(h.lcaFront, h.lcaBack),
  );
  return { ...rollCentreFrom(ic, s, r), sideView: [side[0] - h.spindle[0], side[1] - s[1]] };
}

/** Direction of an arm's pivot axis in side view, [x, z]. */
function sideAxis(a: Point3, b: Point3): P2 {
  return [a[0] - b[0], a[2] - b[2]];
}

function rollCentreFrom(ic: P2, spindle: P2, r: number): Omit<RollCentre, "sideView"> {
  const contact: P2 = [spindle[0], spindle[1] - r];
  const z = contact[1] + ((ic[1] - contact[1]) * (0 - contact[0])) / (ic[0] - contact[0]);
  return { height: z - contact[1], spindleY: spindle[0], instantCentre: ic };
}
