import { describe, expect, it, beforeAll } from "vitest";
import { init, type Skidpad, type VehicleDefinition, validateDefinition } from "../src/index.js";

let sp: Skidpad;
beforeAll(async () => {
  sp = await init();
});

function withUnsprung(mass: number, rollInertia?: number): VehicleDefinition {
  const d = structuredClone(sp.defaultDefinition());
  for (const a of d.axles) a.suspension.unsprungMass = mass;
  if (rollInertia !== undefined) d.chassis.rollInertia = rollInertia;
  return d;
}

/** The core's own messages, from a rejected `addVehicle`. */
function coreErrors(d: VehicleDefinition): string {
  const w = sp.createWorld(1);
  try {
    w.addVehicle(d);
    return "";
  } catch (e) {
    return String(e);
  } finally {
    w.free();
  }
}

describe("unsprung mass validation (ADR-0028)", () => {
  it("accepts typical wheels", () => {
    const d = withUnsprung(40);
    expect(validateDefinition(d).errors).toEqual([]);
    expect(coreErrors(d)).toBe("");
  });

  it("keeps a tenth of the roll inertia for the body, like the core", () => {
    const d = withUnsprung(40, 60);
    const errors = validateDefinition(d).errors.filter((e) => e.includes("rollInertia"));
    expect(errors).toHaveLength(1);
    expect(coreErrors(d)).toContain(errors[0]!);
  });
});
