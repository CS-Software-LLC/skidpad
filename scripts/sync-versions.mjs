#!/usr/bin/env node
// Copies @skidpad/core's package.json version into packages/core/src/version.ts,
// which `Skidpad.version` reports. Runs after `changeset version`.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "./lib/wasm-artifact.mjs";

const pkg = JSON.parse(readFileSync(join(root, "packages", "core", "package.json"), "utf8"));
const file = join(root, "packages", "core", "src", "version.ts");
const before = readFileSync(file, "utf8");
const after = before.replace(/PACKAGE_VERSION = "[^"]*"/, `PACKAGE_VERSION = "${pkg.version}"`);
if (after !== before) {
  writeFileSync(file, after);
  console.log(`[sync-versions] packages/core/src/version.ts -> ${pkg.version}`);
}
