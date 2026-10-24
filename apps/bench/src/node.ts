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

// Drift from the committed baseline (apps/bench/baseline). The baseline was
// recorded on one CI runner on one day, and runners differ by more than a
// real regression, so this only reports. The gate that fails a pull request
// is `pnpm bench:compare`, which runs the base branch's core and this one
// back to back on the same machine. Refresh the baseline with
// `pnpm bench -- --update-baseline` after a change that moves the numbers.
const baselinePath = join(outDir, "..", "baseline", "node-baseline.json");
if (process.argv.includes("--update-baseline")) {
  mkdirSync(dirname(baselinePath), { recursive: true });
  writeFileSync(baselinePath, JSON.stringify(report, null, 2) + "\n");
  console.log(`baseline written to ${baselinePath}`);
} else if (existsSync(baselinePath)) {
  const base = JSON.parse(readFileSync(baselinePath, "utf8")) as typeof report;
  console.log(
    `\nAgainst the recorded baseline (${base.platform}, ${base.timestamp}; another machine, for reference only):`,
  );
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
  }
}
