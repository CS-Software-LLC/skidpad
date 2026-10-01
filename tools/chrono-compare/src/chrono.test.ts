/**
 * Regression guard on the comparison with Project Chrono's BMW_E90
 * (docs/validation/chrono-bmw-e90.md). Needs no Chrono install: the reference
 * rows are committed in `reference/`.
 *
 * Every metric and trace within tolerance today must stay within it. The
 * known gaps below are outside it for the reasons the report gives; when a
 * change brings one inside, remove it here and update the report.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { init } from "@skidpad/core";
import { evaluate, type MetricResult, type TraceResult } from "./compare.js";
import { loadReference, MANEUVERS, runManeuver, type Row } from "./run.js";
import { bmwE90, derive } from "./vehicle.js";

/** `maneuver: label` → why it is outside tolerance. */
export const KNOWN_GAPS: Record<string, string> = {
  "brakeHalf: stopping distance, 0.4 pedal":
    "Chrono realises about 7 % less brake torque than its nominal 800 N·m",
  "brakeHalf: pitch per g of braking":
    "pitch geometry fixed at ride height; Chrono's far front instant centre moves with dive",
  "brakeHalf: pitch":
    "pitch geometry fixed at ride height; Chrono's far front instant centre moves with dive",
  "rampSteer: pitch in the turn at 0.7 g": "roll centres fixed, no jacking force",
  "rampSteer: fz2": "roll centres fixed: Chrono's front share falls with lateral acceleration",
  "sineSteer: peak roll": "open: Skidpad overshoots in roll more than Chrono",
  "sineSteer: roll": "open: Skidpad overshoots in roll more than Chrono",
};

describe("Skidpad against Project Chrono's BMW_E90", () => {
  let metrics: MetricResult[];
  let traces: TraceResult[];

  beforeAll(async () => {
    const sp = await init();
    const d = derive();
    const definition = bmwE90(undefined, d);
    const chrono: Record<string, Row[]> = {};
    const skidpad: Record<string, Row[]> = {};
    for (const name of Object.keys(MANEUVERS)) {
      chrono[name] = loadReference(name);
      skidpad[name] = runManeuver(sp, name, { definition });
    }
    ({ metrics, traces } = evaluate(chrono, skidpad, d.wheelbase));
  }, 120_000);

  it("keeps every metric outside the known gaps within tolerance", () => {
    const failing = metrics
      .filter((m) => !m.pass && !(`${m.maneuver}: ${m.label}` in KNOWN_GAPS))
      .map((m) => `${m.maneuver}: ${m.label}: Chrono ${m.chrono}, Skidpad ${m.skidpad}`);
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
      ...metrics.filter((m) => m.pass).map((m) => `${m.maneuver}: ${m.label}`),
      ...traces.filter((t) => t.pass).map((t) => `${t.maneuver}: ${t.channel}`),
    ].filter((k) => k in KNOWN_GAPS);
    expect(closed, "now within tolerance: remove from KNOWN_GAPS and update the report").toEqual(
      [],
    );
  });
});
