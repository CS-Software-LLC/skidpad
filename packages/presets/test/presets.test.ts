import { describe, expect, it } from "vitest";
import { init, validateDefinition } from "@skidpad/core";
import { presetIds, preset } from "../src/index.js";

describe("presets", () => {
  it("every preset validates, carries a data sheet, and drives", async () => {
    const sp = await init();
    for (const id of presetIds) {
      const def = preset(id);
      const v = validateDefinition(def);
      expect(v.ok, `${id}: ${v.errors.join("; ")}`).toBe(true);
      expect(def.dataSheet?.sources?.length, `${id} needs sources`).toBeGreaterThan(0);
      const w = sp.createWorld(1);
      const i = w.addVehicle(def);
      w.setInput(i, { throttle: 1 });
      for (let k = 0; k < 300; k++) w.step(1 / 60);
      expect(w.read(i, "Speed"), id).toBeGreaterThan(10);
      w.free();
    }
  });

  it("every preset has the complete chassis and name its type promises", async () => {
    const sp = await init();
    for (const id of presetIds) {
      const def = preset(id);
      const full = sp.completeDefinition(def);
      expect(def.name, id).toBe(full.name);
      // Every chassis field is given, not filled in by the core.
      expect(Object.keys(def.chassis).sort(), id).toEqual(Object.keys(full.chassis).sort());
      expect(def.chassis, id).toEqual(full.chassis);
    }
  });

  it("every preset says how its engine sounds", () => {
    for (const id of presetIds) {
      const def = preset(id);
      const firings = def.sound?.firingsPerRev;
      if (def.drivetrain?.powerUnit?.kind === "combustion") {
        expect(firings, id).toBeGreaterThan(0);
      } else {
        expect(firings, id).toBe(0);
      }
    }
  });

  it("shift and rev-limiter channels follow the hatchback's gearbox", async () => {
    const sp = await init();
    const def = sp.completeDefinition(preset("hatchbackFwd"));
    const t = def.drivetrain.transmission;
    const w = sp.createWorld(1);
    const car = w.addVehicle(def);
    w.setInput(car, { throttle: 1 });
    let gear = w.read(car, "Gear");
    let timer = w.read(car, "ShiftTimer");
    let shifts = 0;
    for (let k = 0; k < 900; k++) {
      w.step(1 / 60);
      const g = w.read(car, "Gear");
      const s = w.read(car, "ShiftTimer");
      expect(s > timer, `frame ${k}`).toBe(g !== gear);
      if (g !== gear) {
        shifts++;
        expect(s).toBeLessThanOrEqual(t.shiftTime + t.shiftHold);
        expect(s).toBeGreaterThan(t.shiftTime + t.shiftHold - 1 / 60);
      }
      [gear, timer] = [g, s];
      const cut = w.read(car, "RevLimiter");
      expect(cut).toBeGreaterThanOrEqual(0);
      expect(cut).toBeLessThanOrEqual(1);
    }
    expect(shifts).toBeGreaterThanOrEqual(2);
    w.free();
  });
});
