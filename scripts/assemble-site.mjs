#!/usr/bin/env node
// Assembles the public site: sandbox, docs, benchmark dashboard, and the
// validation report. Keeps a rolling benchmark history by fetching the
// previously published results from the live site when available.
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const site = join(root, "site");
mkdirSync(site, { recursive: true });

cpSync(join(root, "apps", "sandbox", "dist"), join(site, "sandbox"), { recursive: true });
cpSync(join(root, "apps", "docs", ".vitepress", "dist"), join(site, "docs"), { recursive: true });
cpSync(join(root, "apps", "bench", "dist"), join(site, "bench"), { recursive: true });

// Validation report.
execFileSync("pnpm", ["--filter", "@skidpad/validate", "run", "validate"], {
  cwd: root,
  stdio: "inherit",
});
mkdirSync(join(site, "validation"), { recursive: true });
cpSync(
  join(root, "tools", "validate", "out", "results.json"),
  join(site, "validation", "results.json"),
);

// Benchmark: run, then merge with history from the live site.
execFileSync("pnpm", ["--filter", "@skidpad/bench", "run", "bench:node"], {
  cwd: root,
  stdio: "inherit",
});
const latest = JSON.parse(
  readFileSync(join(root, "apps", "bench", "results", "node-latest.json"), "utf8"),
);
const resultsDir = join(site, "bench", "results");
mkdirSync(resultsDir, { recursive: true });
let index = [];
const siteUrl = process.env.SITE_URL;
if (siteUrl) {
  try {
    const res = await fetch(`${siteUrl}/bench/results/index.json`);
    if (res.ok) {
      index = await res.json();
      for (const f of index) {
        const r = await fetch(`${siteUrl}/bench/results/${f}`);
        if (r.ok) writeFileSync(join(resultsDir, f), await r.text());
      }
    }
  } catch (e) {
    console.warn(`[assemble-site] no previous benchmark history: ${e}`);
  }
}
const sha = (process.env.GITHUB_SHA ?? "local").slice(0, 10);
const name = `${latest.timestamp.replace(/[:.]/g, "-")}-${sha}.json`;
writeFileSync(join(resultsDir, name), JSON.stringify({ ...latest, commit: sha }, null, 2));
index = [name, ...index.filter((f) => f !== name)].slice(0, 200);
writeFileSync(join(resultsDir, "index.json"), JSON.stringify(index, null, 2));

writeFileSync(
  join(site, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>Skidpad</title>
<style>body{font:16px/1.5 system-ui;max-width:720px;margin:4rem auto;padding:0 1rem}</style>
<h1>Skidpad</h1><p>Deterministic, sim-grade vehicle physics for the web.</p>
<ul><li><a href="sandbox/">Sandbox</a></li><li><a href="docs/">Documentation</a></li><li><a href="bench/">Benchmarks</a></li><li><a href="validation/results.json">Validation results (JSON)</a></li></ul>
<p>Built from commit <code>${sha}</code>. ${existsSync(join(root, "CHANGELOG.md")) ? '<a href="https://github.com/csummers88/skidpad/blob/main/CHANGELOG.md">Changelog</a>' : ""}</p>`,
);
console.log(`[assemble-site] site assembled in ${site}`);
