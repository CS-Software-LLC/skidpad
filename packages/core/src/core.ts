import type { CpExports } from "./wasm/abi.js";
import { ErrorCode, EXPECTED_ABI_VERSION } from "./wasm/abi.js";
import type {
  VehicleDefinition,
  PartialVehicleDefinition,
  TireDefinition,
  MagicFormulaParams,
} from "./definition/types.js";
import { validateDefinition } from "./definition/validate.js";

/** Thrown for any error reported by the core. */
export class ContactPatchError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
  ) {
    super(message);
    this.name = "ContactPatchError";
  }
}

/** Normalised driver input. All values are clamped by the core. */
export interface VehicleInput {
  /** −1 (full left) … +1 (full right). */
  steer: number;
  /** 0 … 1. */
  throttle: number;
  /** 0 … 1. */
  brake: number;
  /** 0 … 1. */
  handbrake: number;
}

export interface TelemetryChannel {
  name: string;
  unit: string;
}

export interface TireInput {
  fz: number;
  slipRatio: number;
  slipAngle: number;
  camber?: number;
  vx?: number;
}

export interface TireOutput {
  fx: number;
  fy: number;
  mz: number;
  mx: number;
  my: number;
  trail: number;
  fxMax: number;
  fyMax: number;
}

export interface TirWarning {
  section: string;
  key: string;
  message: string;
}

export interface TirImport {
  params: MagicFormulaParams;
  warnings: TirWarning[];
}

export interface UndersteerConfig {
  radius?: number;
  speeds?: number[];
  settleTime?: number;
  measureTime?: number;
  hostDt?: number;
}

export interface UndersteerPoint {
  targetSpeed: number;
  speed: number;
  steerAngle: number;
  latAccel: number;
  yawRate: number;
  frontSlipAngle: number;
  rearSlipAngle: number;
}

export interface UndersteerResult {
  points: UndersteerPoint[];
  ackermannAngle: number;
  fittedIntercept: number;
  gradient: number;
  gradientDegPerG: number;
  analyticGradient: number;
  analyticGradientDegPerG: number;
}

export interface StraightLineConfig {
  targetSpeed?: number;
  maxAccelTime?: number;
  hostDt?: number;
}

export interface StraightLineResult {
  accelTime: number | null;
  accelDistance: number | null;
  quarterMileTime: number | null;
  brakingDistance: number;
  brakingTime: number;
  meanDeceleration: number;
  wheelLocked: boolean;
}

export type ScenarioRequest =
  | {
      scenario: "understeerGradient";
      definition: PartialVehicleDefinition;
      config?: UndersteerConfig;
    }
  | { scenario: "straightLine"; definition: PartialVehicleDefinition; config?: StraightLineConfig };

export type ScenarioResult<R extends ScenarioRequest> = R extends { scenario: "understeerGradient" }
  ? UndersteerResult
  : StraightLineResult;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Format a WASM i64 (signed BigInt) as the unsigned 16-digit hex the core uses. */
function hex64(v: bigint): string {
  return BigInt.asUintN(64, v).toString(16).padStart(16, "0");
}

/**
 * A loaded core module. Create one with {@link init}. Owns the memory views
 * and refreshes them when WASM memory grows.
 */
export class ContactPatch {
  private buffer: ArrayBufferLike;
  private u8: Uint8Array;
  private f64: Float64Array;
  private readonly tireScratchPtr: number;
  private readonly tireOutStride: number;
  readonly version: string;
  readonly inputStride: number;
  readonly telemetryStride: number;
  readonly telemetryLayout: readonly TelemetryChannel[];
  private readonly channelIndex: Map<string, number>;

