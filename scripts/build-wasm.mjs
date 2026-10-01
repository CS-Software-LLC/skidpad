#!/usr/bin/env node
// Builds crates/skidpad-wasm for wasm32-unknown-unknown, optionally runs wasm-opt,
// copies the binary into packages/core/wasm/, and generates the inline
// (base64) module used by the `-compat` build. See ADR-0003.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { installWasm, root, wasmOut } from "./lib/wasm-artifact.mjs";

const release = process.argv.includes("--release") || process.env.CI === "true";
const profile = release ? "wasm-release" : "dev";
const profileDir = release ? "wasm-release" : "debug";

const args = [
  "build",
  "-p",
  "skidpad-wasm",
  "--target",
  "wasm32-unknown-unknown",
  "--profile",
  profile,
];
console.log(`[build-wasm] cargo ${args.join(" ")}`);
execFileSync("cargo", args, { cwd: root, stdio: "inherit" });

const built = join(root, "target", "wasm32-unknown-unknown", profileDir, "skidpad_wasm.wasm");
let bytes = readFileSync(built);

// Optional size optimisation. Never changes semantics: no fast-math, no
// relaxed SIMD. Looks for a wasm-opt on the PATH, then the binaryen package.
let optimised = false;
for (const bin of ["wasm-opt", join(root, "node_modules", ".bin", "wasm-opt")]) {
  const probe = spawnSync(bin, ["--version"], { stdio: "ignore" });
  if (probe.status === 0) {
    const r = spawnSync(
      bin,
      ["-Os", "--strip-debug", "--strip-producers", built, "-o", built + ".opt"],
      {
        stdio: "inherit",
      },
    );
    if (r.status === 0) {
      bytes = readFileSync(built + ".opt");
      optimised = true;
      break;
    }
  }
}

installWasm(bytes);

const gz = gzipSync(bytes).length;
console.log(
  `[build-wasm] ${profile}: ${statSync(wasmOut).size} bytes (${gz} gzipped)${optimised ? ", wasm-opt applied" : ""} -> packages/core/wasm/skidpad.wasm`,
);
if (release && gz > 200 * 1024) {
  console.error(`[build-wasm] gzipped size ${gz} exceeds the 200 KB budget`);
  process.exit(1);
}
