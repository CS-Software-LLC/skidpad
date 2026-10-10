/**
 * Regression guard on the comparison with NHTSA VRTC's measured 1997 Jeep
 * Cherokee (docs/validation/nhtsa-jeep-cherokee.md). Needs nothing outside
 * the repository: the digitised traces are committed.
 *
 * For each build, every metric and trace within tolerance today must stay
 * within it. The known gaps below are outside it for the reasons the report
 * gives; when a change brings one inside, remove it here and update the
 * report.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { init, validateDefinition, type Skidpad } from "@skidpad/core";
import { evaluate, METRICS, type MetricResult, type TraceResult } from "./compare.js";
import { fitOnSis } from "./fit.js";
import { ESTIMATED, jeepCherokee, type Tunable } from "./jeep.js";
import { loadTrace, MANOEUVRES, measured, ROOT, type Row } from "./reference.js";
import { runManoeuvre } from "./run.js";

const key = (m: { maneuver: string; label?: string; channel?: string }) =>
  `${m.maneuver}: ${m.label ?? m.channel}`;

const STEERING_GAIN = "the kinematic steering has none of the car's compliance";
/** Estimated build: `maneuver: label|channel` → why it is outside tolerance. */
const ESTIMATED_GAPS: Record<string, string> = {
  "sis: yaw-rate gain, 1–4 m/s²": STEERING_GAIN,
  "sis: lateral acceleration gain, 1–4 m/s²": STEERING_GAIN,
  "sis: understeer gradient at the published ratio of 14": STEERING_GAIN,
  "sis: roll gradient, 1–4 m/s²": "estimated springs, bar and roll centres: 4.8 deg/g against 3.6",
  "step: steady lateral acceleration, 10–16 s": STEERING_GAIN,
  "step: steady yaw rate, 10–16 s": STEERING_GAIN,
  "step: steady roll, 10–16 s": "follows the steering gain and the roll gradient",
  "lc12: peak lateral acceleration": STEERING_GAIN,
  "lc12: peak yaw rate": STEERING_GAIN,
  "lc12: peak roll": "follows the steering gain and the roll gradient",
  "lc22: peak lateral acceleration": STEERING_GAIN,
  "lc22: peak yaw rate": STEERING_GAIN,
  "lc22: peak roll": "follows the steering gain and the roll gradient",
  "sis: roll": "follows the roll gradient",
  "step: ay": STEERING_GAIN,
  "step: yawRate": STEERING_GAIN,
  "step: roll": "follows the steering gain and the roll gradient",
  "lc12: roll": "follows the steering gain and the roll gradient",
  "lc22: ay": STEERING_GAIN,
  "lc22: yawRate": STEERING_GAIN,
  "lc22: roll": "follows the steering gain and the roll gradient",
};

const RATIO_AT_SPEED =
  "a constant effective ratio fitted at 11 m/s steers too much at 22.5 m/s: the compliance grows with lateral force";
/** Fitted with an effective steering ratio. */
const RATIO_GAPS: Record<string, string> = {
  "lc22: peak lateral acceleration": RATIO_AT_SPEED,
  "lc22: peak yaw rate": RATIO_AT_SPEED,
  "lc22: peak roll": RATIO_AT_SPEED,
};

/** Fitted with a compliance per m/s² at the published ratio. */
const COMPLIANCE_GAPS: Record<string, string> = {
  "step: lateral acceleration response time, 50 % wheel to 90 % ay":
    "0.09 s quicker than measured; the harness's compliance acts without lag",
};

function check(metrics: MetricResult[], traces: TraceResult[], gaps: Record<string, string>) {
  const outside = [...metrics, ...traces].filter((m) => !m.pass).map(key);
  expect(outside.filter((k) => !(k in gaps))).toEqual([]);
  // A gap that has closed should come off the list.
  expect(Object.keys(gaps).filter((k) => !outside.includes(k))).toEqual([]);
}

describe("Skidpad against NHTSA VRTC's measured Jeep Cherokee", () => {
  let sp: Skidpad;
  const ref: Record<string, Row[]> = {};
  const run = (tunable: Tunable) => {
    const sim: Record<string, Row[]> = {};
    for (const name of Object.keys(MANOEUVRES)) sim[name] = runManoeuvre(sp, name, { tunable });
    return evaluate(ref, sim);
  };

  beforeAll(async () => {
    sp = await init();
    for (const name of Object.keys(MANOEUVRES)) ref[name] = measured(name);
  });

  it("has every digitised trace, in time order", () => {
    const figures = JSON.parse(
      readFileSync(join(ROOT, "digitise", "figures.json"), "utf8"),
    ) as Array<{ file: string; series: Record<string, string> }>;
    for (const f of figures) {
      for (const s of Object.keys(f.series)) {
        const tr = loadTrace(`${f.file}_${s}`);
        expect(tr.length, `${f.file}_${s}`).toBeGreaterThan(30);
        expect(
          tr.every((p, i) => i === 0 || p[0] >= tr[i - 1]![0]),
          `${f.file}_${s}`,
        ).toBe(true);
      }
    }
  });

  it("reads the measured metrics the report quotes", () => {
    const m = (label: string, man = "sis") =>
      METRICS.find((x) => x.maneuver === man && x.label.startsWith(label))!.fn(ref[man]!);
    expect(m("lateral acceleration gain")).toBeCloseTo(3.6, 1);
    expect(m("maximum lateral acceleration")).toBeCloseTo(7.05, 1);
    expect(m("roll gradient")).toBeCloseTo(3.63, 1);
    expect(m("steady yaw rate", "step")).toBeCloseTo(27.1, 0);
  });

  it("builds a valid definition", () => {
    expect(validateDefinition(jeepCherokee()).ok).toBe(true);
  });

  it("estimated build: within tolerance outside the known gaps", () => {
    const { metrics, traces } = run(ESTIMATED);
    check(metrics, traces, ESTIMATED_GAPS);
  });

  it("fitted with an effective ratio: within tolerance outside the known gaps", () => {
    const t = fitOnSis(sp, ref.sis!);
    expect(t.steeringRatio).toBeGreaterThan(18);
    expect(t.steeringRatio).toBeLessThan(23);
    const { metrics, traces } = run(t);
    check(metrics, traces, RATIO_GAPS);
  });

  it("fitted with a compliance: within tolerance outside the known gaps", () => {
    const t = fitOnSis(sp, ref.sis!, () => {}, false, "harness");
    expect(t.steeringRatio).toBe(14);
    expect(t.compliance).toBeGreaterThan(7);
    expect(t.compliance).toBeLessThan(11);
    const { metrics, traces } = run(t);
    check(metrics, traces, COMPLIANCE_GAPS);
  });
});
