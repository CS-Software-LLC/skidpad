#!/usr/bin/env node
/**
 * skidpad-validate: run the standard manoeuvres for every preset and compare
 * against the golden results.
 *
 *   pnpm validate            # run, write out/results.json, compare to golden
 *   pnpm validate --update   # overwrite golden/results.json (physics change)
 *   pnpm validate --json     # print the report to stdout
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { init } from "@skidpad/core";
import { compare, DEFAULT_TOLERANCE, runAll, type ValidationReport } from "./scenarios.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const goldenPath = join(root, "golden", "results.json");
const outDir = join(root, "out");

const args = new Set(process.argv.slice(2));
const sp = await init();
const report = runAll(sp);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "results.json"), JSON.stringify(report, null, 2));

if (args.has("--json")) {
  console.log(JSON.stringify(report, null, 2));
}

const fmt = (v: number | null | undefined, d = 2): string =>
  v === null || v === undefined ? "n/a" : v.toFixed(d);
console.log(`Skidpad validation (core ${report.coreVersion}, math ${report.mathSelftestHash})`);
console.log("");
console.log(
  "| Vehicle | K_us four-wheel (deg/g) | K_us single-track (deg/g) | K_us linear theory (deg/g) | 0–100 km/h (s) | 100–0 km/h (m) | Scripted drive hash |",
);
console.log("| --- | --- | --- | --- | --- | --- | --- |");
for (const [id, v] of Object.entries(report.vehicles)) {
  console.log(
    `| ${id} | ${fmt(v.understeer.gradientDegPerG)} | ${fmt(v.understeerSingleTrack.gradientDegPerG)} | ${fmt(v.understeer.analyticGradientDegPerG)} | ${fmt(v.straightLine.accelTime)} | ${fmt(v.straightLine.brakingDistance, 1)} | ${v.scriptedDriveHash} |`,
  );
}
console.log("");

if (args.has("--update") || !existsSync(goldenPath)) {
  mkdirSync(dirname(goldenPath), { recursive: true });
  writeFileSync(goldenPath, JSON.stringify(report, null, 2));
  console.log(`golden results written to ${goldenPath}`);
  process.exit(0);
}

const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as ValidationReport;
const diffs = compare(golden, report, DEFAULT_TOLERANCE);
if (diffs.length === 0) {
  console.log("validation: all results within tolerance of golden");
  process.exit(0);
}
console.error(`validation: ${diffs.length} result(s) differ from golden:`);
for (const d of diffs)
  console.error(`  ${d.path}: golden ${String(d.golden)} -> current ${String(d.current)}`);
console.error(
  "If this change is intended, run `pnpm validate:update` and describe it in a `physics:` changeset line.",
);
process.exit(1);
