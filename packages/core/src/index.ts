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
 * package. Use `@skidpad/core/compat` for a build with the WASM inlined;
 * it exports the same API apart from `defaultWasmUrl`.
 *
 * Bundling for Node (a server bundled with esbuild, say): keep
 * `@skidpad/core` external so it loads the WASM from `node_modules`, or use
 * `@skidpad/core/compat`, or pass `init({ wasm })` the path of a copy of
 * `@skidpad/core/wasm`. A bundler that does not carry
 * `new URL(…, import.meta.url)` assets leaves the default path pointing next
 * to the bundle, where there is no WASM.
 */
import { instantiateCore } from "./wasm/instantiate.js";
import { Skidpad } from "./core.js";
import type { InitOptions } from "./api.js";

export * from "./api.js";

/** Default location of the WASM file shipped with the package. */
export function defaultWasmUrl(): URL {
  return new URL("../wasm/skidpad.wasm", import.meta.url);
}

/** Load the core. Call once and share the result. */
export async function init(options: InitOptions = {}): Promise<Skidpad> {
  const exports = await instantiateCore(options.wasm ?? defaultWasmUrl());
  return new Skidpad(exports);
}
