// Browser harness: bundled by Vite into a single IIFE so Playwright can inject
// it into a blank page in Chromium, Firefox, and WebKit.
import { init } from "@contactpatch/core/compat";
import { runScenario } from "../src/scenario.js";

declare global {
  interface Window {
    __cpDeterminism?: unknown;
  }
}

(async () => {
  try {
    const cp = await init();
    window.__cpDeterminism = runScenario(cp, navigator.userAgent);
  } catch (e) {
    window.__cpDeterminism = { error: String(e) };
  }
})();
