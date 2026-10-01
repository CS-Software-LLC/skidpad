/**
 * `@skidpad/core/compat` — same API as the main entry, with the WASM
 * inlined as base64 so it works in any bundler without asset configuration.
 * Costs about a third more download than the separate file.
 */
import { decodeBase64, instantiateCore } from "./wasm/instantiate.js";
import { Skidpad } from "./core.js";
import { wasmBase64 } from "./generated/wasm-inline.js";

export * from "./core.js";
export * from "./definition/types.js";
export { validateDefinition } from "./definition/validate.js";
export type { ValidationResult } from "./definition/validate.js";
export { migrateDefinition, isCurrentFormat, MigrationError } from "./definition/migrate.js";
export { ErrorCode, EXPECTED_ABI_VERSION } from "./wasm/abi.js";
export { triangleWave, smoothWave } from "./wave.js";

let cached: Promise<Skidpad> | undefined;

/** Load the inlined core. Repeated calls share one instance. */
export function init(): Promise<Skidpad> {
  if (!cached) {
    cached = instantiateCore(decodeBase64(wasmBase64)).then((e) => new Skidpad(e));
  }
  return cached;
}
