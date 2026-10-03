import { describe, expect, it } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");

// The documented worker body is a bare `import "@skidpad/worker/entry"`. A
// production bundler drops side-effect-only imports of modules the package
// marks free of side effects, so this bundles it the way an app would.
describe("worker entry in a production bundle", () => {
  it('keeps the side effect of `import "@skidpad/worker/entry"`', async () => {
    const dir = mkdtempSync(join(tmpdir(), "skidpad-worker-bundle-"));
    try {
      mkdirSync(join(dir, "node_modules", "@skidpad"), { recursive: true });
      symlinkSync(pkgDir, join(dir, "node_modules", "@skidpad", "worker"), "dir");
      const entry = join(dir, "sim.worker.js");
      writeFileSync(entry, 'import "@skidpad/worker/entry";\n');
      const result = await build({
        entryPoints: [entry],
        absWorkingDir: dir,
        bundle: true,
        minify: true,
        format: "esm",
        write: false,
        logLevel: "silent",
        external: ["@skidpad/core"],
      });
      const code = result.outputFiles[0]!.text;
      expect(result.warnings.map((w) => w.text)).toEqual([]);
      // serveWorld's listener survives minification as the message hook.
      expect(code).toContain('addEventListener("message"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
