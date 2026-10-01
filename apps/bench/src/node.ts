import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { init } from "@skidpad/core";
import { formatTable, runAll } from "./bench.js";

const sp = await init();
const report = runAll(sp, `node-${process.versions.node}-${process.platform}-${process.arch}`, () =>
  performance.now(),
);
console.log(formatTable(report));

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "results");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "node-latest.json"), JSON.stringify(report, null, 2));

// Comparison against the committed baseline (apps/bench/baseline). Runner
// speeds vary, so by default this only reports; set BENCH_FAIL_ON_REGRESSION=1
// to fail the run. Refresh the baseline with `pnpm bench -- --update-baseline`
// after a change that is expected to move the numbers.
const baselinePath = join(outDir, "..", "baseline", "node-baseline.json");
const threshold = Number(process.env.BENCH_REGRESSION_THRESHOLD ?? "1.3");
if (process.argv.includes("--update-baseline")) {
  mkdirSync(dirname(baselinePath), { recursive: true });
  writeFileSync(baselinePath, JSON.stringify(report, null, 2) + "\n");
  console.log(`baseline written to ${baselinePath}`);
} else if (existsSync(baselinePath)) {
  const base = JSON.parse(readFileSync(baselinePath, "utf8")) as typeof report;
  console.log(`\nAgainst baseline (${base.platform}, ${base.timestamp}):`);
  let regressions = 0;
  for (const r of report.results) {
    const b = base.results.find((x) => x.label === r.label);
    if (!b) {
      console.log(`  ${r.label}: no baseline`);
      continue;
    }
    const ratio = r.msPerStep / b.msPerStep;
    console.log(
      `  ${r.label}: ${b.msPerStep.toFixed(3)} -> ${r.msPerStep.toFixed(3)} ms (x${ratio.toFixed(2)})`,
    );
    if (ratio > threshold) {
      regressions++;
      console.error(`  regression: ${r.label} is ${ratio.toFixed(2)}x the baseline`);
    }
  }
  if (regressions > 0 && process.env.BENCH_FAIL_ON_REGRESSION === "1") process.exit(1);
}
