/**
 * Metrics computed identically on Chrono's rows and Skidpad's, and the
 * tolerance each must meet. The tolerances were set before the comparison
 * was first run, from what each metric is used for (see the report in
 * docs/validation/chrono-bmw-e90.md); a metric outside its band is a finding,
 * not a reason to move the band.
 *
 * Lateral acceleration is `speed · yawRate`: Chrono's point acceleration
 * carries contact chatter, and the product is exact in a steady turn. Roll
 * and pitch are measured from their value at the start of the manoeuvre,
 * because the two cars rest at slightly different attitudes.
 */
import { at, type Row, type RowKey } from "./run.js";

const G = 9.81;
const DEG = 180 / Math.PI;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const window = (rows: Row[], t0: number, t1: number) => rows.filter((r) => r.t >= t0 && r.t <= t1);
const ay = (r: Row) => r.speed * r.yawRate;
const firstTime = (rows: Row[], pred: (r: Row) => boolean) => rows.find(pred)?.t ?? NaN;
const deltaMean = (r: Row) => r.delta ?? 0.5 * ((r.delta0 ?? NaN) + (r.delta1 ?? NaN));

/** Least-squares slope of y over x. */
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

/** Rows of the steering ramp in the linear range, 0.1–0.5 g. */
const linearRange = (rows: Row[]) =>
  rows.filter((r) => r.t > 3 && Math.abs(ay(r)) > 0.1 * G && Math.abs(ay(r)) < 0.5 * G);

function stoppingDistance(rows: Row[], tBrake: number): number {
  const stop = rows.find((r) => r.t > tBrake && Math.abs(r.speed) < 0.1);
  return stop ? stop.x - at(rows, tBrake, "x") : NaN;
}

export type Kind = "relative" | "absolute";
export interface Metric {
  maneuver: string;
  label: string;
  unit: string;
  fn: (rows: Row[], wheelbase: number) => number;
  /** Allowed difference: a fraction of Chrono's value, or an absolute amount. */
  tolerance: { kind: Kind; value: number };
}

/** A metric's key, `maneuver: label`, as `evaluate`'s `fitted` set and the known gaps use it. */
export const metricKey = (m: { maneuver: string; label: string }) => `${m.maneuver}: ${m.label}`;

const rel = (value: number) => ({ kind: "relative" as const, value });
const abs = (value: number) => ({ kind: "absolute" as const, value });

