/**
 * Suspension geometry of Project Chrono's Sedan from its kinematics sweep
 * (`chrono/kc.py sedan`, `reference/sedan/kc.csv`): the parked car's chassis
 * held and moved slowly in heave, each spindle's position, toe, camber and
 * spring and damper lengths logged against its travel.
 *
 * The E90's roll centres and anti fractions come from front-view and
 * side-view instant-centre constructions on its hardpoints
 * (`geometry.ts`). The Sedan's rear is a five-link multi-link, which has no
 * such two-arm construction, so both axles are measured here instead, by
 * the kinematic definitions those constructions implement (Milliken &
 * Milliken, Race Car Vehicle Dynamics, ch. 17; Gillespie, Fundamentals of
 * Vehicle Dynamics, ch. 7):
 *
 *   - roll centre: the instant centre lies on the line through the contact
 *     patch perpendicular to the patch's path in front view, so the line
 *     from the patch through it crosses the centreline at
 *     `y_c · dy_c/dz` above the ground (`y_c` the patch's distance from the
 *     centreline, `dy_c/dz` its lateral scrub per unit of bump);
 *   - anti fractions: Chrono reacts the brake torque on the chassis and
 *     drives through half-shafts, so the longitudinal force acts at the
 *     wheel centre and its share carried by the links is the wheel
 *     centre's fore-aft travel per unit of bump, `dx/dz`, times `L / h`
 *     (positive opposes the pitch: at the front `dx/dz`, at the rear
 *     `−dx/dz`), as ADR-0018 defines it;
 *   - motion ratios: spring and damper length change per unit of wheel
 *     travel, so each rate at the wheel is the element's rate times the
 *     square of its ratio.
 *
 * Slopes are least-squares lines through the sweep within `SLOPE_WINDOW`
 * of the travel, so the logging step's noise does not enter. Travel is the
 * spindle's height change in the chassis frame from Chrono's rest, metres,
 * positive in bump. The two wheels of an axle are averaged, the right
 * mirrored.
 */
import { loadKc, type KcRow } from "./reference.js";

export type Axle = "front" | "rear";

/** Half-width of the window each slope is fitted over, m of travel. */
export const SLOPE_WINDOW = 0.01;

interface Sample {
  travel: number;
  /** Spindle fore-aft and outboard position, m (outboard positive on either side). */
  x: number;
  y: number;
  z: number;
  toeDeg: number;
  camberDeg: number;
  spring: number;
  shock: number;
}

/**
 * Each wheel's samples along the heave pass from the chassis raised 6 cm
 * down to 10 cm below rest (the same pass `kinematics.ts` uses for the
 * E90), sorted by travel.
 */
export function heaveSamples(kc: KcRow[] = loadKc("sedan")): Sample[][] {
  const rest = kc.find((r) => r.phase === "rest")!;
  const heave = kc.filter((r) => r.phase === "heave");
  const top = heave.reduce((best, r, i) => (r.heave > heave[best]!.heave ? i : best), 0);
  const pass = heave.slice(top).filter((r, i, a) => i === 0 || r.heave < a[i - 1]!.heave);
  return [0, 1, 2, 3].map((w) => {
    const side = w % 2 === 0 ? 1 : -1;
    return pass
      .map((r) => ({
        travel: r.z[w]! - rest.z[w]!,
        x: r.x![w]!,
        y: side * r.y![w]!,
        z: r.z[w]!,
        toeDeg: r.toe[w]!,
        camberDeg: r.camber[w]!,
        spring: r.spring![w]!,
        shock: r.shock![w]!,
      }))
      .sort((a, b) => a.travel - b.travel);
  });
}

/** Least-squares slope and value of `f` against travel within the window around `travel`. */
function local(samples: Sample[], f: (s: Sample) => number, travel: number) {
  const w = samples.filter((s) => Math.abs(s.travel - travel) <= SLOPE_WINDOW);
  if (w.length < 3) throw new Error(`travel ${travel} m is outside the sweep`);
  const mx = w.reduce((a, s) => a + s.travel, 0) / w.length;
  const my = w.reduce((a, s) => a + f(s), 0) / w.length;
  let sxy = 0;
  let sxx = 0;
  for (const s of w) {
    sxy += (s.travel - mx) * (f(s) - my);
    sxx += (s.travel - mx) ** 2;
  }
  const slope = sxy / sxx;
  return { slope, value: my + slope * (travel - mx) };
}

const wheelsOf = (axle: Axle) => (axle === "front" ? [0, 1] : [2, 3]);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export interface AxleGeometry {
  /** Roll-centre height above the ground, m. */
  rollCentre: number;
  /** Wheel centre's fore-aft travel per unit of bump, m/m. */
  dxdz: number;
  /** Spring and damper length change per unit of wheel travel (magnitude). */
  springRatio: number;
  shockRatio: number;
  toeDeg: number;
  camberDeg: number;
}

/**
 * An axle's geometry at `travel` (m from rest, + bump). `loadedRadius`
 * places the contact patch below the spindle, in the wheel plane.
 */
export function axleGeometry(
  axle: Axle,
  travel: number,
  loadedRadius: number,
  samples: Sample[][] = heaveSamples(),
): AxleGeometry {
  const per = wheelsOf(axle).map((w) => {
    const s = samples[w]!;
    const DEG = Math.PI / 180;
    // Positive camber tips the top outboard, so the patch sits inboard of the spindle.
    const patchY = (q: Sample) => q.y - loadedRadius * Math.sin(q.camberDeg * DEG);
    const yc = local(s, patchY, travel);
    return {
      rollCentre: yc.value * yc.slope,
      dxdz: local(s, (q) => q.x, travel).slope,
      springRatio: Math.abs(local(s, (q) => q.spring, travel).slope),
      shockRatio: Math.abs(local(s, (q) => q.shock, travel).slope),
      toeDeg: local(s, (q) => q.toeDeg, travel).value,
      camberDeg: local(s, (q) => q.camberDeg, travel).value,
    };
  });
  const avg = (k: keyof AxleGeometry) => mean(per.map((p) => p[k]));
  return {
    rollCentre: avg("rollCentre"),
    dxdz: avg("dxdz"),
    springRatio: avg("springRatio"),
    shockRatio: avg("shockRatio"),
    toeDeg: avg("toeDeg"),
    camberDeg: avg("camberDeg"),
  };
}

/** Spring length at rest of each axle (mean of its wheels), m. */
export function restSpringLength(axle: Axle, kc: KcRow[] = loadKc("sedan")): number {
  const rest = kc.find((r) => r.phase === "rest")!;
  return mean(wheelsOf(axle).map((w) => rest.spring![w]!));
}
