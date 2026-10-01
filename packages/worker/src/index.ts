/**
 * @skidpad/worker — run a Skidpad world off the main thread (ADR-0022).
 *
 * ```ts
 * // sim.worker.ts
 * import "@skidpad/worker/entry";
 *
 * // main.ts
 * import { WorkerWorld } from "@skidpad/worker";
 * const worker = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
 * const world = await WorkerWorld.create(worker, { capacity: 50 });
 * const car = await world.addVehicle(def);
 * // each frame
 * world.setInput(car, { throttle: 1 });
 * if (world.stepsInFlight === 0) void world.step(1 / 60);
 * render(world.read(car, "PosX"), world.read(car, "PosY"));
 * ```
 */
export { WorkerWorld } from "./client.js";
export type { WorkerWorldOptions } from "./client.js";
export { serveWorld } from "./serve.js";
export type { ServeOptions } from "./serve.js";
export { CALLABLE, nodeEndpoint } from "./protocol.js";
export type {
  Endpoint,
  NodeMessageTarget,
  Request,
  Response,
  InitResult,
  StepResult,
  Callable,
} from "./protocol.js";