export const METRICS: Metric[] = [
  {
    maneuver: "accel",
    label: "0–60 km/h",
    unit: "s",
    tolerance: rel(0.1),
    fn: (r) => firstTime(r, (x) => x.speed >= 60 / 3.6),
  },
  {
    maneuver: "accel",
    label: "0–100 km/h",
    unit: "s",
    tolerance: rel(0.1),
    fn: (r) => firstTime(r, (x) => x.speed >= 100 / 3.6),
  },
  {
    maneuver: "accel",
    label: "speed at 30 s",
    unit: "km/h",
    tolerance: rel(0.05),
    fn: (r) => at(r, 30, "speed") * 3.6,
  },
  {
    maneuver: "coast",
    label: "speed at 20 s",
    unit: "km/h",
    tolerance: rel(0.05),
    fn: (r) => at(r, 20, "speed") * 3.6,
  },
  {
    maneuver: "brake100",
    label: "stopping distance, wheels locked",
    unit: "m",
    tolerance: rel(0.05),
    fn: (r) => stoppingDistance(r, 0.6),
  },
  {
    maneuver: "brakeHalf",
    label: "stopping distance, 0.4 pedal",
    unit: "m",
    tolerance: rel(0.05),
    fn: (r) => stoppingDistance(r, 0.6),
  },
  {
    maneuver: "brakeHalf",
    label: "pitch per g of braking",
    unit: "deg/g",
    tolerance: rel(0.2),
    fn: (r) => {
      const w = window(r, 2, 4);
      return (DEG * (mean(w.map((x) => x.pitch)) - r[0]!.pitch)) / (-mean(w.map((x) => x.ax)) / G);
    },
  },
  {
    maneuver: "rampSteer",
    label: "understeer gradient",
    unit: "deg/g",
    tolerance: abs(0.3),
    fn: (r, wheelbase) => {
      const w = linearRange(r);
      // Steer angle per g, less the Ackermann part L·g/V² (ISO 4138, constant speed).
      const v = mean(w.map((x) => x.speed));
      return (
        DEG *
        (slope(
          w.map((x) => Math.abs(ay(x)) / G),
          w.map((x) => Math.abs(deltaMean(x))),
        ) -
          (wheelbase * G) / (v * v))
      );
    },
  },
  {
    maneuver: "rampSteer",
    label: "lateral acceleration at 15 s",
    unit: "g",
    tolerance: rel(0.05),
    fn: (r) => Math.abs(mean(window(r, 14.8, 15.2).map(ay))) / G,
  },
  {
    maneuver: "rampSteer",
    label: "peak lateral acceleration",
    unit: "g",
    tolerance: rel(0.05),
    fn: (r) => Math.max(...r.map((x) => Math.abs(ay(x)))) / G,
  },
  {
    maneuver: "rampSteer",
    label: "roll gradient",
    unit: "deg/g",
    tolerance: rel(0.15),
    fn: (r) => {
      const w = linearRange(r);
      return (
        DEG *
        slope(
          w.map((x) => Math.abs(ay(x)) / G),
          w.map((x) => Math.abs(x.roll - r[0]!.roll)),
        )
      );
    },
  },
  {
    maneuver: "rampSteer",
    label: "front share of lateral load transfer",
    unit: "%",
    tolerance: abs(3),
    fn: (r) => {
      const w = linearRange(r);
      const f = slope(
        w.map((x) => Math.abs(ay(x))),
        w.map((x) => Math.abs(x.fz0 - x.fz1)),
      );
      const b = slope(
        w.map((x) => Math.abs(ay(x))),
        w.map((x) => Math.abs(x.fz2 - x.fz3)),
      );
      return (100 * f) / (f + b);
    },
  },
  {
    maneuver: "rampSteer",
    label: "body slip gradient",
    unit: "deg/g",
    tolerance: abs(0.3),
    fn: (r) => {
      const w = linearRange(r);
      return (
        DEG *
        slope(
          w.map((x) => Math.abs(ay(x)) / G),
          w.map((x) => Math.atan2(x.vy, x.speed) * Math.sign(-x.yawRate)),
        )
      );
    },
  },
  {
    maneuver: "rampSteer",
    label: "pitch in the turn at 0.7 g",
    unit: "deg",
    tolerance: abs(0.2),
    fn: (r) => {
      const w = r.filter((x) => Math.abs(ay(x)) > 0.68 * G && Math.abs(ay(x)) < 0.72 * G);
      return w.length ? DEG * (mean(w.map((x) => x.pitch)) - r[0]!.pitch) : NaN;
    },
  },
  {
    maneuver: "stepSteer",
    label: "steady yaw rate",
    unit: "deg/s",
    tolerance: rel(0.1),
    fn: (r) => DEG * Math.abs(mean(window(r, 6, 8).map((x) => x.yawRate))),
  },
  {
    maneuver: "stepSteer",
    label: "yaw rate overshoot",
    unit: "%",
    tolerance: abs(5),
    fn: (r) => {
      const ss = Math.abs(mean(window(r, 6, 8).map((x) => x.yawRate)));
      return 100 * (Math.max(...r.map((x) => Math.abs(x.yawRate))) / ss - 1);
    },
  },
  {
    maneuver: "stepSteer",
    label: "yaw rate response time (ISO 7401, 90 %)",
    unit: "s",
    tolerance: rel(0.2),
    // From 50 % of the steer input, which ramps from 2.0 to 2.2 s.
    fn: (r) => {
      const ss = Math.abs(mean(window(r, 6, 8).map((x) => x.yawRate)));
      return firstTime(r, (x) => x.t > 2 && Math.abs(x.yawRate) >= 0.9 * ss) - 2.1;
    },
  },
  {
    maneuver: "stepSteer",
    label: "lateral acceleration response time (90 %)",
    unit: "s",
    tolerance: rel(0.2),
    fn: (r) => {
      const ss = Math.abs(mean(window(r, 6, 8).map(ay)));
      return firstTime(r, (x) => x.t > 2 && Math.abs(ay(x)) >= 0.9 * ss) - 2.1;
    },
  },
  {
    maneuver: "stepSteer",
    label: "steady lateral acceleration",
    unit: "g",
    tolerance: rel(0.1),
    fn: (r) => Math.abs(mean(window(r, 6, 8).map(ay))) / G,
  },
  {
    maneuver: "stepSteer",
    label: "steady roll",
    unit: "deg",
    tolerance: rel(0.15),
    fn: (r) => DEG * Math.abs(mean(window(r, 6, 8).map((x) => x.roll)) - r[0]!.roll),
  },
  {
    maneuver: "sineSteer",
    label: "peak yaw rate",
    unit: "deg/s",
    tolerance: rel(0.1),
    fn: (r) => DEG * Math.max(...r.map((x) => Math.abs(x.yawRate))),
  },
  {
    maneuver: "sineSteer",
    label: "peak lateral acceleration",
    unit: "g",
    tolerance: rel(0.1),
    fn: (r) => Math.max(...r.map((x) => Math.abs(ay(x)))) / G,
  },
  {
    maneuver: "sineSteer",
    label: "yaw rate lag behind steer",
    unit: "ms",
    tolerance: rel(0.2),
    fn: (r) => {
      // First half cycle: steer peaks right (+) near 2.5 s; yaw rate peaks negative after it.
      const w = window(r, 2, 3.4);
      const steerPeak = w.reduce((a, b) =>
        Math.abs(deltaMean(b)) > Math.abs(deltaMean(a)) ? b : a,
      ).t;
      const yawPeak = w.reduce((a, b) => (Math.abs(b.yawRate) > Math.abs(a.yawRate) ? b : a)).t;
      return 1000 * (yawPeak - steerPeak);
    },
  },
  {
    maneuver: "sineSteer",
    label: "peak roll",
    unit: "deg",
    tolerance: rel(0.15),
    fn: (r) => DEG * Math.max(...r.map((x) => Math.abs(x.roll - r[0]!.roll))),
  },
  {
    maneuver: "lowSpeedTurn",
    label: "turn radius",
    unit: "m",
    tolerance: rel(0.05),
    fn: (r) => mean(window(r, 10, 15).map((x) => x.speed / Math.abs(x.yawRate))),
  },
];

