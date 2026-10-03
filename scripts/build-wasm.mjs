#!/usr/bin/env node
// Builds crates/skidpad-wasm for wasm32-unknown-unknown, optionally runs wasm-opt,
// copies the binary into packages/core/wasm/, and generates the inline
// (base64) module used by the `-compat` build. See ADR-0003.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { installWasm, root, sourceHash, wasmOut } from "./lib/wasm-artifact.mjs";

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
// The core reports the source hash as `Skidpad.simulationVersion`: builds
// from the same sources simulate identically, so a replay checks it rather
// than a version number that may not move when the physics does.
const crateVersion = /\[workspace\.package\][^[]*?\nversion = "([^"]+)"/.exec(
  readFileSync(join(root, "Cargo.toml"), "utf8"),
)?.[1];
if (!crateVersion) throw new Error("[build-wasm] no workspace.package version in Cargo.toml");
const SKIDPAD_BUILD_VERSION = `${crateVersion}+${sourceHash().slice(0, 16)}`;
console.log(`[build-wasm] cargo ${args.join(" ")} (version ${SKIDPAD_BUILD_VERSION})`);
execFileSync("cargo", args, {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, SKIDPAD_BUILD_VERSION },
});

const built = join(root, "target", "wasm32-unknown-unknown", profileDir, "skidpad_wasm.wasm");
let bytes = readFileSync(built);

// Size pass. Never changes semantics: it runs no optimisation passes, only
// re-encodes the module, which drops the padded LEB128 integers the linker
// leaves (about 7 % of the file, 1 % gzipped). `-Os` and `-Oz` shrink the
// raw file further but compress worse, and the budget is on the gzipped
// size. The features are the ones rustc enables for wasm32. Uses the
// binaryen package (a dev dependency), then a wasm-opt on the PATH.
const WASM_FEATURES = [
  "--enable-bulk-memory",
  "--enable-bulk-memory-opt",
  "--enable-nontrapping-float-to-int",
  "--enable-sign-ext",
  "--enable-mutable-globals",
  "--enable-multivalue",
  "--enable-reference-types",
];
let optimised = false;
for (const bin of [join(root, "node_modules", ".bin", "wasm-opt"), "wasm-opt"]) {
  const probe = spawnSync(bin, ["--version"], { stdio: "ignore" });
  if (probe.status === 0) {
    const r = spawnSync(
      bin,
      [...WASM_FEATURES, "--strip-debug", "--strip-producers", built, "-o", built + ".opt"],
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
