import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { init } from "@contactpatch/core";
import { init as initCompat } from "@contactpatch/core/compat";
import { runScenario } from "./scenario.js";

const pinned = readFileSync(
  fileURLToPath(new URL("../../../crates/cp-math/selftest.hash", import.meta.url)),
  "utf8",
).trim();

describe("determinism in Node", () => {
  it("the scripted scenario hashes identically on repeated runs and across builds", async () => {
    const cp = await init();
    const a = runScenario(cp, "node");
    const b = runScenario(cp, "node");
    expect(a.worldHash).toBe(b.worldHash);
    expect(a.checkpoints).toEqual(b.checkpoints);
    expect(a.mathSelftestHash).toBe(pinned);
    const compat = await initCompat();
    const c = runScenario(compat, "node-compat");
    expect(c.worldHash).toBe(a.worldHash);
  });
});
