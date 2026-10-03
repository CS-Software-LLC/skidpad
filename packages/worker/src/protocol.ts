/**
 * The message protocol between {@link WorkerWorld} and {@link serveWorld}.
 * Every request carries an id; the worker answers each with the same id,
 * in order.
 */

/** Anything with the `postMessage` / `message` event shape: a `Worker`, `self` inside one, a `MessagePort`. */
export interface Endpoint {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  /** MessagePorts need starting when listened to with `addEventListener`. */
  start?: () => void;
}

/** World methods the worker answers through `call`. */
export const CALLABLE = [
  "addVehicle",
  "setDefinition",
  "resetVehicle",
  "setGroundSlope",
  "setSurfaces",
  "setSurface",
  "setWheelSurface",
  "setLod",
  "lod",
  "setAi",
  "clearAi",
  "aiStatus",
  "snapshot",
  "restore",
  "stateHash",
  "worldHash",
] as const;

export type Callable = (typeof CALLABLE)[number];

export type Request =
  | { id: number; op: "init"; capacity: number; wasm?: unknown }
  | { id: number; op: "call"; method: Callable; args: unknown[] }
  | { id: number; op: "step"; dt: number; count: number; inputs: Float64Array }
  | { id: number; op: "free" };

export interface InitResult {
  version: string;
  capacity: number;
  inputStride: number;
  telemetryStride: number;
  telemetryLayout: { name: string; unit: string }[];
}

export interface StepResult {
  stepCount: number;
  /** The whole telemetry buffer after the step. */
  telemetry: Float64Array;
  /** The inputs the vehicles ran with (path-following drivers write theirs). */
  inputs: Float64Array;
  /** Time the worker spent stepping, ms. */
  stepMs: number;
}

export type Response =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string; code?: number };

/** The `on`/`postMessage` shape of Node's `Worker` and `parentPort`. */
export interface NodeMessageTarget {
  postMessage(message: unknown, transfer?: readonly unknown[]): void;
  on(event: "message", listener: (data: unknown) => void): unknown;
}

/**
 * Adapt a Node `worker_threads` `Worker` (main side) or `parentPort`
 * (worker side) to an {@link Endpoint}, for Node servers and Electron.
 */
export function nodeEndpoint(target: NodeMessageTarget): Endpoint {
  return {
    postMessage: (message, transfer) =>
      target.postMessage(message, transfer as unknown[] | undefined),
    addEventListener: (_type, listener) => {
      target.on("message", (data) => listener({ data }));
    },
  };
}