  /** @internal */
  constructor(readonly exports: CpExports) {
    const abi = exports.cp_abi_version();
    if (abi !== EXPECTED_ABI_VERSION) {
      throw new ContactPatchError(
        `core ABI version ${abi} does not match this loader (${EXPECTED_ABI_VERSION}); rebuild the WASM`,
        ErrorCode.InvalidHandle,
      );
    }
    this.buffer = exports.memory.buffer;
    this.u8 = new Uint8Array(this.buffer);
    this.f64 = new Float64Array(this.buffer);
    this.version = this.readString(exports.cp_version_ptr(), exports.cp_version_len());
    this.inputStride = exports.cp_input_stride();
    this.telemetryStride = exports.cp_telemetry_stride();
    this.telemetryLayout = JSON.parse(
      this.readString(exports.cp_telemetry_layout_ptr(), exports.cp_telemetry_layout_len()),
    ) as TelemetryChannel[];
    this.channelIndex = new Map(this.telemetryLayout.map((c, i) => [c.name, i]));
    this.tireOutStride = exports.cp_tire_out_stride();
    this.tireScratchPtr = exports.cp_alloc(this.tireOutStride * 8 * 1024);
  }

  /** Refresh typed-array views if the memory grew. Cheap; call before reads. */
  refresh(): void {
    if (this.buffer !== this.exports.memory.buffer) {
      this.buffer = this.exports.memory.buffer;
      this.u8 = new Uint8Array(this.buffer);
      this.f64 = new Float64Array(this.buffer);
    }
  }

  /** @internal */
  bytes(): Uint8Array {
    this.refresh();
    return this.u8;
  }

  /** @internal */
  floats(): Float64Array {
    this.refresh();
    return this.f64;
  }

  /** @internal */
  readString(ptr: number, len: number): string {
    this.refresh();
    return decoder.decode(this.u8.subarray(ptr, ptr + len));
  }

  /** @internal Allocate and write a UTF-8 string. Caller frees. */
  writeString(s: string): { ptr: number; len: number } {
    const bytes = encoder.encode(s);
    const ptr = this.exports.cp_alloc(bytes.length);
    this.refresh();
    this.u8.set(bytes, ptr);
    return { ptr, len: bytes.length };
  }

  /** @internal */
  free(ptr: number, len: number): void {
    this.exports.cp_free(ptr, len);
  }

  /** @internal */
  lastError(): string {
    return this.readString(this.exports.cp_last_error_ptr(), this.exports.cp_last_error_len());
  }

  /** @internal */
  result(): string {
    return this.readString(this.exports.cp_result_ptr(), this.exports.cp_result_len());
  }

  /** @internal */
  check(code: number): number {
    if (code < 0) throw new ContactPatchError(this.lastError(), code as ErrorCode);
    return code;
  }

  /**
   * Hash of the deterministic math self-test (ADR-0006). Identical on every
   * platform; the pinned value lives in `crates/cp-math/selftest.hash`.
   */
  mathSelftestHash(): string {
    return hex64(this.exports.cp_math_selftest());
  }

  /** Index of a telemetry channel by name, or −1. */
  channel(name: string): number {
    return this.channelIndex.get(name) ?? -1;
  }

  /** The core's default definition with every field filled in. */
  defaultDefinition(): VehicleDefinition {
    this.check(this.exports.cp_default_definition());
    return JSON.parse(this.result()) as VehicleDefinition;
  }

  /** Create a world with room for `capacity` vehicles. */
  createWorld(capacity = 1): World {
    return new World(this, this.exports.cp_world_new(capacity));
  }

  /** Create a standalone tire for curve exploration. */
  createTire(def: TireDefinition): Tire {
    const { ptr, len } = this.writeString(JSON.stringify(def));
    try {
      const handle = this.check(this.exports.cp_tire_new(ptr, len));
      return new Tire(this, handle, this.tireScratchPtr, this.tireOutStride);
    } finally {
      this.free(ptr, len);
    }
  }

  /** Parse a Magic Formula `.tir` file into parameters plus warnings. */
  importTir(text: string): TirImport {
    const { ptr, len } = this.writeString(text);
    try {
      this.check(this.exports.cp_tir_import(ptr, len));
      const raw = JSON.parse(this.result()) as {
        params: Record<string, number>;
        warnings: TirWarning[];
      };
      return { params: { ...raw.params, model: "magicFormula" }, warnings: raw.warnings };
    } finally {
      this.free(ptr, len);
    }
  }

