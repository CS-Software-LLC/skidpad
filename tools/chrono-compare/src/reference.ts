/**
 * Chrono's reference rows (`reference/`, written by `chrono/bmw_e90.py`)
 * and the row format both harnesses share.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

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

export function loadReference(name: string): Row[] {
  const text = readFileSync(join(ROOT, "reference", `${name}.csv`), "utf8").trim();
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
