#!/usr/bin/env node
// The prebuilt core lets TypeScript-only contributors and users of the dev
// setup work without a Rust toolchain. `prebuilt/manifest.json` records a
// hash of the Rust sources the binary was built from; CI fails when the
// sources change without the prebuilt being refreshed.
//
//   node scripts/prebuilt.mjs --update   build (release) and refresh prebuilt/
//   node scripts/prebuilt.mjs --install  copy prebuilt/ into packages/core (no Rust needed)
//   node scripts/prebuilt.mjs --check    exit 1 if prebuilt/ is stale
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import {
  installWasm,
  prebuiltDir,
  prebuiltManifest,
  prebuiltWasm,
  root,
  sourceHash,
  wasmOut,
} from "./lib/wasm-artifact.mjs";

const mode = process.argv[2];
const log = (m) => console.log(`[prebuilt] ${m}`);

function readManifest() {
  if (!existsSync(prebuiltManifest) || !existsSync(prebuiltWasm)) return null;
  return JSON.parse(readFileSync(prebuiltManifest, "utf8"));
}

if (mode === "--update") {
  execFileSync(
    process.execPath,
    [new URL("./build-wasm.mjs", import.meta.url).pathname, "--release"],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
  const bytes = readFileSync(wasmOut);
  mkdirSync(prebuiltDir, { recursive: true });
  writeFileSync(prebuiltWasm, bytes);
  const version = JSON.parse(
    readFileSync(new URL("../packages/core/package.json", import.meta.url), "utf8"),
  ).version;
  const manifest = {
    sourceHash: sourceHash(),
    coreVersion: version,
    bytes: bytes.length,
    gzipBytes: gzipSync(bytes).length,
    builtAt: new Date().toISOString(),
  };
  writeFileSync(prebuiltManifest, JSON.stringify(manifest, null, 2) + "\n");
  log(`updated prebuilt/skidpad.wasm (${manifest.bytes} bytes, ${manifest.gzipBytes} gzipped)`);
} else if (mode === "--install") {
  const m = readManifest();
  if (!m) {
    console.error(
      "[prebuilt] no prebuilt core in prebuilt/; build it with Rust (`pnpm build:wasm`)",
    );
    process.exit(1);
  }
  const current = sourceHash();
  if (m.sourceHash !== current) {
    console.warn(
      "[prebuilt] warning: the Rust sources changed since prebuilt/ was refreshed; the prebuilt core may be stale. Rebuild with `pnpm prebuilt:update` on a machine with Rust.",
    );
  }
  installWasm(readFileSync(prebuiltWasm));
  log(`installed prebuilt core ${m.coreVersion} (${m.bytes} bytes) into packages/core`);
} else if (mode === "--check") {
  const m = readManifest();
  const current = sourceHash();
  if (!m) {
    console.error("[prebuilt] missing prebuilt/; run `pnpm prebuilt:update`");
    process.exit(1);
  }
  if (m.sourceHash !== current) {
    console.error(
      `[prebuilt] stale: manifest ${m.sourceHash.slice(0, 12)} vs sources ${current.slice(0, 12)}. Run \`pnpm prebuilt:update\` and commit prebuilt/.`,
    );
    process.exit(1);
  }
  log("prebuilt core matches the Rust sources");
} else {
  console.error("usage: prebuilt.mjs --update | --install | --check");
  process.exit(2);
}
