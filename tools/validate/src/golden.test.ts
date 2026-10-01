import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { init } from "@contactpatch/core";
import { compare, DEFAULT_TOLERANCE, runAll, type ValidationReport } from "./scenarios.js";

describe("validation scenarios", () => {
  it("match the golden results within tolerance", async () => {
    const golden = JSON.parse(
      readFileSync(fileURLToPath(new URL("../golden/results.json", import.meta.url)), "utf8"),
    ) as ValidationReport;
    const cp = await init();
    const report = runAll(cp);
    const diffs = compare(golden, report, DEFAULT_TOLERANCE);
    expect(
      diffs,
      diffs.map((d) => `${d.path}: ${String(d.golden)} -> ${String(d.current)}`).join("\n"),
    ).toEqual([]);
  });

  it("every preset understeers mildly and agrees with linear theory", async () => {
    const cp = await init();
    const report = runAll(cp);
    for (const [id, v] of Object.entries(report.vehicles)) {
      expect(v.understeer.gradientDegPerG, id).toBeGreaterThan(0);
      expect(v.understeer.gradientDegPerG, id).toBeLessThan(8);
      const diff = Math.abs(v.understeer.gradientDegPerG - v.understeer.analyticGradientDegPerG);
      expect(
        diff,
        `${id}: sim ${v.understeer.gradientDegPerG} vs linear theory ${v.understeer.analyticGradientDegPerG} deg/g`,
      ).toBeLessThan(0.3);
    }
  });
});
