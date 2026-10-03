import {
  SkidpadError,
  type AiConfig,
  type LodTarget,
  type AiStatus,
  type Lod,
  type PartialVehicleDefinition,
  type SurfaceDefinition,
  type TelemetryChannel,
  type VehicleInput,
  type Wheel,
} from "@skidpad/core";
import type { Callable, Endpoint, InitResult, Request, Response, StepResult } from "./protocol.js";

export interface WorkerWorldOptions {
  /** Vehicles the world has room for (default 1). */
  capacity?: number;
  /**
   * Where the worker loads the WASM from: a URL string, bytes, or a
   * compiled `WebAssembly.Module` (cloned to the worker, so it compiles
   * once). Default: the file shipped with `@skidpad/core`, resolved inside
   * the worker.
   */
  wasm?: string | ArrayBuffer | Uint8Array | WebAssembly.Module;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void };
/** A request before its id is assigned. */
type Unsent = Request extends infer R ? (R extends { id: number } ? Omit<R, "id"> : never) : never;

/**
 * A world that runs in a worker (ADR-0022). Inputs are written locally and
 * sent with each step; the worker answers with the whole telemetry buffer,
 * which reads then serve synchronously until the next answer. Everything
 * else is asynchronous.
 *
 * Steps run in the order they are asked for, with the inputs as they were
 * when asked, so the result is identical to a world on the main thread.
 * Await each step for lock-step, or keep one in flight and read the last
 * answer for a pipelined frame loop (one frame of latency, no stall).
 */
export class WorkerWorld {
  private nextId = 1;
  private readonly inputs: Float64Array;
  private telemetry: Float64Array;
  private applied: Float64Array;
  private readonly channels: Map<string, number>;
  private steps = 0;
  private inFlight = 0;
  private lastStepMs = 0;
  private count = 0;
  /** Each vehicle's level of detail as last set or read (see {@link lodTarget}). */
  private readonly levels: Lod[] = [];

  private constructor(
    private readonly endpoint: Endpoint,
    private readonly pending: Map<number, Pending>,
    info: InitResult,
  ) {
    this.version = info.version;
    this.capacity = info.capacity;
    this.inputStride = info.inputStride;
    this.telemetryStride = info.telemetryStride;
    this.telemetryLayout = info.telemetryLayout;
    this.channels = new Map(info.telemetryLayout.map((c, i) => [c.name, i]));
    this.inputs = new Float64Array(info.capacity * info.inputStride);
    this.applied = new Float64Array(info.capacity * info.inputStride);
    this.telemetry = new Float64Array(info.capacity * info.telemetryStride);
  }

  readonly version: string;
  readonly capacity: number;
  readonly inputStride: number;
  readonly telemetryStride: number;
  readonly telemetryLayout: readonly TelemetryChannel[];

  /** Start the world in the worker behind `endpoint` (a `Worker`, or a `MessagePort`). */
  static async create(endpoint: Endpoint, options: WorkerWorldOptions = {}): Promise<WorkerWorld> {
    const pending = new Map<number, Pending>();
    endpoint.addEventListener("message", (event) => {
      const res = event.data as Response;
      const p = pending.get(res.id);
      if (!p) return;
      pending.delete(res.id);
      if (res.ok) p.resolve(res.result);
      else p.reject(new SkidpadError(res.error, res.code ?? -3));
    });
    endpoint.start?.();
    const req: Request = { id: 0, op: "init", capacity: options.capacity ?? 1 };
    if (options.wasm !== undefined) req.wasm = options.wasm;
    const info = await new Promise<InitResult>((resolve, reject) => {
      pending.set(0, { resolve: resolve as (v: unknown) => void, reject });
      endpoint.postMessage(req);
    });
    return new WorkerWorld(endpoint, pending, info);
  }

