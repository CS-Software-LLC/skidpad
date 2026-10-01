import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { init } from "@skidpad/core";
import { init as initCompat } from "@skidpad/core/compat";
import { runScenario } from "./scenario.js";
import { LAP_TRACES, replayLap } from "./lap.js";
import { preset, type PresetId } from "@skidpad/presets";

const pinned = readFileSync(
  fileURLToPath(new URL("../../../crates/skidpad-math/selftest.hash", import.meta.url)),
  "utf8",
).trim();

describe("determinism in Node", () => {
  it("the scripted scenario hashes identically on repeated runs and across builds", async () => {
    const sp = await init();
    const a = runScenario(sp, "node");
    const b = runScenario(sp, "node");
    expect(a.worldHash).toBe(b.worldHash);
    expect(a.checkpoints).toEqual(b.checkpoints);
    expect(a.mathSelftestHash).toBe(pinned);
    expect(a.laps).toEqual(b.laps);
    const compat = await initCompat();
    const c = runScenario(compat, "node-compat");
    expect(c.worldHash).toBe(a.worldHash);
    expect(c.laps).toEqual(a.laps);
  });

  it("the recorded laps are real drives: each car finishes near where it started, at rest", async () => {
    const sp = await init();
    for (const trace of LAP_TRACES) {
      expect(trace.rate).toBe(60);
      expect(trace.steps).toBe(trace.steer.length);
      expect(trace.steps).toBe(trace.throttle.length);
      for (const v of trace.steer) expect(Math.abs(v)).toBeLessThanOrEqual(trace.quantum);
      const r = replayLap(sp, trace);
      // The loop starts at the origin and the main straight runs along +x
      // (−60 … 90 m); the car crosses the line at speed and stops on the
      // straight with the handbrake on.
      const where = `${trace.preset} finished at ${r.finalX.toFixed(1)}, ${r.finalY.toFixed(1)}`;
      expect(r.finalX, where).toBeGreaterThan(0);
      expect(r.finalX, where).toBeLessThan(90);
      expect(Math.abs(r.finalY), where).toBeLessThan(4.5);
      expect(r.checkpoints.length).toBeGreaterThan(3);
    }
  });

  it("a lap replayed on a different car still runs deterministically", async () => {
    const sp = await init();
    const trace = LAP_TRACES[0]!;
    const other = preset(trace.preset === "kart" ? "hatchbackFwd" : ("kart" as PresetId));
    const a = replayLap(sp, trace, other);
    const b = replayLap(sp, trace, other);
    expect(a).toEqual(b);
  });
});
