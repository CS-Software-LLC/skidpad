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
import { validateDefinition } from "@skidpad/core";
import { measuredAngles, wheelAngles } from "./kinematics.js";
import { loadKc } from "./reference.js";
import { bmwE90, derive, loadStatic } from "./vehicle.js";

/** `maneuver: label` → why it is outside tolerance. */
export const KNOWN_GAPS: Record<string, string> = {
  "brakeHalf: stopping distance, 0.4 pedal":
    "Chrono realises about 7 % less brake torque than its nominal 800 N·m",
  "brakeHalf: pitch":
    "the pitch per g now matches, but Skidpad's pitch settles faster than Chrono's",
  "rampSteer: roll":
    "with migrating roll centres Skidpad's roll per g grows with lateral acceleration faster than Chrono's",
  "stepSteer: roll":
    "with migrating roll centres Skidpad's roll per g grows with lateral acceleration faster than Chrono's",
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

describe("the E90's travel curves (ADR-0026)", () => {
  it("are valid offsets from Chrono's rest position", () => {
    const def = bmwE90(undefined, derive(), { toeCurve: true });
    const v = validateDefinition(def);
    expect(v.errors).toEqual([]);
    for (const axle of def.axles!) {
      for (const curve of Object.values(axle.suspension!.kinematics!)) {
        expect(curve.find(([t]: [number, number]) => t === 0)).toEqual([0, 0]);
      }
    }
  });

  it("take Chrono's rest toe from its kinematics sweep", () => {
    const s = loadStatic();
    const toe = (l: number, r: number) => ((r - l) / 2) * (180 / Math.PI);
    const [front, rear] = measuredAngles("front", [0]).concat(measuredAngles("rear", [0]));
    // The sweep's pass through zero travel against the parked car, within its hysteresis.
    expect(Math.abs(front!.toeDeg - toe(s.toe[0], s.toe[1]))).toBeLessThan(0.02);
    expect(Math.abs(rear!.toeDeg - toe(s.toe[2], s.toe[3]))).toBeLessThan(0.02);
  });

  it("the hardpoint solve reproduces the rear's kinematics, not the front's bump steer", () => {
    const kc = loadKc();
    const rest = kc[0]!;
    const travels = [-0.02, 0.02, 0.04, 0.06];
    const rear = measuredAngles("rear", travels, kc);
    const front = measuredAngles("front", travels, kc);
    travels.forEach((t, i) => {
      const solved = wheelAngles("rear", rest.z[2] + t);
      expect(Math.abs(solved.toeDeg - rear[i]!.toeDeg)).toBeLessThan(0.1);
      expect(Math.abs(solved.camberDeg - rear[i]!.camberDeg)).toBeLessThan(0.02);
    });
    // Chrono's front bump steer is several times the hardpoints' (see the report).
    const slope = (a: { toeDeg: number }[]) => a[3]!.toeDeg - a[0]!.toeDeg;
    const solvedFront = travels.map((t) => wheelAngles("front", rest.z[0] + t));
    expect(Math.abs(slope(front))).toBeGreaterThan(5 * Math.abs(slope(solvedFront)));
  });
});
