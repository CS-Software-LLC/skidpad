// Browser harness: bundled by Vite into a single IIFE so Playwright can inject
// it into a blank page in Chromium, Firefox, and WebKit.
import { init } from "@skidpad/core/compat";
import { runScenario } from "../src/scenario.js";

declare global {
  interface Window {
    __skidpadDeterminism?: unknown;
  }
}

(async () => {
  try {
    const sp = await init();
    window.__skidpadDeterminism = runScenario(sp, navigator.userAgent);
  } catch (e) {
    window.__skidpadDeterminism = { error: String(e) };
  }
})();