  /** Run a validation scenario headlessly. */
  runScenario<R extends ScenarioRequest>(request: R): ScenarioResult<R> {
    const { ptr, len } = this.writeString(JSON.stringify(request));
    try {
      this.check(this.exports.cp_run_scenario(ptr, len));
      return JSON.parse(this.result()) as ScenarioResult<R>;
    } finally {
      this.free(ptr, len);
    }
  }
}

/** A set of vehicles stepped together. */
export class World {
  private freed = false;
  private readonly inputsPtr: number;
  private readonly telemetryPtr: number;
  readonly capacity: number;

  /** @internal */
  constructor(
    private readonly cp: ContactPatch,
    readonly handle: number,
  ) {
    this.capacity = cp.exports.cp_world_capacity(handle);
    this.inputsPtr = cp.exports.cp_world_inputs_ptr(handle);
    this.telemetryPtr = cp.exports.cp_world_telemetry_ptr(handle);
  }

  get vehicleCount(): number {
    return this.cp.exports.cp_world_vehicle_count(this.handle);
  }

  get stepCount(): number {
    return Number(this.cp.exports.cp_world_step_count(this.handle));
  }

  /**
   * Validate and add a vehicle. Partial definitions are completed with the
   * core defaults. Returns the vehicle index.
   */
  addVehicle(def: PartialVehicleDefinition): number {
    const v = validateDefinition(def);
    if (!v.ok) throw new ContactPatchError(v.errors.join("; "), ErrorCode.InvalidDefinition);
    const { ptr, len } = this.cp.writeString(JSON.stringify(def));
    try {
      return this.cp.check(this.cp.exports.cp_world_add_vehicle(this.handle, ptr, len));
    } finally {
      this.cp.free(ptr, len);
    }
  }

  /** Replace a vehicle's definition in place, keeping its state (live tuning). */
  setDefinition(vehicle: number, def: PartialVehicleDefinition): void {
    const v = validateDefinition(def);
    if (!v.ok) throw new ContactPatchError(v.errors.join("; "), ErrorCode.InvalidDefinition);
    const { ptr, len } = this.cp.writeString(JSON.stringify(def));
    try {
      this.cp.check(this.cp.exports.cp_world_set_definition(this.handle, vehicle, ptr, len));
    } finally {
      this.cp.free(ptr, len);
    }
  }

  /** Write a vehicle's input. No allocation. */
  setInput(vehicle: number, input: Partial<VehicleInput>): void {
    const f = this.cp.floats();
    const o = this.inputsPtr / 8 + vehicle * this.cp.inputStride;
    if (input.steer !== undefined) f[o] = input.steer;
    if (input.throttle !== undefined) f[o + 1] = input.throttle;
    if (input.brake !== undefined) f[o + 2] = input.brake;
    if (input.handbrake !== undefined) f[o + 3] = input.handbrake;
  }

  /** Live view of a vehicle's input slots (`[steer, throttle, brake, handbrake]`). */
  inputView(vehicle: number): Float64Array {
    const o = this.inputsPtr / 8 + vehicle * this.cp.inputStride;
    return this.cp.floats().subarray(o, o + this.cp.inputStride);
  }

  /**
   * Live view of a vehicle's telemetry record. The view is valid until WASM
   * memory grows; re-fetch it after adding vehicles or creating worlds.
   */
  telemetryView(vehicle: number): Float64Array {
    const o = this.telemetryPtr / 8 + vehicle * this.cp.telemetryStride;
    return this.cp.floats().subarray(o, o + this.cp.telemetryStride);
  }

  /** Read one telemetry channel by name. */
  read(vehicle: number, channel: string): number {
    const i = this.cp.channel(channel);
    if (i < 0)
      throw new ContactPatchError(`unknown telemetry channel "${channel}"`, ErrorCode.InvalidJson);
    return this.cp.floats()[this.telemetryPtr / 8 + vehicle * this.cp.telemetryStride + i] ?? NaN;
  }

  /** Copy a vehicle's telemetry into a plain object keyed by channel name. */
  readAll(vehicle: number): Record<string, number> {
    const view = this.telemetryView(vehicle);
    const out: Record<string, number> = {};
    this.cp.telemetryLayout.forEach((c, i) => {
      out[c.name] = view[i] ?? NaN;
    });
    return out;
  }

