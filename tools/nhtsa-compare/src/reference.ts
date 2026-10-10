/**
 * The measured traces of NHTSA VRTC's 1997 Jeep Cherokee, digitised from the
 * vector plots of SAE 2000-01-0700 by `digitise/digitise.py` into
 * `reference/jeep_cherokee/<manoeuvre>_<channel>_<series>.csv`.
 *
 * Units and axes are the paper's: SI, SAE vehicle axes (x forward, y right,
 * z down), so a positive hand-wheel angle turns right and gives positive
 * lateral acceleration and yaw rate and negative roll. Time is the paper's
 * own time axis, which includes the data system's pre-trigger record.
 *
 * Series: `exp` is the measured mean of the repeat runs (the single run for
 * the lane changes), `front` and `rear` are the roll measured at each axle's
 * ride-height sensors, `nads` is the paper's NADSdyna simulation, kept for
 * reference only.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const REFERENCE_DIR = join(ROOT, "reference", "jeep_cherokee");

export type Trace = Array<[number, number]>;

export function loadTrace(name: string): Trace {
  const text = readFileSync(join(REFERENCE_DIR, `${name}.csv`), "utf8").trim();
  const [, ...lines] = text.split(/\r?\n/);
  return lines.map((l) => {
    const [x, y] = l.split(",").map(Number);
    return [x!, y!];
  });
}

/** Linear interpolation, held at the ends. */
export function sample(trace: Trace, t: number): number {
  const first = trace[0]!;
  const last = trace[trace.length - 1]!;
  if (t <= first[0]) return first[1];
  if (t >= last[0]) return last[1];
  let lo = 0;
  let hi = trace.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (trace[mid]![0] <= t) lo = mid;
    else hi = mid;
  }
  const [t0, v0] = trace[lo]!;
  const [t1, v1] = trace[hi]!;
  return t1 > t0 ? v0 + ((v1 - v0) * (t - t0)) / (t1 - t0) : v1;
}

export interface Manoeuvre {
  /** What the paper calls it, and its figures. */
  title: string;
  /** Constant speed the test was driven at on cruise control, m/s. */
  speed: number;
  /**
   * The gear held through the manoeuvre: the highest that keeps the engine
   * above about 1500 rpm, where a four-speed automatic cruises. The paper
   * does not plot engine speed for the handling tests. ESTIMATE.
   */
  gear: number;
  /** The window of the paper's time axis that is simulated, s. */
  start: number;
  end: number;
}

export const MANOEUVRES: Record<string, Manoeuvre> = {
  sis: {
    title: "Slowly increasing steer, 11 m/s (figures 1–4)",
    speed: 11,
    gear: 2,
    start: 3.1,
    end: 51,
  },
  step: { title: "Step steer, 12 m/s (figures 5–8)", speed: 12, gear: 2, start: 4.0, end: 18 },
  lc12: {
    title: "Double lane change, 12 m/s (figures 9–10)",
    speed: 12,
    gear: 2,
    start: 4.2,
    end: 12,
  },
  lc22: {
    title: "Double lane change, 22.5 m/s (figures 11–12)",
    speed: 22.5,
    gear: 3,
    start: 3.9,
    end: 10.1,
  },
};

/** One measured or simulated sample, SAE axes. */
export interface Row {
  t: number;
  handwheel: number; // deg
  ay: number; // m/s²
  yawRate: number; // deg/s
  roll: number; // deg
  speed: number; // m/s
}

/**
 * The measured rows of a manoeuvre at 100 Hz over its window. Roll is the
 * mean of the front and rear measurements: Skidpad's body is rigid, and the
 * Jeep's frame twists between the two sensors.
 */
export function measured(name: string): Row[] {
  const m = MANOEUVRES[name]!;
  const hw = loadTrace(`${name}_handwheel_exp`);
  const ay = loadTrace(`${name}_ay_exp`);
  const yaw = loadTrace(`${name}_yawrate_exp`);
  const rf = loadTrace(`${name}_roll_front`);
  const rr = loadTrace(`${name}_roll_rear`);
  const rows: Row[] = [];
  for (let k = 0; m.start + k * 0.01 <= m.end + 1e-9; k++) {
    const t = Math.round((m.start + k * 0.01) * 100) / 100;
    rows.push({
      t,
      handwheel: sample(hw, t),
      ay: sample(ay, t),
      yawRate: sample(yaw, t),
      roll: 0.5 * (sample(rf, t) + sample(rr, t)),
      speed: m.speed,
    });
  }
  return rows;
}
