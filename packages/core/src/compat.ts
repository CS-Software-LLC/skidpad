/**
 * `@skidpad/core/compat` — the same API as the main entry, with the WASM
 * inlined as base64 so it works in any bundler without asset configuration
 * (and in a bundled Node server). Costs about a third more download than
 * the separate file. Only `defaultWasmUrl` is missing: referencing the
 * separate file would make bundlers emit it.
 */
import { decodeBase64, instantiateCore } from "./wasm/instantiate.js";
import { Skidpad } from "./core.js";
import { wasmBase64 } from "./generated/wasm-inline.js";
import type { InitOptions } from "./api.js";

export * from "./api.js";

let cached: Promise<Skidpad> | undefined;

/**
 * Load the inlined core. Repeated calls without options share one
 * instance; `options.wasm` loads that module instead.
 */
export function init(options: InitOptions = {}): Promise<Skidpad> {
  if (options.wasm !== undefined) {
    return instantiateCore(options.wasm).then((e) => new Skidpad(e));
  }
  if (!cached) {
    cached = instantiateCore(decodeBase64(wasmBase64)).then((e) => new Skidpad(e));
  }
  return cached;
}
