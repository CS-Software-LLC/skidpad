#!/usr/bin/env node
// Preflight for local development. The apps import the *built* workspace
// packages (packages/*/dist) and the compiled WASM, none of which exist on a
// fresh clone. This script builds whatever is missing and explains what to
// install when it cannot.
//
//   node scripts/ensure-built.mjs          build only what is missing
//   node scripts/ensure-built.mjs --force  rebuild everything (pnpm bootstrap)
//   node scripts/ensure-built.mjs --check  report only, exit 1 if anything is missing (pnpm preflight)
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const force = process.argv.includes("--force");
const checkOnly = process.argv.includes("--check");
const packages = ["core", "presets", "telemetry", "input"];

const problems = [];
const log = (m) => console.log(`[ensure-built] ${m}`);

function has(cmd, args = ["--version"]) {
  const r = spawnSync(cmd, args, { stdio: "pipe", cwd: root });
  return r.status === 0
    ? String(r.stdout || r.stderr)
        .trim()
        .split("\n")[0]
    : null;
}

// 1. Toolchain report.
const node = process.versions.node;
const major = Number(node.split(".")[0]);
log(`node ${node}${major < 20 ? "  <- too old, need 20+" : ""}`);
if (major < 20) problems.push("Node 20 or newer is required (https://nodejs.org).");
const pnpm = has("pnpm");
log(pnpm ? `pnpm ${pnpm}` : "pnpm not found  <- run: corepack enable");
const cargo = has("cargo");
log(cargo ? cargo : "cargo not found  <- Rust is needed to compile the core to WASM");

// 2. WASM artifact (needs Rust).
const wasm = join(root, "packages", "core", "wasm", "contactpatch.wasm");
const inline = join(root, "packages", "core", "src", "generated", "wasm-inline.ts");
const wasmMissing = !existsSync(wasm) || !existsSync(inline);
if (wasmMissing || force) {
  if (checkOnly) {
    problems.push("WASM core not built: run `pnpm build:wasm` (needs Rust).");
  } else if (!cargo) {
    problems.push(
      [
        "The WASM core has not been built and Rust is not installed.",
        "Install Rust with rustup (https://rustup.rs), then re-run this command.",
        "The pinned toolchain and the wasm32-unknown-unknown target install",
        "automatically the first time cargo runs in this repository.",
      ].join("\n  "),
    );
  } else {
    log("building the WASM core (first build takes a minute or two)…");
    const r = spawnSync(process.execPath, [join(root, "scripts", "build-wasm.mjs"), "--release"], {
      stdio: "inherit",
      cwd: root,
    });
    if (r.status !== 0) problems.push("WASM build failed; see the cargo output above.");
  }
} else {
  log("WASM core present");
}

// 3. TypeScript packages.
const missing = packages.filter((p) => !existsSync(join(root, "packages", p, "dist", "index.js")));
if ((missing.length > 0 || force) && !checkOnly && problems.length === 0) {
  log(`building packages: ${(force ? packages : missing).join(", ")}…`);
  try {
    execFileSync("pnpm", ["-r", "--filter", "./packages/**", "run", "build"], {
      stdio: "inherit",
      cwd: root,
    });
  } catch {
    problems.push("TypeScript package build failed; see the tsc output above.");
  }
} else if (missing.length > 0) {
  problems.push(`packages not built (${missing.join(", ")}): run \`pnpm build\`.`);
} else {
  log("packages built");
}

if (problems.length > 0) {
  console.error("\n[ensure-built] cannot continue:\n");
  for (const p of problems) console.error(`  - ${p}\n`);
  process.exit(1);
}
log("ready");
