// Everything both entries export; they differ only in how `init` finds the
// WASM (`index.ts` loads the separate file, `compat.ts` the inlined copy).
export * from "./core.js";
export * from "./definition/types.js";
export { validateDefinition, validateSurfaces } from "./definition/validate.js";
export type { ValidationResult } from "./definition/validate.js";
export {
  migrateDefinition,
  migrateLegacyDrive,
  isCurrentFormat,
  MigrationError,
} from "./definition/migrate.js";
export { ErrorCode, EXPECTED_ABI_VERSION } from "./wasm/abi.js";
export { triangleWave, smoothWave } from "./wave.js";
export { chooseLod, LodController } from "./lod.js";
export type { LodThresholds, LodTarget } from "./lod.js";
export type { CpExports } from "./wasm/abi.js";
export type { WasmSource } from "./wasm/instantiate.js";
export { PACKAGE_VERSION } from "./version.js";
export { CHANNEL_NAMES } from "./channels.js";
export type { ChannelName } from "./channels.js";

import type { WasmSource } from "./wasm/instantiate.js";

export interface InitOptions {
  /**
   * Where to load the WASM from: a URL, a path (Node), bytes, a `Response`,
   * or a compiled `WebAssembly.Module`. Defaults to the file shipped in the
   * package (main entry) or the inlined copy (`/compat`).
   */
  wasm?: WasmSource;
}
