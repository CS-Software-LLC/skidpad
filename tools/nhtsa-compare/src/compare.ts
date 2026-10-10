/**
 * Metrics computed identically on the measured rows and Skidpad's, and the
 * tolerance each must meet. The tolerances were set before Skidpad was first
 * run against the measured data (see docs/validation/nhtsa-jeep-cherokee.md)
 * and are not moved to fit a result; a metric outside its band is a finding.
 *
 * They are wider than the Chrono comparison's in the places where the Jeep
 * build is estimated rather than measured (roll stiffness, tire, steering
 * compliance), and as tight where the measurement is the limit: VRTC quotes
 * the 95 % confidence of its mean lateral acceleration at about ±0.05 m/s²,
 * and the digitised plots are read to within a fraction of their tick
 * spacing.
 *
 * Roll is measured from its mean over the first second of the window,
 * since the measured car and the model rest at slightly different attitudes.
 */
import { MANOEUVRES, type Row } from "./reference.js";
import { WHEELBASE } from "./jeep.js";

const G = 9.81;
const DEG = 180 / Math.PI;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const window = (rows: Row[], t0: number, t1: number) => rows.filter((r) => r.t >= t0 && r.t <= t1);

function slope(xs: number[], ys: number[]): number {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
  }
  return sxy / sxx;
}

/** Roll from its value at the start of the window. */
function rollFromStart(rows: Row[]): number[] {
  const r0 = mean(window(rows, rows[0]!.t, rows[0]!.t + 1).map((r) => r.roll));
  return rows.map((r) => r.roll - r0);
}

/**
 * The slowly increasing steer's linear range, 1–4 m/s² of lateral
 * acceleration, on the way up: the rows before the lateral acceleration
 * first passes 4 m/s² (the measured car's ay falls again past its peak as
 * the front tires plough, and a model that spins comes back through the
 * range).
 */
function linearRange(rows: Row[]): Row[] {
  const end = rows.find((r) => r.ay > 4)?.t ?? Infinity;
  return rows.filter((r) => r.t < end && r.ay >= 1);
}

/** First time a channel reaches a fraction of its steady value, after `from`. */
function reach(
  rows: Row[],
  key: "handwheel" | "ay" | "yawRate",
  steady: number,
  frac: number,
  from = 0,
): number {
  return rows.find((r) => r.t >= from && r[key] / steady >= frac)?.t ?? NaN;
}

const STEP_STEADY: [number, number] = [10, 16];
const steadyOf = (rows: Row[], key: "handwheel" | "ay" | "yawRate") =>
  mean(window(rows, ...STEP_STEADY).map((r) => r[key]));

export type Kind = "relative" | "absolute";
export interface Metric {
  maneuver: string;
  label: string;
  unit: string;
  fn: (rows: Row[]) => number;
  tolerance: { kind: Kind; value: number };
}

const rel = (value: number) => ({ kind: "relative" as const, value });
const abs = (value: number) => ({ kind: "absolute" as const, value });

