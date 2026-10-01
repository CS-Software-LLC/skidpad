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
export class SkidpadError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
  ) {
    super(message);
    this.name = "SkidpadError";
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

/** Who integrates the chassis pose (ADR-0002). */
export type HostMode = "builtin" | "external";

/** A body-frame ray an external host casts to find the ground under a wheel. */
export interface WheelRay {
  /** Ray origin in the body frame (top of suspension travel), m. */
  origin: [number, number, number];
  /** Unit ray direction in the body frame (−z). */
  direction: [number, number, number];
  /** Ray length beyond which the wheel is airborne, m. */
  length: number;
  /** Tire radius, m. */
  radius: number;
}

/** Ground under one wheel for the coming host step, world frame. */
export interface WheelContact {
  /** A point on the contact plane, m. */
  point: [number, number, number];
  /** Unit normal of the contact plane. */
  normal: [number, number, number];
  /** Velocity of the surface at the contact, m/s. Defaults to zero. */
  surfaceVelocity?: [number, number, number];
  /** Surface identifier for the surface table (milestone 6). Defaults to 0. */
  surfaceId?: number;
}

/** The impulses an external host applies after a step, world frame. */
export interface HostImpulse {
  /** Net impulse of everything except gravity over the step, N·s. */
  impulse: [number, number, number];
  /** Net angular impulse over the step, N·m·s. */
  angularImpulse: [number, number, number];
}

/** Wheel order used by every per-wheel buffer and channel suffix. */
export const WHEEL_ORDER = ["FL", "FR", "RL", "RR"] as const;

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

/** Parked on a slope, or at rest on flat ground (ADR-0005, ADR-0010). */
export interface ParkedConfig {
  /** Road grade as rise per metre along world +x (0.1 for 10 %); the car faces uphill. */
  grade?: number;
  /** Cross slope as rise per metre along world +y. */
  crossSlope?: number;
  /** Service brake held throughout, 0 … 1. */
  brake?: number;
  /** Handbrake held throughout, 0 … 1. */
  handbrake?: number;
  /** Heading, rad. */
  heading?: number;
  settleTime?: number;
  holdTime?: number;
  rmsWindow?: number;
  hostDt?: number;
}

export interface ParkedResult {
  /** Speed at the end of the settling period, m/s. */
  settleSpeed: number;
  /** Planar displacement over the hold period, m. */
  drift: number;
  /** Mean creep speed over the hold period, m/s. */
  creepSpeed: number;
  /** RMS speed over the last `rmsWindow` of the hold, m/s. */
  velocityRms: number;
  maxSpeed: number;
  settleMaxSpeed: number;
  /** Settled below 0.1 mm/s, under 1 mm of drift, RMS below 0.1 mm/s. */
  holds: boolean;
}

export type ScenarioRequest =
  | {
      scenario: "understeerGradient";
      definition: PartialVehicleDefinition;
      config?: UndersteerConfig;
    }
  | { scenario: "straightLine"; definition: PartialVehicleDefinition; config?: StraightLineConfig }
  | { scenario: "parkedOnSlope"; definition: PartialVehicleDefinition; config?: ParkedConfig };

export type ScenarioResult<R extends ScenarioRequest> = R extends { scenario: "understeerGradient" }
  ? UndersteerResult
  : R extends { scenario: "straightLine" }
    ? StraightLineResult
    : ParkedResult;

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
export class Skidpad {
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
  /** Wheels per vehicle in the four-wheel model. */
  readonly wheelCount: number;
  /** @internal Host-sync layout (see `skidpad_core::world`). */
  readonly hostInStride: number;
  /** @internal */
  readonly hostInBodyLen: number;
  /** @internal */
  readonly hostContactStride: number;
  /** @internal */
  readonly hostOutStride: number;
  /** @internal */
  readonly hostOutBodyLen: number;
  /** @internal */
  readonly hostOutWheelStride: number;
  /** @internal */
  readonly wheelRayStride: number;

  /** @internal */
  constructor(readonly exports: CpExports) {
    const abi = exports.sp_abi_version();
    if (abi !== EXPECTED_ABI_VERSION) {
      throw new SkidpadError(
        `core ABI version ${abi} does not match this loader (${EXPECTED_ABI_VERSION}); rebuild the WASM`,
        ErrorCode.InvalidHandle,
      );
    }
    this.buffer = exports.memory.buffer;
    this.u8 = new Uint8Array(this.buffer);
    this.f64 = new Float64Array(this.buffer);
    this.version = this.readString(exports.sp_version_ptr(), exports.sp_version_len());
    this.inputStride = exports.sp_input_stride();
    this.telemetryStride = exports.sp_telemetry_stride();
    this.telemetryLayout = JSON.parse(
      this.readString(exports.sp_telemetry_layout_ptr(), exports.sp_telemetry_layout_len()),
    ) as TelemetryChannel[];
    this.channelIndex = new Map(this.telemetryLayout.map((c, i) => [c.name, i]));
    this.tireOutStride = exports.sp_tire_out_stride();
    this.tireScratchPtr = exports.sp_alloc(this.tireOutStride * 8 * 1024);
    this.wheelCount = exports.sp_wheel_count();
    this.hostInStride = exports.sp_host_in_stride();
    this.hostInBodyLen = exports.sp_host_in_body_len();
    this.hostContactStride = exports.sp_host_contact_stride();
    this.hostOutStride = exports.sp_host_out_stride();
    this.hostOutBodyLen = exports.sp_host_out_body_len();
    this.hostOutWheelStride = exports.sp_host_out_wheel_stride();
    this.wheelRayStride = exports.sp_wheel_ray_stride();
  }

  /** @internal Scratch area shared by tire sweeps and wheel-ray reads. */
  get scratchPtr(): number {
    return this.tireScratchPtr;
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
    const ptr = this.exports.sp_alloc(bytes.length);
    this.refresh();
    this.u8.set(bytes, ptr);
    return { ptr, len: bytes.length };
  }

  /** @internal */
  free(ptr: number, len: number): void {
    this.exports.sp_free(ptr, len);
  }

  /** @internal */
  lastError(): string {
    return this.readString(this.exports.sp_last_error_ptr(), this.exports.sp_last_error_len());
  }

  /** @internal */
  result(): string {
    return this.readString(this.exports.sp_result_ptr(), this.exports.sp_result_len());
  }

  /** @internal */
  check(code: number): number {
    if (code < 0) throw new SkidpadError(this.lastError(), code as ErrorCode);
    return code;
  }

  /**
   * Hash of the deterministic math self-test (ADR-0006). Identical on every
   * platform; the pinned value lives in `crates/skidpad-math/selftest.hash`.
   */
  mathSelftestHash(): string {
    return hex64(this.exports.skidpad_math_selftest());
  }

  /** Index of a telemetry channel by name, or −1. */
  channel(name: string): number {
    return this.channelIndex.get(name) ?? -1;
  }

  /** The core's default definition with every field filled in. */
  defaultDefinition(): VehicleDefinition {
    this.check(this.exports.sp_default_definition());
    return JSON.parse(this.result()) as VehicleDefinition;
  }

  /** Create a world with room for `capacity` vehicles. */
  createWorld(capacity = 1): World {
    return new World(this, this.exports.sp_world_new(capacity));
  }

  /** Create a standalone tire for curve exploration. */
  createTire(def: TireDefinition): Tire {
    const { ptr, len } = this.writeString(JSON.stringify(def));
    try {
      const handle = this.check(this.exports.sp_tire_new(ptr, len));
      return new Tire(this, handle, this.tireScratchPtr, this.tireOutStride);
    } finally {
      this.free(ptr, len);
    }
  }

  /** Parse a Magic Formula `.tir` file into parameters plus warnings. */
  importTir(text: string): TirImport {
    const { ptr, len } = this.writeString(text);
    try {
      this.check(this.exports.sp_tir_import(ptr, len));
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
      this.check(this.exports.sp_run_scenario(ptr, len));
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
  private readonly hostInPtr: number;
  private readonly hostOutPtr: number;
  readonly capacity: number;

  /** @internal */
  constructor(
    private readonly sp: Skidpad,
    readonly handle: number,
  ) {
    this.capacity = sp.exports.sp_world_capacity(handle);
    this.inputsPtr = sp.exports.sp_world_inputs_ptr(handle);
    this.telemetryPtr = sp.exports.sp_world_telemetry_ptr(handle);
    this.hostInPtr = sp.exports.sp_world_host_in_ptr(handle);
    this.hostOutPtr = sp.exports.sp_world_host_out_ptr(handle);
  }

  get vehicleCount(): number {
    return this.sp.exports.sp_world_vehicle_count(this.handle);
  }

  get stepCount(): number {
    return Number(this.sp.exports.sp_world_step_count(this.handle));
  }

  /**
   * Validate and add a vehicle. Partial definitions are completed with the
   * core defaults. Returns the vehicle index.
   */
  addVehicle(def: PartialVehicleDefinition): number {
    const v = validateDefinition(def);
    if (!v.ok) throw new SkidpadError(v.errors.join("; "), ErrorCode.InvalidDefinition);
    const { ptr, len } = this.sp.writeString(JSON.stringify(def));
    try {
      return this.sp.check(this.sp.exports.sp_world_add_vehicle(this.handle, ptr, len));
    } finally {
      this.sp.free(ptr, len);
    }
  }

  /** Replace a vehicle's definition in place, keeping its state (live tuning). */
  setDefinition(vehicle: number, def: PartialVehicleDefinition): void {
    const v = validateDefinition(def);
    if (!v.ok) throw new SkidpadError(v.errors.join("; "), ErrorCode.InvalidDefinition);
    const { ptr, len } = this.sp.writeString(JSON.stringify(def));
    try {
      this.sp.check(this.sp.exports.sp_world_set_definition(this.handle, vehicle, ptr, len));
    } finally {
      this.sp.free(ptr, len);
    }
  }

  /** Write a vehicle's input. No allocation. */
  setInput(vehicle: number, input: Partial<VehicleInput>): void {
    const f = this.sp.floats();
    const o = this.inputsPtr / 8 + vehicle * this.sp.inputStride;
    if (input.steer !== undefined) f[o] = input.steer;
    if (input.throttle !== undefined) f[o + 1] = input.throttle;
    if (input.brake !== undefined) f[o + 2] = input.brake;
    if (input.handbrake !== undefined) f[o + 3] = input.handbrake;
  }

  /** Live view of a vehicle's input slots (`[steer, throttle, brake, handbrake]`). */
  inputView(vehicle: number): Float64Array {
    const o = this.inputsPtr / 8 + vehicle * this.sp.inputStride;
    return this.sp.floats().subarray(o, o + this.sp.inputStride);
  }

  /**
   * Live view of a vehicle's telemetry record. The view is valid until WASM
   * memory grows; re-fetch it after adding vehicles or creating worlds.
   */
  telemetryView(vehicle: number): Float64Array {
    const o = this.telemetryPtr / 8 + vehicle * this.sp.telemetryStride;
    return this.sp.floats().subarray(o, o + this.sp.telemetryStride);
  }

  /** Read one telemetry channel by name. */
  read(vehicle: number, channel: string): number {
    const i = this.sp.channel(channel);
    if (i < 0)
      throw new SkidpadError(`unknown telemetry channel "${channel}"`, ErrorCode.InvalidJson);
    return this.sp.floats()[this.telemetryPtr / 8 + vehicle * this.sp.telemetryStride + i] ?? NaN;
  }

  /** Copy a vehicle's telemetry into a plain object keyed by channel name. */
  readAll(vehicle: number): Record<string, number> {
    const view = this.telemetryView(vehicle);
    const out: Record<string, number> = {};
    this.sp.telemetryLayout.forEach((c, i) => {
      out[c.name] = view[i] ?? NaN;
    });
    return out;
  }

  /** Advance every vehicle by one host step of `dt` seconds. */
  step(dt: number): void {
    this.sp.check(this.sp.exports.sp_world_step(this.handle, dt));
  }

  // ---- external host contract (ADR-0002) ----------------------------------

  /**
   * Hand a vehicle to an external rigid-body host, or back to the built-in
   * one. Only the four-wheel model can be hosted externally. In external
   * mode call {@link writeHostBody} and {@link writeWheelContact} before each
   * step and apply {@link readHostImpulse} after it.
   */
  setHostMode(vehicle: number, mode: HostMode): void {
    this.sp.check(
      this.sp.exports.sp_world_set_host_mode(this.handle, vehicle, mode === "external" ? 1 : 0),
    );
  }

  /** Live view of a vehicle's host-sync input record. */
  hostInView(vehicle: number): Float64Array {
    const o = this.hostInPtr / 8 + vehicle * this.sp.hostInStride;
    return this.sp.floats().subarray(o, o + this.sp.hostInStride);
  }

  /** Live view of a vehicle's host-sync output record. */
  hostOutView(vehicle: number): Float64Array {
    const o = this.hostOutPtr / 8 + vehicle * this.sp.hostOutStride;
    return this.sp.floats().subarray(o, o + this.sp.hostOutStride);
  }

  /**
   * Write the host body's state for the coming step: centre-of-mass
   * position, orientation quaternion (body → world), linear velocity and
   * world-frame angular velocity, all in the core's ISO frame (x forward,
   * y left, z up). No allocation.
   */
  writeHostBody(
    vehicle: number,
    px: number,
    py: number,
    pz: number,
    qx: number,
    qy: number,
    qz: number,
    qw: number,
    vx: number,
    vy: number,
    vz: number,
    wx: number,
    wy: number,
    wz: number,
  ): void {
    const f = this.sp.floats();
    const o = this.hostInPtr / 8 + vehicle * this.sp.hostInStride;
    f[o] = px;
    f[o + 1] = py;
    f[o + 2] = pz;
    f[o + 3] = qx;
    f[o + 4] = qy;
    f[o + 5] = qz;
    f[o + 6] = qw;
    f[o + 7] = vx;
    f[o + 8] = vy;
    f[o + 9] = vz;
    f[o + 10] = wx;
    f[o + 11] = wy;
    f[o + 12] = wz;
  }

  /** Write the ground found under a wheel for the coming step (world frame). */
  writeWheelContact(vehicle: number, wheel: number, contact: WheelContact): void {
    const f = this.sp.floats();
    const o =
      this.hostInPtr / 8 +
      vehicle * this.sp.hostInStride +
      this.sp.hostInBodyLen +
      wheel * this.sp.hostContactStride;
    const sv = contact.surfaceVelocity;
    f[o] = 1;
    f[o + 1] = contact.point[0];
    f[o + 2] = contact.point[1];
    f[o + 3] = contact.point[2];
    f[o + 4] = contact.normal[0];
    f[o + 5] = contact.normal[1];
    f[o + 6] = contact.normal[2];
    f[o + 7] = sv ? sv[0] : 0;
    f[o + 8] = sv ? sv[1] : 0;
    f[o + 9] = sv ? sv[2] : 0;
    f[o + 10] = contact.surfaceId ?? 0;
  }

  /** Mark a wheel as airborne for the coming step. */
  clearWheelContact(vehicle: number, wheel: number): void {
    const o =
      this.hostInPtr / 8 +
      vehicle * this.sp.hostInStride +
      this.sp.hostInBodyLen +
      wheel * this.sp.hostContactStride;
    this.sp.floats()[o] = 0;
  }

  /**
   * The impulses accumulated over the last step for the host to apply to
   * its body before integrating. Pass `out` to avoid allocation.
   */
  readHostImpulse(vehicle: number, out?: HostImpulse): HostImpulse {
    const f = this.sp.floats();
    const o = this.hostOutPtr / 8 + vehicle * this.sp.hostOutStride;
    const r = out ?? { impulse: [0, 0, 0], angularImpulse: [0, 0, 0] };
    r.impulse[0] = f[o]!;
    r.impulse[1] = f[o + 1]!;
    r.impulse[2] = f[o + 2]!;
    r.angularImpulse[0] = f[o + 3]!;
    r.angularImpulse[1] = f[o + 4]!;
    r.angularImpulse[2] = f[o + 5]!;
    return r;
  }

  /**
   * World-frame hub centre and contact point of each wheel after the last
   * step, as `[hx, hy, hz, cx, cy, cz]` per wheel. A live view.
   */
  wheelPositionsView(vehicle: number): Float64Array {
    const o = this.hostOutPtr / 8 + vehicle * this.sp.hostOutStride + this.sp.hostOutBodyLen;
    return this.sp.floats().subarray(o, o + this.sp.wheelCount * this.sp.hostOutWheelStride);
  }

  /** Body-frame suspension rays for an external host to cast each step. */
  wheelRays(vehicle: number): WheelRay[] {
    const n = this.sp.wheelCount * this.sp.wheelRayStride;
    const ptr = this.sp.scratchPtr;
    this.sp.check(this.sp.exports.sp_world_wheel_rays(this.handle, vehicle, ptr, n));
    const f = this.sp.floats();
    const rays: WheelRay[] = [];
    for (let w = 0; w < this.sp.wheelCount; w++) {
      const o = ptr / 8 + w * this.sp.wheelRayStride;
      rays.push({
        origin: [f[o]!, f[o + 1]!, f[o + 2]!],
        direction: [f[o + 3]!, f[o + 4]!, f[o + 5]!],
        length: f[o + 6]!,
        radius: f[o + 7]!,
      });
    }
    return rays;
  }

  /** Per-vehicle state hash as a 16-hex-digit string. */
  stateHash(vehicle: number): string {
    return hex64(this.sp.exports.sp_world_state_hash(this.handle, vehicle));
  }

  /** Hash of every vehicle plus the step count. */
  worldHash(): string {
    return hex64(this.sp.exports.sp_world_hash(this.handle));
  }

  /**
   * Ground slope of the built-in flat world under a vehicle: rise per metre
   * along world +x (grade, 0.1 for 10 %) and world +y (cross slope).
   * Gravity then has a component along the ground. An external host has
   * its own geometry and gravity and ignores this.
   */
  setGroundSlope(vehicle: number, grade: number, cross = 0): void {
    this.sp.check(this.sp.exports.sp_world_set_ground_slope(this.handle, vehicle, grade, cross));
  }

  resetVehicle(vehicle: number, x = 0, y = 0, yaw = 0): void {
    this.sp.check(this.sp.exports.sp_world_reset_vehicle(this.handle, vehicle, x, y, yaw));
  }

  /** Versioned binary snapshot of one vehicle's full state. */
  snapshot(vehicle: number): Uint8Array {
    const len = this.sp.check(this.sp.exports.sp_world_snapshot_len(this.handle, vehicle));
    const ptr = this.sp.exports.sp_alloc(len);
    try {
      const n = this.sp.check(this.sp.exports.sp_world_snapshot(this.handle, vehicle, ptr, len));
      return this.sp.bytes().slice(ptr, ptr + n);
    } finally {
      this.sp.free(ptr, len);
    }
  }

  /** Restore a snapshot taken with {@link snapshot}. */
  restore(vehicle: number, bytes: Uint8Array): void {
    const ptr = this.sp.exports.sp_alloc(bytes.length);
    try {
      this.sp.bytes().set(bytes, ptr);
      this.sp.check(this.sp.exports.sp_world_restore(this.handle, vehicle, ptr, bytes.length));
    } finally {
      this.sp.free(ptr, bytes.length);
    }
  }

  free(): void {
    if (!this.freed) {
      this.sp.exports.sp_world_free(this.handle);
      this.freed = true;
    }
  }
}

/** A standalone tire model for plots and explorers. */
export class Tire {
  private freed = false;

  /** @internal */
  constructor(
    private readonly sp: Skidpad,
    readonly handle: number,
    private readonly scratchPtr: number,
    private readonly stride: number,
  ) {}

  eval(input: TireInput): TireOutput {
    this.sp.check(
      this.sp.exports.sp_tire_eval(
        this.handle,
        input.fz,
        input.slipRatio,
        input.slipAngle,
        input.camber ?? 0,
        input.vx ?? 10,
        this.scratchPtr,
      ),
    );
    const f = this.sp.floats();
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
    this.sp.check(
      this.sp.exports.sp_tire_sweep(
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
    return this.sp.floats().slice(o, o + n * this.stride);
  }

  free(): void {
    if (!this.freed) {
      this.sp.exports.sp_tire_free(this.handle);
      this.freed = true;
    }
  }
}