  /** Advance every vehicle by one host step of `dt` seconds. */
  step(dt: number): void {
    this.cp.check(this.cp.exports.cp_world_step(this.handle, dt));
  }

  /** Per-vehicle state hash as a 16-hex-digit string. */
  stateHash(vehicle: number): string {
    return hex64(this.cp.exports.cp_world_state_hash(this.handle, vehicle));
  }

  /** Hash of every vehicle plus the step count. */
  worldHash(): string {
    return hex64(this.cp.exports.cp_world_hash(this.handle));
  }

  resetVehicle(vehicle: number, x = 0, y = 0, yaw = 0): void {
    this.cp.check(this.cp.exports.cp_world_reset_vehicle(this.handle, vehicle, x, y, yaw));
  }

  /** Versioned binary snapshot of one vehicle's full state. */
  snapshot(vehicle: number): Uint8Array {
    const len = this.cp.check(this.cp.exports.cp_world_snapshot_len(this.handle, vehicle));
    const ptr = this.cp.exports.cp_alloc(len);
    try {
      const n = this.cp.check(this.cp.exports.cp_world_snapshot(this.handle, vehicle, ptr, len));
      return this.cp.bytes().slice(ptr, ptr + n);
    } finally {
      this.cp.free(ptr, len);
    }
  }

  /** Restore a snapshot taken with {@link snapshot}. */
  restore(vehicle: number, bytes: Uint8Array): void {
    const ptr = this.cp.exports.cp_alloc(bytes.length);
    try {
      this.cp.bytes().set(bytes, ptr);
      this.cp.check(this.cp.exports.cp_world_restore(this.handle, vehicle, ptr, bytes.length));
    } finally {
      this.cp.free(ptr, bytes.length);
    }
  }

  free(): void {
    if (!this.freed) {
      this.cp.exports.cp_world_free(this.handle);
      this.freed = true;
    }
  }
}

/** A standalone tire model for plots and explorers. */
export class Tire {
  private freed = false;

  /** @internal */
  constructor(
    private readonly cp: ContactPatch,
    readonly handle: number,
    private readonly scratchPtr: number,
    private readonly stride: number,
  ) {}

  eval(input: TireInput): TireOutput {
    this.cp.check(
      this.cp.exports.cp_tire_eval(
        this.handle,
        input.fz,
        input.slipRatio,
        input.slipAngle,
        input.camber ?? 0,
        input.vx ?? 10,
        this.scratchPtr,
      ),
    );
    const f = this.cp.floats();
    const o = this.scratchPtr / 8;
    return {
      fx: f[o]!,
      fy: f[o + 1]!,
      mz: f[o + 2]!,
      mx: f[o + 3]!,
      my: f[o + 4]!,
      trail: f[o + 5]!,
      fxMax: f[o + 6]!,
      fyMax: f[o + 7]!,
    };
  }

  /**
   * Sweep one slip axis and return `n × 8` values laid out as
   * `[fx, fy, mz, mx, my, trail, fxMax, fyMax]` per sample. `n` is at most 1024.
   */
  sweep(opts: {
    axis: "slipRatio" | "slipAngle";
    from: number;
    to: number;
    n: number;
    fz: number;
    otherSlip?: number;
    camber?: number;
  }): Float64Array {
    const n = Math.min(Math.max(1, opts.n | 0), 1024);
    this.cp.check(
      this.cp.exports.cp_tire_sweep(
        this.handle,
        opts.axis === "slipRatio" ? 0 : 1,
        opts.from,
        opts.to,
        n,
        opts.fz,
        opts.otherSlip ?? 0,
        opts.camber ?? 0,
        this.scratchPtr,
      ),
    );
    const o = this.scratchPtr / 8;
    return this.cp.floats().slice(o, o + n * this.stride);
  }

  free(): void {
    if (!this.freed) {
      this.cp.exports.cp_tire_free(this.handle);
      this.freed = true;
    }
  }
}
