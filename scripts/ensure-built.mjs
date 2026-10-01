#!/usr/bin/env node
// Preflight for local development. The apps import the *built* workspace
// packages (packages/*/dist) and the compiled WASM, none of which exist on a
// fresh clone. This script builds whatever is missing or stale (sources newer
// than their build, as after a `git pull`) and explains what to install when
// it cannot.
//
//   node scripts/ensure-built.mjs          build only what is missing or stale
//   node scripts/ensure-built.mjs --force  rebuild everything (pnpm bootstrap)
//   node scripts/ensure-built.mjs --check  report only, exit 1 if anything is missing or stale (pnpm preflight)
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const force = process.argv.includes("--force");
const checkOnly = process.argv.includes("--check");
const packages = ["core", "presets", "telemetry", "input", "rapier"];

const problems = [];
const log = (m) => console.log(`[ensure-built] ${m}`);

/** Newest modification time (ms) under a path, skipping build output. */
function newestMtime(path) {
  if (!existsSync(path)) return 0;
  const st = statSync(path);
  if (st.isFile()) return st.mtimeMs;
  let newest = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (["node_modules", "dist", "target", ".vitepress"].includes(entry.name)) continue;
    newest = Math.max(newest, newestMtime(join(path, entry.name)));
  }
  return newest;
}

const mtime = (path) => (existsSync(path) ? statSync(path).mtimeMs : 0);

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
log(cargo ? cargo : "cargo not found  <- fine for TypeScript work; the prebuilt core will be used");

// 2. WASM artifact (needs Rust).
const wasm = join(root, "packages", "core", "wasm", "skidpad.wasm");
const inline = join(root, "packages", "core", "src", "generated", "wasm-inline.ts");
const prebuilt = join(root, "prebuilt", "skidpad.wasm");
const wasmMissing = !existsSync(wasm) || !existsSync(inline);
// Stale: with Rust, the crates changed after the last build; without it, the
// committed prebuilt core is newer (or a different size) than the installed one.
const wasmStale =
  !wasmMissing &&
  (cargo && process.env.SKIDPAD_USE_PREBUILT !== "1"
    ? newestMtime(join(root, "crates")) > mtime(wasm)
    : mtime(prebuilt) > mtime(wasm) || statSync(prebuilt).size !== statSync(wasm).size);
if (wasmStale) log("WASM core is older than its sources");
if (wasmMissing || wasmStale || force) {
  if (checkOnly) {
    problems.push(
      wasmMissing
        ? "WASM core not installed: run `pnpm bootstrap` (uses Rust if present, else the prebuilt core)."
        : "WASM core is stale: run `pnpm bootstrap` (rebuilds with Rust if present, else reinstalls the prebuilt core).",
    );
  } else if (!cargo || process.env.SKIDPAD_USE_PREBUILT === "1") {
    log(
      cargo
        ? "using the prebuilt core (SKIDPAD_USE_PREBUILT=1)"
        : "Rust not installed: using the prebuilt core from prebuilt/",
    );
    const r = spawnSync(process.execPath, [join(root, "scripts", "prebuilt.mjs"), "--install"], {
      stdio: "inherit",
      cwd: root,
    });
    if (r.status !== 0) {
      problems.push(
        [
          "No usable prebuilt core and Rust is not installed.",
          "Install Rust with rustup (https://rustup.rs), then re-run this command.",
          "The pinned toolchain and the wasm32-unknown-unknown target install",
          "automatically the first time cargo runs in this repository.",
        ].join("\n  "),
      );
    }
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

// 3. TypeScript packages: missing, or with sources newer than their build.
const missing = packages.filter((p) => !existsSync(join(root, "packages", p, "dist", "index.js")));
const stale = packages.filter((p) => {
  const dir = join(root, "packages", p);
  const built = mtime(join(dir, "dist", "index.js"));
  return (
    built > 0 && Math.max(newestMtime(join(dir, "src")), mtime(join(dir, "package.json"))) > built
  );
});
if (stale.length > 0) log(`packages older than their sources: ${stale.join(", ")}`);
const toBuild = force ? packages : [...missing, ...stale];
if (toBuild.length > 0 && !checkOnly && problems.length === 0) {
  log(`building packages: ${toBuild.join(", ")}…`);
  try {
    execFileSync("pnpm", ["-r", "--filter", "./packages/**", "run", "build"], {
      stdio: "inherit",
      cwd: root,
    });
  } catch {
    problems.push("TypeScript package build failed; see the tsc output above.");
  }
} else if (toBuild.length > 0) {
  problems.push(
    `packages ${missing.length > 0 ? "not built" : "stale"} (${toBuild.join(", ")}): run \`pnpm build\`.`,
  );
} else {
  log("packages built");
}

if (problems.length > 0) {
  console.error("\n[ensure-built] cannot continue:\n");
  for (const p of problems) console.error(`  - ${p}\n`);
  process.exit(1);
}
log("ready");
