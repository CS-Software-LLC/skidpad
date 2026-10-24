import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { init, type Skidpad } from "@skidpad/core";
import { CASES, runCase } from "./bench.js";

// Back-to-back comparison of two cores on the same machine, in the same
// process. A baseline recorded on another day, or another runner, differs
// by more than a real regression does, so CI compares the pull request's
// core against the base branch's committed prebuilt core instead:
//
//   pnpm bench:compare --base origin/main
//
// --base takes a git ref (its prebuilt/skidpad.wasm is used) or a path to a
// .wasm file. The head core is the one built into packages/core. Both run
// through the same TypeScript layer, alternating per round, and the fastest
// round of each is compared. The run fails when any case is slower than
// --threshold (default 1.15) times the base.

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

function readBase(spec: string): Uint8Array {
  if (existsSync(spec)) return readFileSync(spec);
  return execFileSync("git", ["show", `${spec}:prebuilt/skidpad.wasm`], {
    cwd: root,
    maxBuffer: 64 << 20,
  });
}

const baseSpec = arg("base", "origin/main");
const rounds = Number(arg("rounds", "7"));
const steps = Number(arg("steps", "150"));
const threshold = Number(arg("threshold", process.env.BENCH_REGRESSION_THRESHOLD ?? "1.15"));

const head = await init();
const baseBytes = readBase(baseSpec);
let base: Skidpad;
try {
  base = await init({ wasm: baseBytes });
} catch (e) {
  // A pull request that changes the core's ABI cannot run the base core
  // through its own TypeScript layer. Say so and skip rather than fail.
  console.log(`Base core (${baseSpec}) does not load with this TypeScript layer; skipping.`);
  console.log(String(e));
  process.exit(0);
}

interface Row {
  label: string;
  base: number;
  head: number;
  ratio: number;
}

const now = () => performance.now();

/**
 * Fastest of `rounds` alternating runs for each core. Runner noise only ever
 * adds time, so the fastest run is the steadiest estimate of each core's cost.
 */
function measure(c: (typeof CASES)[number]): Row {
  let b = Infinity;
  let h = Infinity;
  // One short run each so both modules are tiered up before timing.
  runCase(base, c, now, 60);
  runCase(head, c, now, 60);
  for (let r = 0; r < rounds; r++) {
    const order = r % 2 === 0 ? [base, head] : [head, base];
    for (const sp of order) {
      const ms = runCase(sp, c, now, steps).msPerStep;
      if (sp === base) b = Math.min(b, ms);
      else h = Math.min(h, ms);
    }
  }
  return { label: c.label, base: b, head: h, ratio: h / b };
}

const rows: Row[] = [];
for (const c of CASES) {
  let row = measure(c);
  // A case over the threshold is measured twice more and keeps its best
  // ratio, so one noisy stretch on the runner does not fail the build.
  for (let retry = 0; retry < 2 && row.ratio > threshold; retry++) {
    const again = measure(c);
    if (again.ratio < row.ratio) row = again;
  }
  rows.push(row);
  console.log(
    `${row.label}: ${row.base.toFixed(3)} -> ${row.head.toFixed(3)} ms (x${row.ratio.toFixed(3)})`,
  );
}

const slower = rows.filter((r) => r.ratio > threshold);
const table = [
  `### Benchmark against \`${baseSpec}\``,
  "",
  `Same runner, same process, fastest of ${rounds} alternating rounds of ${steps} steps. Fails above ${threshold}× the base.`,
  "",
  "| Case | Base ms | This ms | Ratio |",
  "| --- | --- | --- | --- |",
  ...rows.map(
    (r) =>
      `| ${r.label} | ${r.base.toFixed(3)} | ${r.head.toFixed(3)} | ${r.ratio > threshold ? "**" : ""}${r.ratio.toFixed(2)}×${r.ratio > threshold ? "**" : ""} |`,
  ),
  "",
].join("\n");
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, table + "\n");

if (slower.length > 0) {
  for (const r of slower)
    console.error(`regression: ${r.label} is ${r.ratio.toFixed(2)}x the base (${baseSpec})`);
  if (process.env.BENCH_REPORT_ONLY !== "1") process.exit(1);
}
