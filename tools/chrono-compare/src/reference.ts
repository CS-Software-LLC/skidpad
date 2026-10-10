/**
 * Chrono's reference rows (`reference/<car>/`, written by `chrono/<car>.py`)
 * and the row format both harnesses share.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The Chrono reference cars, each with its own `reference/<car>/`. */
export type CarName = "bmw_e90" | "sedan";
export const CARS: CarName[] = ["bmw_e90", "sedan"];

export function referenceDir(car: CarName): string {
  return join(ROOT, "reference", car);
}

type WheelChannel = `${"fz" | "fx" | "fy" | "slip" | "alpha" | "omega"}${0 | 1 | 2 | 3}`;
type Channel =
  | "t"
  | "x"
  | "y"
  | "speed"
  | "vy"
  | "ax"
  | "ay"
  | "yawRate"
  | "roll"
  | "pitch"
  | "rpm"
  | "gear"
  | "throttle"
  | "brake"
  | "steer"
  | WheelChannel;
/**
 * One logged sample. Chrono's rows carry each wheel's road-wheel angle
 * (`delta0`…`delta3`); Skidpad's carry the mean front angle it was steered
 * with (`delta`).
 */
export type Row = { [K in Channel]: number } & {
  delta?: number;
  delta0?: number;
  delta1?: number;
  delta2?: number;
  delta3?: number;
};
export type RowKey = keyof Row;

export function loadReference(name: string, car: CarName = "bmw_e90"): Row[] {
  const text = readFileSync(join(referenceDir(car), `${name}.csv`), "utf8").trim();
  const [head = "", ...lines] = text.split("\n");
  const keys = head.split(",");
  return lines.map((l) => {
    const v = l.split(",");
    const r: Record<string, number> = {};
    keys.forEach((k, i) => (r[k] = Number(v[i])));
    return r as Row;
  });
}

/** Linear interpolation of a channel at time t (rows sorted by time). */
export function at(rows: Row[], t: number, key: RowKey): number {
  const get = (r: Row) => r[key] ?? NaN;
  const first = rows[0]!;
  if (t <= first.t) return get(first);
  let lo = 0;
  let hi = rows.length - 1;
  if (t >= rows[hi]!.t) return get(rows[hi]!);
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (rows[m]!.t > t) hi = m;
    else lo = m;
  }
  const a = rows[lo]!;
  const b = rows[hi]!;
  return get(a) + ((get(b) - get(a)) * (t - a.t)) / (b.t - a.t);
}

/** One row of the kinematics sweep (`reference/<car>/kc.csv`, `chrono/kc.py`). */
export interface KcRow {
  phase: "rest" | "heave" | "roll";
  /** Chassis raised by, m. */
  heave: number;
  /** Chassis rolled by, rad, + = left side up. */
  roll: number;
  /** Per wheel FL, FR, RL, RR: spindle height in the chassis frame, m. */
  z: [number, number, number, number];
  /** Toe-in, degrees. */
  toe: [number, number, number, number];
  /** Camber relative to the chassis, degrees, negative top-in. */
  camber: [number, number, number, number];
  /** Spindle position in the chassis frame, m (sweeps newer than the E90's). */
  x?: [number, number, number, number] | undefined;
  y?: [number, number, number, number] | undefined;
  /** Spring length, m, where the suspension reports one (sweeps newer than the E90's). */
  spring?: [number, number, number, number] | undefined;
}

export function loadKc(car: CarName = "bmw_e90"): KcRow[] {
  const text = readFileSync(join(referenceDir(car), "kc.csv"), "utf8").trim();
  // Python's csv module ends its lines with \r\n.
  const [head = "", ...lines] = text.split(/\r?\n/);
  const keys = head.split(",");
  return lines.map((l) => {
    const v = l.split(",");
    const col = (k: string) => keys.indexOf(k);
    const wheel = (k: string) => {
      if (col(`${k}0`) < 0) return undefined;
      return [0, 1, 2, 3].map((i) => Number(v[col(`${k}${i}`)])) as KcRow["z"];
    };
    return {
      phase: v[0] as KcRow["phase"],
      heave: Number(v[col("heave")]),
      roll: Number(v[col("roll")]),
      z: wheel("z")!,
      toe: wheel("toe")!,
      camber: wheel("camber")!,
      x: wheel("x"),
      y: wheel("y"),
      spring: wheel("spring"),
    };
  });
}
