#!/usr/bin/env node
/**
 * Skidpad against a Project Chrono reference car: the BMW_E90 (default) or
 * the Sedan (`--car sedan`).
 *
 *   pnpm compare            # run every manoeuvre, print the tables, write out/
 *   pnpm compare --fit      # E90: refit the anti-roll bars first and print the result
 *   pnpm compare --fixed-geometry   # no travel curves (the E90 before ADR-0026)
 *   pnpm compare --toe-curve        # also the toe curves from Chrono's K&C sweep
 *   pnpm compare --car sedan        # the Sedan (nothing to fit)
 *
 * Writes out/<car>/report.json (metrics, traces, derived model values) and
 * out/<car>/<manoeuvre>.csv (Skidpad's rows, same columns as reference/<car>/).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { init } from "@skidpad/core";
import { evaluate } from "./compare.js";
import { fitAntiRoll } from "./fit.js";
import {
  loadReference,
  MANEUVERS,
  runManeuver,
  type CarName,
  type Row,
  type RowKey,
} from "./run.js";
import { deriveSedan, SEDAN_GAPS, sedan, sedanTireFitError } from "./sedan.js";
import {
  bmwE90,
  derive,
  E90_FITTED,
  FITTED_ANTI_ROLL,
  FITTED_ANTI_ROLL_FIXED_GEOMETRY,
  GAPS,
  ROOT,
} from "./vehicle.js";

const argv = process.argv.slice(2);
const args = new Set(argv);
const carArg = argv.includes("--car") ? argv[argv.indexOf("--car") + 1] : "bmw_e90";
if (carArg !== "bmw_e90" && carArg !== "sedan") throw new Error(`unknown car ${carArg}`);
const car: CarName = carArg;
const sp = await init();
if (car === "sedan" && args.has("--fit")) throw new Error("the Sedan has nothing to fit");
const d = car === "sedan" ? deriveSedan() : derive();

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
const definition =
  car === "sedan" ? sedan(sp, deriveSedan(), build) : bmwE90(antiRoll, derive(), build);

const chrono: Record<string, Row[]> = {};
const skidpad: Record<string, Row[]> = {};
const outDir = join(ROOT, "out", car);
mkdirSync(outDir, { recursive: true });
for (const name of Object.keys(MANEUVERS)) {
  chrono[name] = loadReference(name, car);
  skidpad[name] = runManeuver(sp, name, { definition, car });
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
const fitted = car === "sedan" ? new Set<string>() : E90_FITTED;
const { metrics, traces } = evaluate(chrono, skidpad, d.wheelbase, fitted);

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

if (car === "sedan") {
  const e = sedanTireFitError();
  console.log(
    `Skidpad vs Project Chrono 9.0.1 Sedan (tire fit within ${(100 * e.longitudinal).toFixed(1)} % / ${(100 * e.lateral).toFixed(1)} % of Chrono's peak)\n`,
  );
} else {
  console.log(
    `Skidpad vs Project Chrono 9.0.1 BMW_E90 (anti-roll bars ${antiRoll.front} / ${antiRoll.rear} N/m)\n`,
  );
}
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
  JSON.stringify(
    car === "sedan"
      ? { derived: d, definition, metrics, traces, gaps: SEDAN_GAPS }
      : { antiRoll, derived: d, definition, metrics, traces, gaps: GAPS },
    null,
    2,
  ),
);
