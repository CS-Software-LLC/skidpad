/**
 * @skidpad/core — deterministic vehicle physics for the web.
 *
 * ```ts
 * import { init } from "@skidpad/core";
 * const sp = await init();
 * const world = sp.createWorld(1);
 * const car = world.addVehicle({ name: "demo" });
 * world.setInput(car, { throttle: 1 });
 * world.step(1 / 60);
 * console.log(world.read(car, "Speed"));
 * ```
 *
 * This entry loads `skidpad.wasm` as a separate file next to the
 * package. Use `@skidpad/core/compat` for a build with the WASM inlined.
 */
import type { WasmSource } from "./wasm/instantiate.js";
import { instantiateCore } from "./wasm/instantiate.js";
import { Skidpad } from "./core.js";

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
export type { LodThresholds } from "./lod.js";
export type { CpExports } from "./wasm/abi.js";
export type { WasmSource } from "./wasm/instantiate.js";

export interface InitOptions {
  /** Where to load the WASM from. Defaults to the file shipped in the package. */
  wasm?: WasmSource;
}

/** Default location of the WASM file shipped with the package. */
export function defaultWasmUrl(): URL {
  return new URL("../wasm/skidpad.wasm", import.meta.url);
}

/** Load the core. Call once and share the result. */
export async function init(options: InitOptions = {}): Promise<Skidpad> {
  const exports = await instantiateCore(options.wasm ?? defaultWasmUrl());
  return new Skidpad(exports);
}
