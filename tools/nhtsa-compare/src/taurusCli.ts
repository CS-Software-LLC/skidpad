#!/usr/bin/env node
/**
 * Skidpad against NHTSA VRTC's instrumented 1994 Ford Taurus GL.
 *
 *   pnpm taurus         # the estimated build and the build with its steering
 *                       # ratio fitted on the J-turn, side by side
 *
 * Writes out/taurus/report.json (both builds' results) and, for each build,
 * out/taurus/<build>-jturn.csv and <build>-frf.csv beside the measured values.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { init } from "@skidpad/core";
import { ROOT } from "./reference.js";
import { fordTaurus, TAURUS_ESTIMATED } from "./taurus.js";
import {
  evaluateTaurus,
  fitRatioOnJTurn,
  measuredFrf,
  measuredJTurn,
  runFrf,
  runJTurn,
  type Judged,
} from "./taurusRun.js";

const sp = await init();
const outDir = join(ROOT, "out", "taurus");
mkdirSync(outDir, { recursive: true });

const fmt = (v: number) =>
  !Number.isFinite(v) ? "n/a" : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(3);
const diff = (j: Judged) =>
  j.tolerance.kind === "relative"
    ? `${(100 * j.difference).toFixed(1)} % (±${100 * j.tolerance.value} %)`
    : `${j.difference >= 0 ? "+" : ""}${fmt(j.difference)} (±${j.tolerance.value})`;
const verdict = (j: Judged) =>
  j.pass === undefined ? "not judged" : j.pass ? "pass" : "**outside**";

const jm = measuredJTurn();
const fm = measuredFrf();
const fitted = fitRatioOnJTurn(sp, console.log);
const report: Record<string, unknown> = {};
for (const [build, tunable] of [
  ["estimated", TAURUS_ESTIMATED],
  ["fitted", fitted],
] as const) {
  const js = runJTurn(sp, tunable);
  const fs = runFrf(sp, tunable);
  const results = evaluateTaurus(jm, js, fs);
  report[build] = { tunable, definition: fordTaurus(tunable), results, frf: fs };

  const byT = new Map(js.map((r) => [r.t, r]));
  const jl = ["t,handwheel,ay_measured,ay_skidpad,yaw_skidpad,speed_measured,speed_skidpad"];
  for (const a of jm) {
    const b = byT.get(a.t);
    if (b)
      jl.push(
        [a.t, a.handwheel, a.ay, b.ay, b.yawRate, a.speed, b.speed]
          .map((v) => Number(v.toPrecision(6)))
          .join(","),
      );
  }
  writeFileSync(join(outDir, `${build}-jturn.csv`), jl.join("\n") + "\n");
  const fl = [
    "omega,yaw_mag_measured,yaw_mag_skidpad,yaw_phase_measured,yaw_phase_skidpad,ay_mag_measured,ay_mag_skidpad,ay_phase_measured,ay_phase_skidpad",
  ];
  fs.forEach((p, i) => {
    const m = fm[i]!;
    fl.push(
      [p.omega, m.yawMag, p.yawMag, m.yawPhase, p.yawPhase, m.ayMag, p.ayMag, m.ayPhase, p.ayPhase]
        .map((v) => Number(v.toPrecision(5)))
        .join(","),
    );
  });
  writeFileSync(join(outDir, `${build}-frf.csv`), fl.join("\n") + "\n");

  console.log(
    `\nSkidpad vs NHTSA VRTC 1994 Ford Taurus GL, ${build} build (steering ratio ${tunable.steeringRatio})\n`,
  );
  console.log("| Metric | Unit | Measured | Skidpad | Difference (tolerance) | |");
  console.log("| --- | --- | --- | --- | --- | --- |");
  for (const j of results)
    console.log(
      `| ${j.label} | ${j.unit} | ${fmt(j.measured)} | ${fmt(j.skidpad)} | ${diff(j)} | ${verdict(j)} |`,
    );
  const judged = results.filter((j) => j.pass !== undefined);
  console.log(
    `\n${judged.filter((j) => j.pass).length} of ${judged.length} judged results within tolerance.`,
  );
}
writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
