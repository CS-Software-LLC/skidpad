import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { init } from "@skidpad/core";
import { runScenario } from "./scenario.js";

const sp = await init();
const report = runScenario(sp, `node-${process.versions.node}-${process.arch}`);
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "out");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "node.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
