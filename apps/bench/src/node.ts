import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { init } from "@contactpatch/core";
import { formatTable, runAll } from "./bench.js";

const cp = await init();
const report = runAll(cp, `node-${process.versions.node}-${process.platform}-${process.arch}`, () =>
  performance.now(),
);
console.log(formatTable(report));

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "results");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "node-latest.json"), JSON.stringify(report, null, 2));

// Regression flag against a baseline committed by CI (if present).
const baselinePath = join(outDir, "node-baseline.json");
const threshold = Number(process.env.BENCH_REGRESSION_THRESHOLD ?? "1.3");
if (existsSync(baselinePath)) {
  const base = JSON.parse(readFileSync(baselinePath, "utf8")) as typeof report;
  let regressions = 0;
  for (const r of report.results) {
    const b = base.results.find((x) => x.label === r.label);
    if (b && r.msPerStep > b.msPerStep * threshold) {
      regressions++;
      console.error(
        `regression: ${r.label}: ${b.msPerStep.toFixed(3)} -> ${r.msPerStep.toFixed(3)} ms`,
      );
    }
  }
  if (regressions > 0 && process.env.BENCH_FAIL_ON_REGRESSION === "1") process.exit(1);
}