  private send<T>(req: Unsent, transfer: Transferable[] = []): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.endpoint.postMessage({ ...req, id }, transfer);
    });
  }

  private call<T>(method: Callable, ...args: unknown[]): Promise<T> {
    return this.send<T>({ op: "call", method, args });
  }

  /** Vehicles added so far (counted locally). */
  get vehicleCount(): number {
    return this.count;
  }

  /** Steps the worker had taken at its last answer. */
  get stepCount(): number {
    return this.steps;
  }

  /** Steps asked for and not yet answered. */
  get stepsInFlight(): number {
    return this.inFlight;
  }

  /** Time the worker spent in its last step, ms. */
  get workerStepMs(): number {
    return this.lastStepMs;
  }

  // ---- inputs (synchronous, local) -----------------------------------------

  /** Write a vehicle's input; it goes to the worker with the next step. */
  setInput(vehicle: number, input: Partial<VehicleInput>): void {
    const o = vehicle * this.inputStride;
    const f = this.inputs;
    if (input.steer !== undefined) f[o] = input.steer;
    if (input.throttle !== undefined) f[o + 1] = input.throttle;
    if (input.brake !== undefined) f[o + 2] = input.brake;
    if (input.handbrake !== undefined) f[o + 3] = input.handbrake;
    if (input.clutch !== undefined) f[o + 4] = input.clutch;
    if (input.gear !== undefined) f[o + 5] = input.gear;
  }

  /** Local view of a vehicle's input slots. */
  inputView(vehicle: number): Float64Array {
    const o = vehicle * this.inputStride;
    return this.inputs.subarray(o, o + this.inputStride);
  }

  /**
   * The inputs the vehicle ran with in the last answered step, including
   * what a path-following driver wrote.
   */
  appliedInputView(vehicle: number): Float64Array {
    const o = vehicle * this.inputStride;
    return this.applied.subarray(o, o + this.inputStride);
  }

  // ---- telemetry (synchronous, last answer) --------------------------------

  /** Index of a channel by name, or −1. */
  channel(name: string): number {
    return this.channels.get(name) ?? -1;
  }

  /** A vehicle's telemetry at the last answered step. Replaced by each answer. */
  telemetryView(vehicle: number): Float64Array {
    const o = vehicle * this.telemetryStride;
    return this.telemetry.subarray(o, o + this.telemetryStride);
  }

  read(vehicle: number, channel: string): number {
    const i = this.channel(channel);
    if (i < 0) throw new SkidpadError(`unknown telemetry channel "${channel}"`, -2);
    return this.telemetry[vehicle * this.telemetryStride + i] ?? Number.NaN;
  }

  readAll(vehicle: number): Record<string, number> {
    const view = this.telemetryView(vehicle);
    const out: Record<string, number> = {};
    this.telemetryLayout.forEach((c, i) => {
      out[c.name] = view[i] ?? Number.NaN;
    });
    return out;
  }

  // ---- stepping ---------------------------------------------------------------

  /**
   * Ask the worker for `count` steps of `dt` (default one) with the current
   * inputs. Resolves when the answer has replaced the telemetry.
   */
  async step(dt: number, count = 1): Promise<void> {
    this.inFlight++;
    try {
      const res = await this.send<StepResult>({
        op: "step",
        dt,
        count,
        inputs: this.inputs.slice(),
      });
      this.telemetry = res.telemetry;
      this.applied = res.inputs;
      this.steps = res.stepCount;
      this.lastStepMs = res.stepMs;
    } finally {
      this.inFlight--;
    }
  }

  // ---- the world API, asynchronous -------------------------------------------

  async addVehicle(def: PartialVehicleDefinition): Promise<number> {
    const i = await this.call<number>("addVehicle", def);
    this.count = Math.max(this.count, i + 1);
    this.levels[i] = "full";
    return i;
  }

  setDefinition(vehicle: number, def: PartialVehicleDefinition): Promise<void> {
    return this.call("setDefinition", vehicle, def);
  }

  /** As `World.resetVehicle`: `heading` is a yaw angle or a direction `[dx, dy]`. */
  resetVehicle(
    vehicle: number,
    x = 0,
    y = 0,
    heading: number | readonly [number, number] = 0,
  ): Promise<void> {
    return this.call("resetVehicle", vehicle, x, y, heading);
  }

  setGroundSlope(vehicle: number, grade: number, cross = 0): Promise<void> {
    return this.call("setGroundSlope", vehicle, grade, cross);
  }

  setSurfaces(surfaces: ReadonlyArray<Partial<SurfaceDefinition>>): Promise<void> {
    return this.call("setSurfaces", surfaces);
  }

  setSurface(vehicle: number, surfaceId: number): Promise<void> {
    return this.call("setSurface", vehicle, surfaceId);
  }

  setWheelSurface(vehicle: number, wheel: Wheel, surfaceId: number): Promise<void> {
    return this.call("setWheelSurface", vehicle, wheel, surfaceId);
  }

  async setLod(vehicle: number, lod: Lod, substepRateHz = 0): Promise<void> {
    const before = this.levels[vehicle];
    this.levels[vehicle] = lod;
    try {
      await this.call("setLod", vehicle, lod, substepRateHz);
    } catch (e) {
      if (this.levels[vehicle] === lod) this.levels[vehicle] = before ?? "full";
      throw e;
    }
  }

  async lod(vehicle: number): Promise<Lod> {
    const lod = await this.call<Lod>("lod", vehicle);
    this.levels[vehicle] = lod;
    return lod;
  }

  /**
   * A synchronous {@link LodTarget} over this world, for a `LodController`.
   * It reads each vehicle's level as this client last set it (or read it,
   * or restored it) and sends changes to the worker without waiting; they
   * apply before the next step, since requests run in order. A change the
   * worker refuses is reported to `onError` (default: `console.error`) and
   * the local level reverts.
   */
  get lodTarget(): LodTarget {
    const count = () => this.count;
    return (this.lodTargetValue ??= {
      get vehicleCount() {
        return count();
      },
      lod: (vehicle: number) => this.levels[vehicle] ?? "full",
      setLod: (vehicle: number, lod: Lod, substepRateHz = 0) => {
        this.setLod(vehicle, lod, substepRateHz).catch((e: unknown) => this.onLodError(e));
      },
    });
  }

  /** Called when a change sent through {@link lodTarget} fails. */
  onLodError: (error: unknown) => void = (e) => console.error(e);

  private lodTargetValue: LodTarget | undefined;

  setAi(
    vehicle: number,
    path: ArrayLike<number> | ReadonlyArray<readonly [number, number]>,
    config: AiConfig = {},
  ): Promise<void> {
    // Typed arrays and arrays of pairs both clone to the worker.
    return this.call("setAi", vehicle, path, config);
  }

  clearAi(vehicle: number): Promise<void> {
    return this.call("clearAi", vehicle);
  }

  aiStatus(vehicle: number): Promise<AiStatus | null> {
    return this.call("aiStatus", vehicle);
  }

  snapshot(vehicle: number): Promise<Uint8Array> {
    return this.call("snapshot", vehicle);
  }

  async restore(vehicle: number, bytes: Uint8Array): Promise<void> {
    await this.call("restore", vehicle, bytes);
    // A snapshot taken at the other level of detail switches the vehicle's level.
    await this.lod(vehicle);
  }

  stateHash(vehicle: number): Promise<string> {
    return this.call("stateHash", vehicle);
  }

  worldHash(): Promise<string> {
    return this.call("worldHash");
  }

  /** Free the world inside the worker. The worker itself stays yours to terminate. */
  free(): Promise<void> {
    return this.send({ op: "free" });
  }
}
