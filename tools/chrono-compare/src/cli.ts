#!/usr/bin/env node
/**
 * Skidpad against Project Chrono's BMW_E90.
 *
 *   pnpm compare            # run every manoeuvre, print the tables, write out/
 *   pnpm compare --fit      # refit the anti-roll bars first and print the result
 *   pnpm compare --fixed-geometry   # the car before ADR-0026: no travel curves
 *   pnpm compare --toe-curve        # also the toe curves from Chrono's K&C sweep
 *
 * Writes out/report.json (metrics, traces, derived model values) and
 * out/<manoeuvre>.csv (Skidpad's rows, same columns as reference/).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { init } from "@skidpad/core";
import { evaluate } from "./compare.js";
import { fitAntiRoll } from "./fit.js";
import { loadReference, MANEUVERS, runManeuver, type Row, type RowKey } from "./run.js";
import {
  bmwE90,
  derive,
  E90_FITTED,
  FITTED_ANTI_ROLL,
  FITTED_ANTI_ROLL_FIXED_GEOMETRY,
  GAPS,
  ROOT,
} from "./vehicle.js";

const args = new Set(process.argv.slice(2));
const sp = await init();
const d = derive();

let antiRoll = FITTED_ANTI_ROLL;
if (args.has("--fit")) {
  const { best } = fitAntiRoll(sp, console.log, {
    travelCurves: !args.has("--fixed-geometry"),
    toeCurve: args.has("--toe-curve"),
  });
  antiRoll = { front: best.front, rear: best.rear };
  if (antiRoll.front !== FITTED_ANTI_ROLL.front || antiRoll.rear !== FITTED_ANTI_ROLL.rear) {
    console.log(`update FITTED_ANTI_ROLL in src/vehicle.ts to ${JSON.stringify(antiRoll)}`);
  }
}
const fixed = args.has("--fixed-geometry");
if (fixed && !args.has("--fit")) antiRoll = FITTED_ANTI_ROLL_FIXED_GEOMETRY;
const build = { travelCurves: !fixed, toeCurve: args.has("--toe-curve") };
const definition = bmwE90(antiRoll, d, build);

const chrono: Record<string, Row[]> = {};
const skidpad: Record<string, Row[]> = {};
const outDir = join(ROOT, "out");
mkdirSync(outDir, { recursive: true });
for (const name of Object.keys(MANEUVERS)) {
  chrono[name] = loadReference(name);
  skidpad[name] = runManeuver(sp, name, { definition });
  const rows = skidpad[name];
  const keys = Object.keys(rows[0]!) as RowKey[];
  writeFileSync(
    join(outDir, `${name}.csv`),
    [
      keys.join(","),
      ...rows.map((r) => keys.map((k) => Number((r[k] ?? NaN).toPrecision(6))).join(",")),
    ].join("\n") + "\n",
  );
}
const { metrics, traces } = evaluate(chrono, skidpad, d.wheelbase, E90_FITTED);

const fmt = (v: number) =>
  !Number.isFinite(v)
    ? "n/a"
    : Math.abs(v) >= 100
      ? v.toFixed(0)
      : Math.abs(v) >= 10
        ? v.toFixed(1)
        : v.toFixed(2);
const diff = (m: (typeof metrics)[number]) =>
  m.tolerance.kind === "relative"
    ? `${(100 * m.difference).toFixed(1)} % (±${100 * m.tolerance.value} %)`
    : `${m.difference >= 0 ? "+" : ""}${fmt(m.difference)} ${m.unit} (±${m.tolerance.value})`;

console.log(
  `Skidpad vs Project Chrono 9.0.1 BMW_E90 (anti-roll bars ${antiRoll.front} / ${antiRoll.rear} N/m)\n`,
);
console.log("| Manoeuvre | Metric | Chrono | Skidpad | Difference (tolerance) | |");
console.log("| --- | --- | --- | --- | --- | --- |");
for (const m of metrics) {
  const verdict = m.fitted ? "fitted" : m.pass ? "pass" : "**outside**";
  console.log(
    `| ${m.maneuver} | ${m.label} (${m.unit}) | ${fmt(m.chrono)} | ${fmt(m.skidpad)} | ${diff(m)} | ${verdict} |`,
  );
}
console.log("\n| Manoeuvre | Channel | RMS difference / Chrono range | |");
console.log("| --- | --- | --- | --- |");
for (const t of traces) {
  console.log(
    `| ${t.maneuver} | ${t.channel} | ${(100 * t.nrmse).toFixed(1)} % | ${t.pass ? "pass" : "**outside**"} |`,
  );
}
const predicted = metrics.filter((m) => !m.fitted);
console.log(
  `\n${predicted.filter((m) => m.pass).length} of ${predicted.length} predicted metrics and ${traces.filter((t) => t.pass).length} of ${traces.length} traces within tolerance.`,
);

writeFileSync(
  join(outDir, "report.json"),
  JSON.stringify({ antiRoll, derived: d, definition, metrics, traces, gaps: GAPS }, null, 2),
);
