import { test, expect } from "@playwright/test";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { DeterminismReport } from "../src/scenario.js";

const here = dirname(fileURLToPath(import.meta.url));
const harness = readFileSync(join(here, "..", "out", "harness", "harness.js"), "utf8");
const pinned = readFileSync(
  join(here, "..", "..", "..", "crates", "skidpad-math", "selftest.hash"),
  "utf8",
).trim();
const nodeReportPath = join(here, "..", "out", "node.json");

test("the scripted scenario and the recorded laps hash identically in this browser and in Node", async ({
  page,
  browserName,
}) => {
  await page.goto("about:blank");
  await page.addScriptTag({ content: harness });
  const report = (await page
    .waitForFunction(() => window.__skidpadDeterminism, null, { timeout: 90_000 })
    .then((h) => h.jsonValue())) as DeterminismReport & { error?: string };
  expect(report.error, report.error).toBeUndefined();

  const outDir = join(here, "..", "out");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${browserName}.json`), JSON.stringify(report, null, 2));

  expect(report.mathSelftestHash).toBe(pinned);
  expect(report.checkpoints.length).toBeGreaterThan(5);
  expect(report.laps.length).toBe(3);
  for (const lap of report.laps) expect(lap.steps).toBeGreaterThan(30 * 60);

  if (existsSync(nodeReportPath)) {
    const node = JSON.parse(readFileSync(nodeReportPath, "utf8")) as DeterminismReport;
    expect(report.worldHash, `${browserName} vs node`).toBe(node.worldHash);
    expect(report.checkpoints).toEqual(node.checkpoints);
    expect(report.vehicleHashes).toEqual(node.vehicleHashes);
    expect(report.laps, `${browserName} vs node, recorded laps`).toEqual(node.laps);
  } else {
    test.info().annotations.push({
      type: "warning",
      description: "no node.json; run `pnpm hash:node` first",
    });
  }
});