/**
 * Time-series channels compared over the whole manoeuvre. The locked-wheel
 * stop is left out: both cars lock their rear wheels and spin, in whichever
 * direction a rounding difference sends them, so only its distance compares.
 */
export const TRACES: Record<string, RowKey[]> = {
  accel: ["speed"],
  coast: ["speed"],
  brakeHalf: ["speed", "pitch"],
  rampSteer: ["yawRate", "roll", "fz0", "fz2"],
  stepSteer: ["yawRate", "roll"],
  sineSteer: ["yawRate", "roll"],
  lowSpeedTurn: ["yawRate"],
};
/** Trace tolerance: RMS difference as a fraction of Chrono's range over the manoeuvre. */
export const TRACE_TOLERANCE = 0.05;

/** RMS difference over the manoeuvre as a fraction of the reference's range. */
export function nrmse(ref: Row[], sim: Row[], key: RowKey): number {
  const val = (x: Row) => x[key] ?? NaN;
  const relative = key === "roll" || key === "pitch";
  const offsetRef = relative ? val(ref[0]!) : 0;
  const offsetSim = relative ? val(sim[0]!) : 0;
  const vals = ref.map((x) => val(x) - offsetRef);
  const range = Math.max(...vals) - Math.min(...vals) || 1;
  let sum = 0;
  for (const x of ref) sum += (val(x) - offsetRef - (at(sim, x.t, key) - offsetSim)) ** 2;
  return Math.sqrt(sum / ref.length) / range;
}

export interface MetricResult {
  maneuver: string;
  label: string;
  unit: string;
  chrono: number;
  skidpad: number;
  difference: number;
  tolerance: { kind: Kind; value: number };
  fitted: boolean;
  pass: boolean;
}

export interface TraceResult {
  maneuver: string;
  channel: string;
  nrmse: number;
  pass: boolean;
}

/**
 * Every metric and trace on both sets of rows. `fitted` names the metrics
 * (`metricKey`) a car's definition was fitted to, which are reported but
 * are not predictions.
 */
export function evaluate(
  chrono: Record<string, Row[]>,
  skidpad: Record<string, Row[]>,
  wheelbase: number,
  fitted: ReadonlySet<string> = new Set(),
): { metrics: MetricResult[]; traces: TraceResult[] } {
  const metrics = METRICS.filter((m) => chrono[m.maneuver] && skidpad[m.maneuver]).map((m) => {
    const c = m.fn(chrono[m.maneuver]!, wheelbase);
    const s = m.fn(skidpad[m.maneuver]!, wheelbase);
    const difference = m.tolerance.kind === "relative" ? (s - c) / Math.abs(c) : s - c;
    return {
      maneuver: m.maneuver,
      label: m.label,
      unit: m.unit,
      chrono: c,
      skidpad: s,
      difference,
      tolerance: m.tolerance,
      fitted: fitted.has(metricKey(m)),
      pass: Number.isFinite(difference) && Math.abs(difference) <= m.tolerance.value,
    };
  });
  const traces: TraceResult[] = [];
  for (const [man, keys] of Object.entries(TRACES)) {
    if (!chrono[man] || !skidpad[man]) continue;
    for (const k of keys) {
      const e = nrmse(chrono[man], skidpad[man], k);
      traces.push({ maneuver: man, channel: k, nrmse: e, pass: e <= TRACE_TOLERANCE });
    }
  }
  return { metrics, traces };
}
