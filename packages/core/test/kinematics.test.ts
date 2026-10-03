import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import schema from "../schema/vehicle-definition.schema.json" with { type: "json" };
import {
  init,
  type Skidpad,
  type VehicleDefinition,
  evalTravelCurve,
  validateDefinition,
} from "../src/index.js";

interface Case {
  name: string;
  axle: number;
  axleFields?: Record<string, unknown>;
  suspensionFields?: Record<string, unknown>;
  errors: string[];
}

// Shared with crates/skidpad-core/tests/kinematics_tests.rs.
const cases = (
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(
          "../../../crates/skidpad-core/tests/fixtures/kinematics_validation.json",
          import.meta.url,
        ),
      ),
      "utf8",
    ),
  ) as { cases: Case[] }
).cases;

let sp: Skidpad;
beforeAll(async () => {
  sp = await init();
});

function build(c: Case): VehicleDefinition {
  const d = structuredClone(sp.defaultDefinition());
  const a = d.axles[c.axle]! as unknown as Record<string, unknown>;
  Object.assign(a, c.axleFields ?? {});
  Object.assign(a.suspension as Record<string, unknown>, c.suspensionFields ?? {});
  return d;
}

describe("travel curves (ADR-0025)", () => {
  it("evaluates linearly and holds the end points", () => {
    const c: Array<[number, number]> = [
      [-0.1, 1],
      [0, 0],
      [0.1, -2],
    ];
    expect(evalTravelCurve(c, 0)).toBe(0);
    expect(evalTravelCurve(c, -0.05)).toBe(0.5);
    expect(evalTravelCurve(c, 0.05)).toBe(-1);
    expect(evalTravelCurve(c, -3)).toBe(1);
    expect(evalTravelCurve(c, 3)).toBe(-2);
    expect(evalTravelCurve([], 0.1)).toBe(0);
  });

  for (const c of cases) {
    it(`validates like the core: ${c.name}`, () => {
      const v = validateDefinition(build(c));
      expect(v.errors.filter((e) => e.includes("kinematics"))).toEqual(c.errors);
    });
  }

  it("the core accepts every valid case and keeps the curves", () => {
    for (const c of cases.filter((c) => c.errors.length === 0)) {
      const d = build(c);
      const w = sp.createWorld(1);
      const i = w.addVehicle(d);
      w.step(1 / 60);
      expect(Number.isFinite(w.read(i, "PosZ"))).toBe(true);
      w.free();
    }
  });

  it("the JSON schema accepts curves and rejects malformed ones", () => {
    const ajv = new Ajv2020({ strict: false });
    const validate = ajv.compile(schema);
    for (const c of cases) {
      const d = build(c);
      // The schema checks shape, not the zero crossing or the bounds.
      const shapeOnly = c.errors.every(
        (e) => e.includes("zero at zero travel") || e.includes("plus the static value"),
      );
      if (c.errors.length === 0 || shapeOnly) {
        expect(validate(d), `${c.name}: ${JSON.stringify(validate.errors)}`).toBe(true);
      } else if (!c.errors[0]!.includes("strictly increasing")) {
        expect(validate(d), c.name).toBe(false);
      }
    }
    const d = build(cases[0]!);
    (d.axles[0]!.suspension.kinematics as Record<string, unknown>).bumpSteer = [
      [0, 0],
      [0.1, 0],
    ];
    expect(validate(d)).toBe(false);
    const triple = build(cases[0]!);
    triple.axles[0]!.suspension.kinematics!.toeDeg = [[0, 0, 0] as unknown as [number, number]];
    expect(validate(triple)).toBe(false);
  });
});