export const METRICS: Metric[] = [
  {
    maneuver: "sis",
    label: "yaw-rate gain, 1–4 m/s²",
    unit: "deg/s per deg",
    tolerance: rel(0.15),
    fn: (r) => {
      const w = linearRange(r);
      return slope(
        w.map((x) => x.handwheel),
        w.map((x) => x.yawRate),
      );
    },
  },
  {
    maneuver: "sis",
    label: "lateral acceleration gain, 1–4 m/s²",
    unit: "m/s² per 100 deg",
    tolerance: rel(0.15),
    fn: (r) => {
      const w = linearRange(r);
      return (
        100 *
        slope(
          w.map((x) => x.handwheel),
          w.map((x) => x.ay),
        )
      );
    },
  },
  {
    maneuver: "sis",
    label: "understeer gradient at the published ratio of 14",
    unit: "deg/g",
    tolerance: abs(1.0),
    fn: (r) => {
      // Hand-wheel angle over 14 per g, less the Ackermann part L·g/V² (ISO 4138).
      const w = linearRange(r);
      const v = MANOEUVRES.sis!.speed;
      return (
        slope(
          w.map((x) => x.ay / G),
          w.map((x) => x.handwheel / 14),
        ) -
        DEG * ((WHEELBASE * G) / (v * v))
      );
    },
  },
  {
    maneuver: "sis",
    label: "maximum lateral acceleration, 1 s mean",
    unit: "m/s²",
    tolerance: rel(0.1),
    fn: (r) => {
      let best = -Infinity;
      for (let i = 0; i + 100 <= r.length; i += 10)
        best = Math.max(best, mean(r.slice(i, i + 100).map((x) => x.ay)));
      return best;
    },
  },
  {
    maneuver: "sis",
    label: "roll gradient, 1–4 m/s²",
    unit: "deg/g",
    tolerance: rel(0.25),
    fn: (r) => {
      const roll = rollFromStart(r);
      const idx = new Set(linearRange(r).map((x) => x.t));
      const xs: number[] = [];
      const ys: number[] = [];
      r.forEach((x, i) => {
        if (idx.has(x.t)) {
          xs.push(x.ay / G);
          ys.push(-roll[i]!);
        }
      });
      return slope(xs, ys);
    },
  },
  {
    maneuver: "step",
    label: "steady lateral acceleration, 10–16 s",
    unit: "m/s²",
    tolerance: rel(0.1),
    fn: (r) => steadyOf(r, "ay"),
  },
  {
    maneuver: "step",
    label: "steady yaw rate, 10–16 s",
    unit: "deg/s",
    tolerance: rel(0.1),
    fn: (r) => steadyOf(r, "yawRate"),
  },
  {
    maneuver: "step",
    label: "steady roll, 10–16 s",
    unit: "deg",
    tolerance: rel(0.25),
    fn: (r) => {
      const roll = rollFromStart(r);
      return -mean(
        r
          .map((x, i) => [x, roll[i]!] as const)
          .filter(([x]) => x.t >= 10 && x.t <= 16)
          .map(([, v]) => v),
      );
    },
  },
  {
    maneuver: "step",
    label: "yaw-rate response time, 50 % wheel to 90 % yaw rate",
    unit: "s",
    tolerance: abs(0.08),
    fn: (r) => {
      const t50 = reach(r, "handwheel", steadyOf(r, "handwheel"), 0.5);
      return reach(r, "yawRate", steadyOf(r, "yawRate"), 0.9, t50) - t50;
    },
  },
  {
    maneuver: "step",
    label: "lateral acceleration response time, 50 % wheel to 90 % ay",
    unit: "s",
    tolerance: abs(0.08),
    fn: (r) => {
      const t50 = reach(r, "handwheel", steadyOf(r, "handwheel"), 0.5);
      return reach(r, "ay", steadyOf(r, "ay"), 0.9, t50) - t50;
    },
  },
  {
    maneuver: "step",
    label: "yaw-rate overshoot",
    unit: "%",
    tolerance: abs(10),
    fn: (r) => {
      const s = steadyOf(r, "yawRate");
      const peak = Math.max(...window(r, 5, 10).map((x) => x.yawRate));
      return (100 * (peak - s)) / s;
    },
  },
  ...(["lc12", "lc22"] as const).flatMap((lc): Metric[] => [
    {
      maneuver: lc,
      label: "peak lateral acceleration",
      unit: "m/s²",
      tolerance: rel(0.15),
      fn: (r) => Math.max(...r.map((x) => Math.abs(x.ay))),
    },
    {
      maneuver: lc,
      label: "peak yaw rate",
      unit: "deg/s",
      tolerance: rel(0.15),
      fn: (r) => Math.max(...r.map((x) => Math.abs(x.yawRate))),
    },
    {
      maneuver: lc,
      label: "peak roll",
      unit: "deg",
      tolerance: rel(0.25),
      fn: (r) => Math.max(...rollFromStart(r).map(Math.abs)),
    },
  ]),
];

/** Traces compared over the whole window: RMS difference over the measured range. */
export const TRACES: Array<{
  maneuver: string;
  channel: "ay" | "yawRate" | "roll";
  tolerance: number;
}> = [
  ...(["sis", "step", "lc12", "lc22"] as const).flatMap((m) => [
    { maneuver: m, channel: "ay" as const, tolerance: 0.15 },
    { maneuver: m, channel: "yawRate" as const, tolerance: 0.15 },
    { maneuver: m, channel: "roll" as const, tolerance: 0.25 },
  ]),
];

export interface MetricResult {
  maneuver: string;
  label: string;
  unit: string;
  measured: number;
  skidpad: number;
  difference: number;
  tolerance: Metric["tolerance"];
  pass: boolean;
}

export interface TraceResult {
  maneuver: string;
  channel: string;
  nrmse: number;
  tolerance: number;
  pass: boolean;
}

export function evaluate(
  measured: Record<string, Row[]>,
  skidpad: Record<string, Row[]>,
): { metrics: MetricResult[]; traces: TraceResult[] } {
  const metrics = METRICS.map((m) => {
    const a = m.fn(measured[m.maneuver]!);
    const b = m.fn(skidpad[m.maneuver]!);
    const difference = m.tolerance.kind === "relative" ? (b - a) / Math.abs(a) : b - a;
    return {
      maneuver: m.maneuver,
      label: m.label,
      unit: m.unit,
      measured: a,
      skidpad: b,
      difference,
      tolerance: m.tolerance,
      pass: Number.isFinite(difference) && Math.abs(difference) <= m.tolerance.value,
    };
  });
  const traces = TRACES.map((tr) => {
    const a = measured[tr.maneuver]!;
    const b = skidpad[tr.maneuver]!;
    const pick = (rows: Row[]) =>
      tr.channel === "roll" ? rollFromStart(rows) : rows.map((r) => r[tr.channel]);
    const va = pick(a);
    const vb = pick(b);
    const byT = new Map(b.map((r, i) => [r.t, vb[i]!]));
    let se = 0;
    let n = 0;
    a.forEach((r, i) => {
      const s = byT.get(r.t);
      if (s === undefined) return;
      se += (s - va[i]!) ** 2;
      n++;
    });
    const range = Math.max(...va) - Math.min(...va);
    const nrmse = Math.sqrt(se / n) / range;
    return {
      maneuver: tr.maneuver,
      channel: tr.channel,
      nrmse,
      tolerance: tr.tolerance,
      pass: nrmse <= tr.tolerance,
    };
  });
  return { metrics, traces };
}
