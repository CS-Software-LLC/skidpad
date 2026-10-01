import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { init } from "@skidpad/core";
import { compare, DEFAULT_TOLERANCE, runAll, type ValidationReport } from "./scenarios.js";

describe("validation scenarios", () => {
  it("match the golden results within tolerance", async () => {
    const golden = JSON.parse(
      readFileSync(fileURLToPath(new URL("../golden/results.json", import.meta.url)), "utf8"),
    ) as ValidationReport;
    const sp = await init();
    const report = runAll(sp);
    const diffs = compare(golden, report, DEFAULT_TOLERANCE);
    expect(
      diffs,
      diffs.map((d) => `${d.path}: ${String(d.golden)} -> ${String(d.current)}`).join("\n"),
    ).toEqual([]);
  });

  it("every preset understeers mildly and agrees with linear theory", async () => {
    const sp = await init();
    const report = runAll(sp);
    for (const [id, v] of Object.entries(report.vehicles)) {
      expect(v.model, id).toBe("fourWheel");
      expect(v.understeer.gradientDegPerG, id).toBeGreaterThan(0);
      expect(v.understeer.gradientDegPerG, id).toBeLessThan(8);
      // The single-track model has no lateral load transfer and sits on the
      // linear theory; the four-wheel model adds the load-sensitivity effect
      // of transferring load across each axle, a fraction of a degree per g.
      const single = Math.abs(
        v.understeerSingleTrack.gradientDegPerG - v.understeer.analyticGradientDegPerG,
      );
      expect(
        single,
        `${id}: single-track ${v.understeerSingleTrack.gradientDegPerG} vs linear theory ${v.understeer.analyticGradientDegPerG} deg/g`,
      ).toBeLessThan(0.3);
      const four = Math.abs(v.understeer.gradientDegPerG - v.understeerSingleTrack.gradientDegPerG);
      expect(
        four,
        `${id}: four-wheel ${v.understeer.gradientDegPerG} vs single-track ${v.understeerSingleTrack.gradientDegPerG} deg/g`,
      ).toBeLessThan(0.6);
    }
  });
});
