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
});
