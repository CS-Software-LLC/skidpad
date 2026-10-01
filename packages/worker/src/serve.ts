import { init, type InitOptions, type Skidpad, type World } from "@skidpad/core";
import {
  CALLABLE,
  type Endpoint,
  type Request,
  type Response,
  type StepResult,
} from "./protocol.js";

export interface ServeOptions {
  /** Load the core yourself (for the compat build, or a shared instance). */
  load?: (wasm: unknown) => Promise<Skidpad>;
}

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * Answer a {@link WorkerWorld} on `endpoint`: call this inside the worker.
 *
 * ```ts
 * // sim.worker.ts
 * import { serveWorld } from "@skidpad/worker";
 * serveWorld(self);
 * ```
 */
export function serveWorld(endpoint: Endpoint, options: ServeOptions = {}): void {
  let sp: Skidpad | undefined;
  let world: World | undefined;
  // Requests run strictly in order, also across the async init.
  let queue: Promise<void> = Promise.resolve();

  const reply = (msg: Response, transfer: Transferable[] = []) =>
    endpoint.postMessage(msg, transfer);

  const handle = async (req: Request): Promise<void> => {
    try {
      switch (req.op) {
        case "init": {
          if (world) throw new Error("the worker already holds a world");
          const opts: InitOptions = {};
          if (req.wasm !== undefined) opts.wasm = req.wasm as NonNullable<InitOptions["wasm"]>;
          sp = options.load ? await options.load(req.wasm) : await init(opts);
          world = sp.createWorld(req.capacity);
          reply({
            id: req.id,
            ok: true,
            result: {
              version: sp.version,
              capacity: world.capacity,
              inputStride: sp.inputStride,
              telemetryStride: sp.telemetryStride,
              telemetryLayout: [...sp.telemetryLayout],
            },
          });
          return;
        }
        case "call": {
          if (!world) throw new Error("the worker has no world yet");
          if (!(CALLABLE as readonly string[]).includes(req.method)) {
            throw new Error(`"${String(req.method)}" cannot be called on a worker world`);
          }
          const fn = (world as unknown as Record<string, (...a: unknown[]) => unknown>)[
            req.method
          ]!;
          const result = fn.apply(world, req.args);
          const transfer = result instanceof Uint8Array ? [result.buffer as ArrayBuffer] : [];
          reply({ id: req.id, ok: true, result }, transfer);
          return;
        }
        case "step": {
          if (!world) throw new Error("the worker has no world yet");
          world.inputBuffer().set(req.inputs);
          const t0 = now();
          if (req.count === 1) world.step(req.dt);
          else world.stepMany(req.dt, req.count);
          const stepMs = now() - t0;
          const result: StepResult = {
            stepCount: world.stepCount,
            telemetry: world.telemetryBuffer().slice(),
            inputs: world.inputBuffer().slice(),
            stepMs,
          };
          reply({ id: req.id, ok: true, result }, [
            result.telemetry.buffer as ArrayBuffer,
            result.inputs.buffer as ArrayBuffer,
          ]);
          return;
        }
        case "free": {
          world?.free();
          world = undefined;
          reply({ id: req.id, ok: true, result: null });
          return;
        }
      }
    } catch (e) {
      const err = e as { message?: string; code?: number };
      const msg: Response = { id: req.id, ok: false, error: err.message ?? String(e) };
      if (typeof err.code === "number") msg.code = err.code;
      reply(msg);
    }
  };

  endpoint.addEventListener("message", (event) => {
    const req = event.data as Request;
    queue = queue.then(() => handle(req));
  });
  endpoint.start?.();
}
