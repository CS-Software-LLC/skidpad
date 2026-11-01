/**
 * The Tuning panel's "Parking twist" switch (ADR-0039): it writes valid
 * settings on every preset's steered tires, takes them off again, and the
 * parked wheel then feels heavy and still settles when let go.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { init, validateDefinition, type Skidpad } from "@skidpad/core";
import { DIRECT_DRIVE_SCALER } from "@skidpad/input";
import { preset, presetIds } from "@skidpad/presets";
import { releaseVerdict, releaseWheel } from "./ffbLoop.js";
import { hasParkingTwist, withParkingTwist } from "./tuning.js";

const deg = (d: number) => (d * Math.PI) / 180;

let sp: Skidpad;
beforeAll(async () => {
  sp = await init();
});

describe("parking twist switch", () => {
  it("is off on every preset and switches on and off cleanly", () => {
    for (const id of presetIds) {
      const def = sp.completeDefinition(preset(id));
      expect(hasParkingTwist(def), id).toBe(false);
      const on = withParkingTwist(def, true);
      expect(hasParkingTwist(on), id).toBe(true);
      const v = validateDefinition(on);
      expect(v.errors, id).toEqual([]);
      expect(v.warnings, id).toEqual(validateDefinition(def).warnings);
      expect(withParkingTwist(on, false), id).toEqual(def);
    }
  });

  it("sizes the hatchback's front patch from its static load", () => {
    const on = withParkingTwist(sp.completeDefinition(preset("hatchbackFwd")), true);
    const tire = on.axles[0]!.tire as { contactRadius?: number; torsionalStiffness?: number };
    // 1220 kg, 60 % on the front: about 3.6 kN a wheel at 200 kPa.
    expect(tire.contactRadius).toBeCloseTo(0.076, 3);
    expect(tire.torsionalStiffness).toBe(1000);
    expect((on.axles[1]!.tire as { contactRadius?: number }).contactRadius).toBe(0);
  });

  it("makes a parked wheel heavy", () => {
    const torqueAt = (def: ReturnType<typeof preset>) => {
      const world = sp.createWorld(1);
      const car = world.addVehicle(sp.completeDefinition(def));
      for (let k = 0; k < 60; k++) world.step(1 / 60);
      for (let k = 1; k <= 60; k++) {
        world.setInput(car, { steer: (0.3 * k) / 60 });
        world.step(1 / 60);
      }
      return world.read(car, "SteeringTorque");
    };
    const def = preset("hatchbackFwd");
    const off = torqueAt(def);
    const on = torqueAt(withParkingTwist(sp.completeDefinition(def), true));
    expect(on).toBeLessThan(0);
    expect(Math.abs(on)).toBeGreaterThan(5 * Math.abs(off));
  });

  it("holds a wound-up parked wheel where it is let go, on every preset", () => {
    // Turned by hand to 45° and released: as motor torque the twist was a
    // stiff spring a host step late, and the hatchback's rim swung 41–45°
    // for good. As wheel friction it stays put (ADR-0039).
    for (const id of presetIds) {
      const def = withParkingTwist(sp.completeDefinition(preset(id)), true);
      const tr = releaseWheel(sp, def, {
        speed: 0,
        windUp: 1,
        releaseAngle: deg(45),
        playout: true,
        scaler: DIRECT_DRIVE_SCALER,
        columnScale: 2,
      });
      expect(releaseVerdict(tr), id).toBe("settled");
      expect(Math.abs(tr.angle.at(-1)! - deg(45)), id).toBeLessThan(deg(1));
    }
  });

  it("still lets every preset's parked wheel settle when released", () => {
    for (const id of presetIds) {
      const def = withParkingTwist(sp.completeDefinition(preset(id)), true);
      const tr = releaseWheel(sp, def, { speed: 0 });
      expect(releaseVerdict(tr), id).toBe("settled");
    }
  });
});
