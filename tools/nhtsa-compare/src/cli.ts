#!/usr/bin/env node
/**
 * Skidpad against NHTSA VRTC's instrumented 1997 Jeep Cherokee.
 *
 *   pnpm compare            # the estimated build: every manoeuvre, tables, out/
 *   pnpm compare --fit      # fit the three unknowns on the slowly increasing
 *                           # steer, then compare everything with them
 *   pnpm compare --measured # only the measured metrics, no Skidpad run
 *
 * Writes out/report.json (metrics, traces, the build) and out/<manoeuvre>.csv
 * (Skidpad's rows beside the measured ones).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { init } from "@skidpad/core";
import { evaluate, METRICS, type MetricResult } from "./compare.js";
import { fitOnSis } from "./fit.js";
import { ESTIMATED, jeepCherokee, type Tunable } from "./jeep.js";
import { MANOEUVRES, measured, ROOT, type Row } from "./reference.js";
import { runManoeuvre } from "./run.js";

const args = new Set(process.argv.slice(2));
const ref: Record<string, Row[]> = {};
for (const name of Object.keys(MANOEUVRES)) ref[name] = measured(name);

const fmt = (v: number) =>
  !Number.isFinite(v)
    ? "n/a"
    : Math.abs(v) >= 100
      ? v.toFixed(0)
      : Math.abs(v) >= 10
        ? v.toFixed(1)
        : v.toFixed(2);

if (args.has("--measured")) {
  console.log("| Manoeuvre | Metric | Measured |\n| --- | --- | --- |");
  for (const m of METRICS)
    console.log(`| ${m.maneuver} | ${m.label} (${m.unit}) | ${fmt(m.fn(ref[m.maneuver]!))} |`);
  process.exit(0);
}

const sp = await init();
let tunable: Tunable = ESTIMATED;
if (args.has("--fit")) {
  tunable = fitOnSis(sp, ref.sis!, console.log);
  console.log(`fitted on the slowly increasing steer: ${JSON.stringify(tunable)}\n`);
}

const sim: Record<string, Row[]> = {};
const outDir = join(ROOT, "out", args.has("--fit") ? "fitted" : "estimated");
mkdirSync(outDir, { recursive: true });
for (const name of Object.keys(MANOEUVRES)) {
  sim[name] = runManoeuvre(sp, name, { tunable });
  const byT = new Map(sim[name]!.map((r) => [r.t, r]));
  const lines = [
    "t,handwheel,ay_measured,ay_skidpad,yaw_measured,yaw_skidpad,roll_measured,roll_skidpad,speed_skidpad",
  ];
  for (const a of ref[name]!) {
    const b = byT.get(a.t);
    if (!b) continue;
    lines.push(
      [a.t, a.handwheel, a.ay, b.ay, a.yawRate, b.yawRate, a.roll, b.roll, b.speed]
        .map((v) => Number(v.toPrecision(6)))
        .join(","),
    );
  }
  writeFileSync(join(outDir, `${name}.csv`), lines.join("\n") + "\n");
}

const { metrics, traces } = evaluate(ref, sim);
const diff = (m: MetricResult) =>
  m.tolerance.kind === "relative"
    ? `${(100 * m.difference).toFixed(1)} % (±${100 * m.tolerance.value} %)`
    : `${m.difference >= 0 ? "+" : ""}${fmt(m.difference)} ${m.unit} (±${m.tolerance.value})`;

console.log(
  `Skidpad vs NHTSA VRTC 1997 Jeep Cherokee, ${args.has("--fit") ? "fitted" : "estimated"} build\n`,
);
console.log("| Manoeuvre | Metric | Measured | Skidpad | Difference (tolerance) | |");
console.log("| --- | --- | --- | --- | --- | --- |");
for (const m of metrics) {
  console.log(
    `| ${m.maneuver} | ${m.label} (${m.unit}) | ${fmt(m.measured)} | ${fmt(m.skidpad)} | ${diff(m)} | ${m.pass ? "pass" : "**outside**"} |`,
  );
}
console.log("\n| Manoeuvre | Channel | RMS difference / measured range | |");
console.log("| --- | --- | --- | --- |");
for (const t of traces) {
  console.log(
    `| ${t.maneuver} | ${t.channel} | ${(100 * t.nrmse).toFixed(1)} % (≤${100 * t.tolerance} %) | ${t.pass ? "pass" : "**outside**"} |`,
  );
}
console.log(
  `\n${metrics.filter((m) => m.pass).length} of ${metrics.length} metrics and ${traces.filter((t) => t.pass).length} of ${traces.length} traces within tolerance.`,
);
writeFileSync(
  join(outDir, "report.json"),
  JSON.stringify({ tunable, definition: jeepCherokee(tunable), metrics, traces }, null, 2),
);
