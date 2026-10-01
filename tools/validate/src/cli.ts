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
console.log(
  "| Vehicle | Wheels lock at (s) | Lock releases | Sliding decel ripple | Spring-back (m/s) | At rest after 2 s (m/s) | 100–0 km/h with ABS (m) |",
);
console.log("| --- | --- | --- | --- | --- | --- | --- |");
for (const [id, v] of Object.entries(report.vehicles)) {
  const s = v.straightLine;
  console.log(
    `| ${id} | ${fmt(s.lockTime)} | ${s.lockReleases === 0 ? "none" : `${s.lockReleases} (CHATTER)`} | ${(100 * s.lockedDecelRipple).toFixed(2)} % | ${fmt(s.restSpeed)} | ${s.settledSpeed.toExponential(1)} | ${fmt(s.brakingDistanceAbs, 1)} |`,
  );
}
console.log("");
console.log(
  "| Vehicle | Timestep sweep (250–2000 Hz × 30–240 Hz) | K_us spread (deg/g) | Braking distance spread |",
);
console.log("| --- | --- | --- | --- |");
for (const [id, v] of Object.entries(report.vehicles)) {
  const s = v.timestepSweep;
  console.log(
    `| ${id} | ${s.stable ? "stable" : "UNSTABLE"} | ${s.gradientSpreadDegPerG.toFixed(4)} | ${(100 * s.brakingDistanceSpread).toFixed(2)} % |`,
  );
}
console.log("");
console.log(
  "| Vehicle | Flat rest | 10 % brake | 20 % brake | 30 % brake | 10 % handbrake | 20 % handbrake | 20 % cross |",
);
console.log("| --- | --- | --- | --- | --- | --- | --- | --- |");
const park = (c: { creepSpeed: number; holds: boolean } | null): string =>
  c === null ? "n/a" : `${c.holds ? "holds" : "CREEPS"} (${c.creepSpeed.toExponential(1)} m/s)`;
for (const [id, v] of Object.entries(report.vehicles)) {
  const p = v.parked;
  console.log(
    `| ${id} | ${park(p.flatRest)} | ${park(p.grade10Brake)} | ${park(p.grade20Brake)} | ${park(p.grade30Brake)} | ${park(p.grade10Handbrake)} | ${park(p.grade20Handbrake)} | ${park(p.cross20Brakes)} |`,
  );
}
console.log("");

console.log(
  "| Vehicle | Step steer 80 km/h: steer (deg) | Yaw rate (deg/s) | Response (s) | Overshoot | Lat accel (m/s²) | Roll (deg) |",
);
console.log("| --- | --- | --- | --- | --- | --- | --- |");
const deg = 180 / Math.PI;
for (const [id, v] of Object.entries(report.vehicles)) {
  const s = v.stepSteer;
  console.log(
    `| ${id} | ${fmt(s.steerAngle * deg, 1)} | ${fmt(s.yawRate * deg, 1)} | ${fmt(s.yawRateResponseTime)} | ${(100 * s.yawRateOvershoot).toFixed(1)} % | ${fmt(s.latAccel)} | ${fmt(s.roll * deg, 1)}${s.completed ? "" : " (INCOMPLETE)"} |`,
  );
}
console.log("");
console.log(
  "| Vehicle | Double lane change (ISO 3888-1) passes up to | Attempts (km/h: pass, peak lat g) |",
);
console.log("| --- | --- | --- |");
for (const [id, v] of Object.entries(report.vehicles)) {
  const l = v.laneChange;
  const attempts = l.attempts
    .map(
      (a) =>
        `${(a.entrySpeed * 3.6).toFixed(0)}: ${a.passed ? "pass" : "FAIL"}, ${(a.maxLatAccel / 9.80665).toFixed(2)} g`,
    )
    .join("; ");
  console.log(
    `| ${id} | ${l.maxPassingSpeed === null ? "none" : `${(l.maxPassingSpeed * 3.6).toFixed(0)} km/h`} | ${attempts} |`,
  );
}
console.log("");
console.log("| Vehicle | 100–0 km/h locked / ABS (m): wet asphalt | gravel | snow | ice |");
console.log("| --- | --- | --- | --- | --- |");
for (const [id, v] of Object.entries(report.vehicles)) {
  const cell = (s: {
    brakingDistance: number;
    brakingDistanceAbs: number;
    cleanStop: boolean;
    spun: boolean;
  }) =>
    s.spun
      ? `spins (${fmt(s.brakingDistance, 0)} m)`
      : `${fmt(s.brakingDistance, 1)} / ${fmt(s.brakingDistanceAbs, 1)}${s.cleanStop ? "" : " (CHATTER)"}`;
  const su = v.surfaces;
  console.log(
    `| ${id} | ${cell(su.asphaltWet!)} | ${cell(su.gravel!)} | ${cell(su.snow!)} | ${cell(su.ice!)} |`,
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
