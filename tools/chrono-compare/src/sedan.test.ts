/**
 * Regression guard on the comparison with Project Chrono's Sedan
 * (docs/validation/chrono-sedan.md). Needs no Chrono install: the reference
 * rows are committed in `reference/sedan/`.
 *
 * Every metric and trace within tolerance today must stay within it. The
 * known gaps below are outside it for the reasons the report gives; when a
 * change brings one inside, remove it here and update the report.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { init, validateDefinition, type Skidpad } from "@skidpad/core";
import { evaluate, metricKey, type MetricResult, type TraceResult } from "./compare.js";
import { chronoFy, loadSedanTir, mirrored, offsetToe } from "./pac02.js";
import { loadReference, MANEUVERS, runManeuver, type Row } from "./run.js";
import { loadEquilibrium } from "./reference.js";
import { deriveSedan, sedan, sedanTireFitError } from "./sedan.js";

/** `maneuver: label` → why it is outside tolerance. */
export const KNOWN_GAPS: Record<string, string> = {
  "rampSteer: lateral acceleration at 15 s":
    "near the limit Skidpad carries more load on the outer rear tire and holds 1.0 g where Chrono holds 0.93 g",
  "rampSteer: peak lateral acceleration": "as above",
  "rampSteer: pitch in the turn at 0.7 g":
    "the roll-centre curves dip the nose in a turn; Chrono's stays level",
  "stepSteer: yaw rate overshoot": "open: Chrono overshoots 23 %, Skidpad 15 %",
  "stepSteer: lateral acceleration response time (90 %)": "follows the overshoot",
  "brakeHalf: pitch":
    "the pitch per g matches, but Skidpad's pitch settles faster than Chrono's, as on the E90",
  "rampSteer: yawRate": "follows the limit grip",
  "rampSteer: roll": "follows the limit grip",
  "rampSteer: fz0": "follows the limit grip",
  "rampSteer: fz2": "follows the limit grip",
  "stepSteer: yawRate": "follows the overshoot",
  "stepSteer: roll": "open: small, as on the E90",
  "sineSteer: roll": "open: small, as on the E90",
};

describe("Skidpad against Project Chrono's Sedan", () => {
  let sp: Skidpad;
  let metrics: MetricResult[];
  let traces: TraceResult[];

  beforeAll(async () => {
    sp = await init();
    const d = deriveSedan();
    const definition = sedan(sp, d);
    const chrono: Record<string, Row[]> = {};
    const skidpad: Record<string, Row[]> = {};
    for (const name of Object.keys(MANEUVERS)) {
      chrono[name] = loadReference(name, "sedan");
      skidpad[name] = runManeuver(sp, name, { definition, car: "sedan" });
    }
    ({ metrics, traces } = evaluate(chrono, skidpad, d.wheelbase));
  }, 120_000);

  it("fits nothing to the car's behaviour", () => {
    expect(metrics.filter((m) => m.fitted)).toEqual([]);
  });

  it("keeps every metric outside the known gaps within tolerance", () => {
    const failing = metrics
      .filter((m) => !m.pass && !(metricKey(m) in KNOWN_GAPS))
      .map((m) => `${metricKey(m)}: Chrono ${m.chrono}, Skidpad ${m.skidpad}`);
    expect(failing).toEqual([]);
  });

  it("keeps every trace outside the known gaps within tolerance", () => {
    const failing = traces
      .filter((t) => !t.pass && !(`${t.maneuver}: ${t.channel}` in KNOWN_GAPS))
      .map((t) => `${t.maneuver}: ${t.channel}: ${(100 * t.nrmse).toFixed(1)} %`);
    expect(failing).toEqual([]);
  });

  it("lists only gaps that are still open", () => {
    const closed = [
      ...metrics.filter((m) => m.pass).map(metricKey),
      ...traces.filter((t) => t.pass).map((t) => `${t.maneuver}: ${t.channel}`),
    ].filter((k) => k in KNOWN_GAPS);
    expect(closed, "now within tolerance: remove from KNOWN_GAPS and update the report").toEqual(
      [],
    );
  });

  it("builds a valid definition with its travel curves zero at rest", () => {
    const def = sedan(sp, deriveSedan(), { toeCurve: true });
    expect(validateDefinition(def).errors).toEqual([]);
    for (const axle of def.axles!) {
      for (const curve of Object.values(axle.suspension!.kinematics!)) {
        expect(curve.find(([t]: [number, number]) => t === 0)).toEqual([0, 0]);
      }
    }
  });
});

describe("the Sedan's tire (pac02.ts)", () => {
  it("follows Chrono's pure-slip curves within 4 % of the peak", () => {
    const e = sedanTireFitError();
    expect(e.longitudinal).toBeLessThan(0.04);
    expect(e.lateral).toBeLessThan(0.03);
  });

  it("mirrors its offsets left to right, so they act as a small toe", () => {
    const p = loadSedanTir();
    expect(chronoFy(mirrored(p), 4000, 0)).toBeCloseTo(-chronoFy(p, 4000, 0), 9);
    expect(Math.abs(offsetToe(p, 4000))).toBeLessThan(0.1);
  });
});

describe("the Sedan's kinematics (sedan-kc.ts)", () => {
  it("start the toe curves from the toe the equilibrium rig measures", () => {
    const d = deriveSedan();
    const eq = loadEquilibrium("sedan");
    const deg = (rad: number) => (rad * 180) / Math.PI;
    // The sweep at the equilibrium travel against the rig's own wheel angles.
    expect(Math.abs(d.restToeDeg.front - deg(0.5 * (eq.toe[0] + eq.toe[1])))).toBeLessThan(0.05);
    expect(Math.abs(d.restToeDeg.rear - deg(0.5 * (eq.toe[2] + eq.toe[3])))).toBeLessThan(0.05);
    expect(d.curves.front.toeDeg.find(([t]) => t === 0)![1]).toBe(0);
  });

  it("place the spring stops inside the sweep's travel", () => {
    const d = deriveSedan();
    expect(d.frontStops.droop).toBeGreaterThan(0.03);
    expect(d.frontStops.bump).toBeGreaterThan(0.08);
  });
});
