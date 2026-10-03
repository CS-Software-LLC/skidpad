import type { CpExports } from "./wasm/abi.js";
import { ErrorCode, EXPECTED_ABI_VERSION } from "./wasm/abi.js";
import type {
  VehicleDefinition,
  PartialVehicleDefinition,
  TireDefinition,
  MagicFormulaParams,
  SurfaceDefinition,
} from "./definition/types.js";
import { validateDefinition, validateSurfaces } from "./definition/validate.js";
import { migrateLegacyDrive } from "./definition/migrate.js";
import { PACKAGE_VERSION } from "./version.js";

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
  /** Clutch pedal, 0 (engaged) … 1 (open). Combustion power units only. */
  clutch: number;
  /**
   * Requested gear. With a manual transmission: negative is reverse, zero
   * neutral, `n` gear `n` (clamped to the gears the definition has). With
   * an automatic: negative is reverse (neutral if the definition has no
   * reverse ratio), and zero or any positive value is drive, in which the
   * gearbox picks the gear itself; the engaged gear is the `Gear` channel.
   */
  gear: number;
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
  /** Index into the world's surface table ({@link World.setSurfaces}, ADR-0014). Defaults to 0. */
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

/** A wheel by name or by its index in {@link WHEEL_ORDER}. */
export type Wheel = (typeof WHEEL_ORDER)[number] | 0 | 1 | 2 | 3;

function wheelIndex(wheel: Wheel): number {
  const i = typeof wheel === "number" ? wheel : WHEEL_ORDER.indexOf(wheel);
  if (!Number.isInteger(i) || i < 0 || i >= WHEEL_ORDER.length) {
    throw new SkidpadError(`unknown wheel ${String(wheel)}`, ErrorCode.InvalidDefinition);
  }
  return i;
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
  /** How long the brake stays held after the stop, s (default 2). */
  restTime?: number;
  hostDt?: number;
  /** The surface under every wheel (ADR-0014); the reference surface by default. */
  surface?: Partial<SurfaceDefinition>;
}

export interface StraightLineResult {
  accelTime: number | null;
  accelDistance: number | null;
  quarterMileTime: number | null;
  brakingDistance: number;
  brakingTime: number;
  meanDeceleration: number;
  wheelLocked: boolean;
  /** Time from brake application to the first wheel lock, s; `null` if none locked. */
  lockTime: number | null;
  /** Substeps at which some wheel changed between rolling and locked. */
  lockTransitions: number;
  /** Times a locked wheel released while still moving. Above zero is lock chatter. */
  lockReleases: number;
  /** Relative RMS ripple of the deceleration while sliding, about its 0.2 s moving average. */
  lockedDecelRipple: number;
  /** Largest speed after the stop with the brake held, m/s: the spring-back of the tires. */
  restSpeed: number;
  /** Speed at the end of the rest window, m/s. */
  settledSpeed: number;
  /** Displacement over the rest window, m. */
  restDistance: number;
  /** Heading at the end of the stop, rad. */
  finalYaw: number;
  /** The car turned more than 60° during the stop (rear-only brakes on a slippery surface). */
  spun: boolean;
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

/**
 * Timestep sweep (milestone 3): the skidpad, a locked-wheel stop and a parked
 * hold at every combination of substep rate and host rate, compared against
 * a reference cell at the definition's own substep rate and a 100 Hz host.
 */
export interface TimestepSweepConfig {
  /** Internal substep rates, Hz (default 250, 500, 1000, 2000). */
  substepRates?: number[];
  /** Host step rates, Hz (default 30, 60, 120, 240). */
  hostRates?: number[];
  referenceHostRate?: number;
  radius?: number;
  speeds?: number[];
  settleTime?: number;
  measureTime?: number;
  brakingSpeed?: number;
  grade?: number;
  /** Largest acceptable gradient spread, deg/g (default 0.05). */
  gradientToleranceDegPerG?: number;
  /** Largest acceptable relative braking-distance spread (default 0.01). */
  brakingTolerance?: number;
}

export interface SweepCell {
  substepRateHz: number;
  hostRateHz: number;
  gradientDegPerG: number;
  brakingDistance: number;
  lockReleases: number;
  settledSpeed: number;
  parkedCreepSpeed: number;
  parkedHolds: boolean;
  finite: boolean;
}

export interface TimestepSweepResult {
  reference: SweepCell;
  cells: SweepCell[];
  /** Largest |cell − reference| of the understeer gradient, deg/g. */
  gradientSpreadDegPerG: number;
  /** Largest relative |cell − reference| of the braking distance. */
  brakingDistanceSpread: number;
  allFinite: boolean;
  allHold: boolean;
  cleanStops: boolean;
  /** Everything finite, parked, stopped cleanly, and both spreads within tolerance. */
  stable: boolean;
}

/** Step steer after ISO 7401 (milestone 6). */
export interface StepSteerConfig {
  /** Speed held through the manoeuvre, m/s (default 80 km/h). */
  speed?: number;
  /** Steady-state lateral acceleration the step aims for, m/s² (default 4). */
  latAccelTarget?: number;
  leadTime?: number;
  holdTime?: number;
  /** Ramp time of the step, s (default 0.1). */
  rampTime?: number;
  measureTime?: number;
  hostDt?: number;
}

export interface StepSteerResult {
  speed: number;
  /** Road-wheel steer angle of the step, rad. */
  steerAngle: number;
  steeringWheelAngle: number;
  /** Steady-state yaw rate, rad/s. */
  yawRate: number;
  /** Steady-state yaw rate per rad of road-wheel steer. */
  yawRateGain: number;
  yawRatePeak: number;
  /** `peak / steady − 1`; zero without overshoot. */
  yawRateOvershoot: number;
  /** Time for the yaw rate to first reach 90 % of its steady state, s. */
  yawRateResponseTime: number | null;
  latAccel: number;
  latAccelResponseTime: number | null;
  /** Steady-state body side-slip angle, rad. */
  bodySlipAngle: number;
  rollPeak: number;
  roll: number;
  completed: boolean;
}

/** Which ISO 3888 course to lay out. */
export type LaneChangeCourse = "iso3888Part1" | "iso3888Part2";

/** Double lane change after ISO 3888-1, or the ISO 3888-2 "moose test" (milestone 6). */
export interface LaneChangeConfig {
  course?: LaneChangeCourse;
  /** Entry speeds to try, m/s, increasing (default 50 to 110 km/h in steps of 10). */
  speeds?: number[];
  /** Overall vehicle width, m; zero means `trackWidth + 0.25`. */
  vehicleWidth?: number;
  /** Driver preview, s of travel (default 0.35) with a floor in metres (default 4). */
  previewTime?: number;
  minPreview?: number;
  /** How far ahead the path curvature is read for the feedforward steer, s (default 0.2). */
  feedforwardLead?: number;
  /** Hold the entry speed (default) or release the throttle at the first cone. */
  holdSpeed?: boolean;
  /**
   * Practice runs per speed (default 4): after each run the driver corrects
   * its steering along the course by the path error it saw, and the best
   * run is reported. 1 is a single blind run.
   */
  learningPasses?: number;
  hostDt?: number;
}

export interface LaneChangeAttempt {
  entrySpeed: number;
  exitSpeed: number;
  /** Every wheel stayed inside the coned lanes. */
  passed: boolean;
  /** Largest excursion of a wheel beyond a lane edge, m. */
  coneOverlap: number;
  maxPathError: number;
  maxLatAccel: number;
  maxYawRate: number;
  maxSteerAngle: number;
  maxBodySlipAngle: number;
  maxRoll: number;
  completed: boolean;
  /** Which practice run this is (0 is the blind run). */
  practiceRun: number;
}

export interface LaneChangeResult {
  course: LaneChangeCourse;
  vehicleWidth: number;
  /** Lane widths of sections 1, 3 and 5, m. */
  laneWidths: [number, number, number];
  laneOffset: number;
  courseLength: number;
  attempts: LaneChangeAttempt[];
  /** Highest entry speed that passed, m/s; `null` when none did. */
  maxPassingSpeed: number | null;
}

export type ScenarioRequest =
  | {
      scenario: "understeerGradient";
      definition: PartialVehicleDefinition;
      config?: UndersteerConfig;
    }
  | { scenario: "straightLine"; definition: PartialVehicleDefinition; config?: StraightLineConfig }
  | { scenario: "parkedOnSlope"; definition: PartialVehicleDefinition; config?: ParkedConfig }
  | {
      scenario: "timestepSweep";
      definition: PartialVehicleDefinition;
      config?: TimestepSweepConfig;
    }
  | { scenario: "stepSteer"; definition: PartialVehicleDefinition; config?: StepSteerConfig }
  | {
      scenario: "doubleLaneChange";
      definition: PartialVehicleDefinition;
      config?: LaneChangeConfig;
    };

export type ScenarioResult<R extends ScenarioRequest> = R extends { scenario: "understeerGradient" }
  ? UndersteerResult
  : R extends { scenario: "straightLine" }
    ? StraightLineResult
    : R extends { scenario: "parkedOnSlope" }
      ? ParkedResult
      : R extends { scenario: "timestepSweep" }
        ? TimestepSweepResult
        : R extends { scenario: "stepSteer" }
          ? StepSteerResult
          : LaneChangeResult;

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
  /** The `@skidpad/core` npm version, as in its package.json. */
  readonly version: string;
  /** Version of the Rust crate inside the WASM (not the npm version). */
  readonly crateVersion: string;
  /**
   * Identifies the simulation itself: a hash of the Rust sources, manifest,
   * lockfile and toolchain pin the WASM was built from. Two cores with the
   * same value simulate identically, so compare it (not `version`) to tell
   * whether a replay recorded elsewhere will reproduce. Empty for a WASM
   * built without `scripts/build-wasm.mjs`.
   */
  readonly simulationVersion: string;
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
    this.version = PACKAGE_VERSION;
    // "0.1.0+0123456789abcdef": crate version, then the source hash.
    const [crate, source] = this.readString(
      exports.sp_version_ptr(),
      exports.sp_version_len(),
    ).split("+");
    this.crateVersion = crate ?? "";
    this.simulationVersion = source ?? "";
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

/**
 * Level of detail of one vehicle (ADR-0019): `full` runs the model the
 * definition asks for, `singleTrack` the cheap single-track model whatever
 * the definition asks for, `frozen` does not step it at all.
 */
export type Lod = "full" | "singleTrack" | "frozen";

const LOD_CODES: readonly Lod[] = ["full", "singleTrack", "frozen"];

/**
 * Tuning of the path-following driver (ADR-0020). Every field is optional;
 * missing ones take the core defaults shown.
 */
export interface AiConfig {
  /** Top speed the driver asks for, m/s. Default 30. */
  maxSpeed?: number;
  /** Lateral acceleration the speed profile allows in a curve, m/s². Default 6. */
  lateralAccel?: number;
  /** Deceleration the speed profile plans for, m/s². Default 6. */
  brakeDecel?: number;
  /** Acceleration the speed profile plans for, m/s². Default 3. */
  driveAccel?: number;
  /** Steering look-ahead in seconds of travel. Default 0.5. */
  previewTime?: number;
  /** Smallest steering look-ahead, m. Default 5. */
  minPreview?: number;
  /** How far ahead, in seconds of travel, the target speed is read. Default 0.3. */
  speedLead?: number;
  /** Proportional pedal gain per m/s of speed error. Default 0.6. */
  speedGain?: number;
  /** Integral pedal gain per metre of accumulated speed error. Default 0.3. */
  speedIntegralGain?: number;
  /** Offset from the path, m, positive to the left of its direction. Default 0. */
  lateralOffset?: number;
  /** Whether the last point joins the first. Default true. */
  closed?: boolean;
}

/** Order of {@link AiConfig} fields in the flat form the core reads. */
const AI_CONFIG_FIELDS = [
  "maxSpeed",
  "lateralAccel",
  "brakeDecel",
  "driveAccel",
  "previewTime",
  "minPreview",
  "speedLead",
  "speedGain",
  "speedIntegralGain",
  "lateralOffset",
] as const;

/** Check a driver config; returns one message per bad field. */
export function validateAiConfig(config: AiConfig): string[] {
  const errors: string[] = [];
  AI_CONFIG_FIELDS.forEach((name, i) => {
    const v = config[name];
    if (v === undefined) return;
    if (typeof v !== "number" || !Number.isFinite(v)) {
      errors.push(`ai.${name} must be a finite number (got ${String(v)})`);
    } else if (i < 6 && !(v > 0)) {
      errors.push(`ai.${name} must be positive (got ${v})`);
    } else if (i >= 6 && i < 9 && v < 0) {
      errors.push(`ai.${name} must be zero or positive (got ${v})`);
    }
  });
  if (config.closed !== undefined && typeof config.closed !== "boolean") {
    errors.push("ai.closed must be a boolean");
  }
  return errors;
}

/** What a path-following driver did on its last step. */
export interface AiStatus {
  /** Distance along the path of the car's nearest point, m. */
  distance: number;
  /** Completed laps of a closed path. */
  laps: number;
  /** Signed distance from the (offset) path, m, positive to the left. */
  lateralError: number;
  /** Speed the driver aimed for, m/s. */
  targetSpeed: number;
  /** Whether an open path has been driven to its end. */
  finished: boolean;
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

  /** Host steps taken; part of {@link worldHash}. */
  get stepCount(): number {
    return Number(this.sp.exports.sp_world_step_count(this.handle));
  }

  /** Set the host step counter, as restoring a whole world does. */
  setStepCount(count: number): void {
    this.sp.check(this.sp.exports.sp_world_set_step_count(this.handle, count));
  }

  /**
   * Validate and add a vehicle. Partial definitions are completed with the
   * core defaults. Returns the vehicle index.
   */
  addVehicle(def: PartialVehicleDefinition): number {
    def = migrateLegacyDrive(def as Record<string, unknown>) as PartialVehicleDefinition;
    const v = validateDefinition(def);
    if (!v.ok) throw new SkidpadError(v.errors.join("; "), ErrorCode.InvalidDefinition);
    const { ptr, len } = this.sp.writeString(JSON.stringify(def));
    let vehicle: number;
    try {
      vehicle = this.sp.check(this.sp.exports.sp_world_add_vehicle(this.handle, ptr, len));
    } finally {
      this.sp.free(ptr, len);
    }
    this.fillWheelPositions(vehicle);
    return vehicle;
  }

  /** Replace a vehicle's definition in place, keeping its state (live tuning). */
  setDefinition(vehicle: number, def: PartialVehicleDefinition): void {
    def = migrateLegacyDrive(def as Record<string, unknown>) as PartialVehicleDefinition;
    const v = validateDefinition(def);
    if (!v.ok) throw new SkidpadError(v.errors.join("; "), ErrorCode.InvalidDefinition);
    const { ptr, len } = this.sp.writeString(JSON.stringify(def));
    try {
      this.sp.check(this.sp.exports.sp_world_set_definition(this.handle, vehicle, ptr, len));
    } finally {
      this.sp.free(ptr, len);
    }
    this.fillWheelPositions(vehicle);
  }

  /** Write a vehicle's input. No allocation. */
  setInput(vehicle: number, input: Partial<VehicleInput>): void {
    const f = this.sp.floats();
    const o = this.inputsPtr / 8 + vehicle * this.sp.inputStride;
    if (input.steer !== undefined) f[o] = input.steer;
    if (input.throttle !== undefined) f[o + 1] = input.throttle;
    if (input.brake !== undefined) f[o + 2] = input.brake;
    if (input.handbrake !== undefined) f[o + 3] = input.handbrake;
    if (input.clutch !== undefined) f[o + 4] = input.clutch;
    if (input.gear !== undefined) f[o + 5] = input.gear;
  }

  /** Live view of a vehicle's input slots (`[steer, throttle, brake, handbrake, clutch, gear]`). */
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

  /**
   * Live view of the whole input buffer, `capacity × inputStride` values in
   * vehicle order. For moving every vehicle's inputs at once (a worker, a
   * network layer).
   */
  inputBuffer(): Float64Array {
    const o = this.inputsPtr / 8;
    return this.sp.floats().subarray(o, o + this.capacity * this.sp.inputStride);
  }

  /** Live view of the whole telemetry buffer, `capacity × telemetryStride` values. */
  telemetryBuffer(): Float64Array {
    const o = this.telemetryPtr / 8;
    return this.sp.floats().subarray(o, o + this.capacity * this.sp.telemetryStride);
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

  /**
   * Take `count` host steps of `dt` seconds in one call, with the inputs as
   * they stand (path-following drivers update theirs every step).
   * Bit-identical to `count` calls of {@link step}, without the per-call
   * overhead: for running ahead on a server, seeking a replay, or a worker
   * catching up.
   */
  stepMany(dt: number, count: number): void {
    if (!Number.isInteger(count) || count < 0) {
      throw new SkidpadError(
        `step count must be a whole number (got ${count})`,
        ErrorCode.InvalidDefinition,
      );
    }
    this.sp.check(this.sp.exports.sp_world_step_many(this.handle, dt, count));
  }

  // ---- level of detail (ADR-0019) ------------------------------------------

  /**
   * Set a vehicle's level of detail. Moving between `full` and
   * `singleTrack` rebuilds the vehicle as the other model and carries its
   * motion over; `frozen` stops stepping it until it is raised again.
   * `substepRateHz` overrides the definition's substep rate at this level
   * (0 keeps it). A vehicle on an external host can be frozen but not
   * reduced to the single-track model.
   */
  setLod(vehicle: number, lod: Lod, substepRateHz = 0): void {
    const code = LOD_CODES.indexOf(lod);
    if (code < 0)
      throw new SkidpadError(
        `unknown level of detail "${String(lod)}"`,
        ErrorCode.InvalidDefinition,
      );
    this.sp.check(this.sp.exports.sp_world_set_lod(this.handle, vehicle, code, substepRateHz));
    this.fillWheelPositions(vehicle);
  }

  /** A vehicle's level of detail. */
  lod(vehicle: number): Lod {
    return LOD_CODES[this.sp.check(this.sp.exports.sp_world_lod(this.handle, vehicle))]!;
  }

  // ---- path-following driver (ADR-0020) ------------------------------------

  /**
   * Hand a vehicle to the path-following driver. `path` is either a flat
   * list `[x0, y0, x1, y1, …]` or a list of `[x, y]` points, world frame.
   * From the next step on the driver writes the vehicle's steer, throttle
   * and brake inputs (handbrake, clutch and gear stay yours).
   */
  setAi(
    vehicle: number,
    path: ArrayLike<number> | ReadonlyArray<readonly [number, number]>,
    config: AiConfig = {},
  ): void {
    const errors = validateAiConfig(config);
    if (errors.length > 0) throw new SkidpadError(errors.join("; "), ErrorCode.InvalidDefinition);
    const flat = flattenPath(path);
    const cfgLen = AI_CONFIG_FIELDS.length + 1;
    const bytes = (flat.length + cfgLen) * 8;
    const ptr = this.sp.exports.sp_alloc(bytes);
    try {
      const f = this.sp.floats();
      const o = ptr / 8;
      f.set(flat, o);
      const c = o + flat.length;
      AI_CONFIG_FIELDS.forEach((name, i) => {
        f[c + i] = config[name] ?? Number.NaN;
      });
      f[c + AI_CONFIG_FIELDS.length] =
        config.closed === undefined ? Number.NaN : config.closed ? 1 : 0;
      this.sp.check(
        this.sp.exports.sp_world_set_ai(
          this.handle,
          vehicle,
          ptr,
          flat.length,
          ptr + flat.length * 8,
          cfgLen,
        ),
      );
    } finally {
      this.sp.free(ptr, bytes);
    }
  }

  /** Take the driver away; the inputs keep their last values. */
  clearAi(vehicle: number): void {
    this.sp.check(this.sp.exports.sp_world_clear_ai(this.handle, vehicle));
  }

  /** What the vehicle's driver did on its last step, or `null` without one. */
  aiStatus(vehicle: number): AiStatus | null {
    const ptr = this.sp.scratchPtr;
    const n = this.sp.check(this.sp.exports.sp_world_ai_status(this.handle, vehicle, ptr, 8));
    if (n === 0) return null;
    const f = this.sp.floats();
    const o = ptr / 8;
    return {
      distance: f[o]!,
      laps: f[o + 1]!,
      lateralError: f[o + 2]!,
      targetSpeed: f[o + 3]!,
      finished: f[o + 4]! > 0.5,
    };
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
    this.fillWheelPositions(vehicle);
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
   * World-frame hub centre and contact point of each wheel, as
   * `[hx, hy, hz, cx, cy, cz]` per wheel in {@link WHEEL_ORDER}: after the
   * last step, or after `addVehicle`, `resetVehicle`, `restore`, `setLod`
   * or `setDefinition` when those came later. A live view. Four-wheel model
   * only; a single-track vehicle's view keeps its last four-wheel values.
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

  /**
   * Replace the world's surface table (ADR-0014): entry `i` is the surface
   * id `i` that wheel contacts carry. At most 16 entries; ids beyond the
   * table read as id 0, and an empty table is the reference surface.
   * Missing fields take the reference values (grip 1, rolling resistance
   * 1, drag 0).
   */
  setSurfaces(surfaces: ReadonlyArray<Partial<SurfaceDefinition>>): void {
    const v = validateSurfaces(surfaces);
    if (!v.ok) throw new SkidpadError(v.errors.join("; "), ErrorCode.InvalidDefinition);
    const { ptr, len } = this.sp.writeString(JSON.stringify(surfaces));
    try {
      this.sp.check(this.sp.exports.sp_world_set_surfaces(this.handle, ptr, len));
    } finally {
      this.sp.free(ptr, len);
    }
  }

  /**
   * Surface id of the built-in flat ground under every wheel of a vehicle.
   * An external host tags each wheel contact itself through
   * {@link writeWheelContact}.
   */
  setSurface(vehicle: number, surfaceId: number): void {
    this.sp.check(this.sp.exports.sp_world_set_surface(this.handle, vehicle, 4, surfaceId >>> 0));
  }

  /**
   * Surface id of the built-in flat ground under one wheel, so a car can
   * put two wheels on the grass. The single-track model runs each axle on
   * the mean of its two wheels' surfaces. {@link setSurface} sets all four.
   */
  setWheelSurface(vehicle: number, wheel: Wheel, surfaceId: number): void {
    this.sp.check(
      this.sp.exports.sp_world_set_surface(
        this.handle,
        vehicle,
        wheelIndex(wheel),
        surfaceId >>> 0,
      ),
    );
  }

  /**
   * Put a vehicle at rest at `(x, y)`, level at ride height. `heading` is a
   * yaw angle in radians, or a direction `[dx, dy]` of any length: the
   * core turns a direction into the angle with its own deterministic
   * `atan2`, so code that must stay deterministic never needs
   * `Math.atan2`.
   */
  resetVehicle(
    vehicle: number,
    x = 0,
    y = 0,
    heading: number | readonly [number, number] = 0,
  ): void {
    if (typeof heading === "number") {
      this.sp.check(
        this.sp.exports.sp_world_reset_vehicle(this.handle, vehicle, x, y, heading, 0, 0),
      );
    } else {
      const [dx, dy] = heading;
      if (!(Number.isFinite(dx) && Number.isFinite(dy)) || (dx === 0 && dy === 0)) {
        throw new SkidpadError(
          "heading must be a finite, non-zero vector",
          ErrorCode.InvalidDefinition,
        );
      }
      this.sp.check(this.sp.exports.sp_world_reset_vehicle(this.handle, vehicle, x, y, 0, dx, dy));
    }
    this.fillWheelPositions(vehicle);
  }

  /**
   * Fill a four-wheel vehicle's {@link wheelPositionsView} from its pose
   * and the ground in its host-sync record, as the next step would before
   * moving: hub and contact on each wheel's ray where it meets the contact
   * plane, or at full droop. Kept out of the core to keep the WASM small;
   * basic arithmetic only, so it is the same in every engine.
   */
  private fillWheelPositions(vehicle: number): void {
    let rays: WheelRay[];
    try {
      rays = this.wheelRays(vehicle);
    } catch {
      return; // the single-track model has no wheel positions
    }
    const t = this.telemetryView(vehicle);
    const ch = (name: string) => t[this.sp.channel(name)]!;
    const [px, py, pz] = [ch("PosX"), ch("PosY"), ch("PosZ")];
    const [qx, qy, qz, qw] = [ch("QuatX"), ch("QuatY"), ch("QuatZ"), ch("QuatW")];
    // v' = v + 2w (q × v) + 2 q × (q × v), q = (qx, qy, qz).
    const rotate = (v: readonly [number, number, number]): [number, number, number] => {
      const cx = 2 * (qy * v[2] - qz * v[1]);
      const cy = 2 * (qz * v[0] - qx * v[2]);
      const cz = 2 * (qx * v[1] - qy * v[0]);
      return [
        v[0] + qw * cx + (qy * cz - qz * cy),
        v[1] + qw * cy + (qz * cx - qx * cz),
        v[2] + qw * cz + (qx * cy - qy * cx),
      ];
    };
    const down = rotate([0, 0, -1]);
    const hostIn = this.hostInView(vehicle);
    const out = this.wheelPositionsView(vehicle);
    rays.forEach((ray, w) => {
      const r = rotate(ray.origin);
      const ox = px + r[0];
      const oy = py + r[1];
      const oz = pz + r[2];
      const c = this.sp.hostInBodyLen + w * this.sp.hostContactStride;
      const hit = hostIn[c]! > 0.5;
      const [nx, ny, nz] = [hostIn[c + 4]!, hostIn[c + 5]!, hostIn[c + 6]!];
      const dn = down[0] * nx + down[1] * ny + down[2] * nz;
      let d = ray.length;
      if (hit && dn < -1e-6) {
        const along =
          ((hostIn[c + 1]! - ox) * nx + (hostIn[c + 2]! - oy) * ny + (hostIn[c + 3]! - oz) * nz) /
          dn;
        if (Number.isFinite(along) && along >= 0 && along <= ray.length) d = along;
      }
      const o = w * this.sp.hostOutWheelStride;
      out[o] = ox + down[0] * (d - ray.radius);
      out[o + 1] = oy + down[1] * (d - ray.radius);
      out[o + 2] = oz + down[2] * (d - ray.radius);
      out[o + 3] = ox + down[0] * d;
      out[o + 4] = oy + down[1] * d;
      out[o + 5] = oz + down[2] * d;
    });
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

  /**
   * Restore a snapshot taken with {@link snapshot}. A snapshot taken at the
   * other level of detail switches the vehicle to that model (and level).
   * The world's step counter is not part of a vehicle snapshot; use
   * {@link snapshotWorld} to keep {@link worldHash} meaningful across a
   * seek.
   */
  restore(vehicle: number, bytes: Uint8Array): void {
    const ptr = this.sp.exports.sp_alloc(bytes.length);
    try {
      this.sp.bytes().set(bytes, ptr);
      this.sp.check(this.sp.exports.sp_world_restore(this.handle, vehicle, ptr, bytes.length));
    } finally {
      this.sp.free(ptr, bytes.length);
    }
    this.fillWheelPositions(vehicle);
  }

  /**
   * Snapshot of every vehicle plus the step counter, for seeking: after
   * {@link restoreWorld} the world hashes exactly as it did here. Surface
   * tables, ground slopes and drivers are the application's and are not
   * included.
   */
  snapshotWorld(): Uint8Array {
    const parts: Uint8Array[] = [];
    for (let i = 0; i < this.vehicleCount; i++) parts.push(this.snapshot(i));
    const size = 20 + parts.reduce((n, p) => n + 4 + p.byteLength, 0);
    const out = new Uint8Array(size);
    const dv = new DataView(out.buffer);
    out.set(WORLD_MAGIC, 0);
    dv.setUint32(4, WORLD_SNAPSHOT_VERSION, true);
    dv.setFloat64(8, this.stepCount, true);
    dv.setUint32(16, parts.length, true);
    let o = 20;
    for (const p of parts) {
      dv.setUint32(o, p.byteLength, true);
      out.set(p, o + 4);
      o += 4 + p.byteLength;
    }
    return out;
  }

  /** Restore a {@link snapshotWorld} into a world holding the same vehicles. */
  restoreWorld(bytes: Uint8Array): void {
    const bad = (why: string) => new SkidpadError(`world snapshot: ${why}`, ErrorCode.Snapshot);
    if (bytes.byteLength < 20 || WORLD_MAGIC.some((b, i) => bytes[i] !== b)) {
      throw bad("not a world snapshot");
    }
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (dv.getUint32(4, true) !== WORLD_SNAPSHOT_VERSION) throw bad("unknown format version");
    const n = dv.getUint32(16, true);
    if (n !== this.vehicleCount) {
      throw bad(`holds ${n} vehicles, the world ${this.vehicleCount}`);
    }
    const parts: Uint8Array[] = [];
    let o = 20;
    for (let i = 0; i < n; i++) {
      if (o + 4 > bytes.byteLength) throw bad("truncated");
      const len = dv.getUint32(o, true);
      if (o + 4 + len > bytes.byteLength) throw bad("truncated");
      parts.push(bytes.subarray(o + 4, o + 4 + len));
      o += 4 + len;
    }
    parts.forEach((p, i) => this.restore(i, p));
    this.setStepCount(dv.getFloat64(8, true));
  }

  free(): void {
    if (!this.freed) {
      this.sp.exports.sp_world_free(this.handle);
      this.freed = true;
    }
  }
}

const WORLD_MAGIC = [0x53, 0x4b, 0x57, 0x53]; // "SKWS"
const WORLD_SNAPSHOT_VERSION = 1;

function flattenPath(
  path: ArrayLike<number> | ReadonlyArray<readonly [number, number]>,
): Float64Array {
  const first = path.length > 0 ? (path as ArrayLike<unknown>)[0] : undefined;
  if (Array.isArray(first)) {
    const pts = path as ReadonlyArray<readonly [number, number]>;
    const out = new Float64Array(pts.length * 2);
    pts.forEach((p, i) => {
      out[2 * i] = p[0];
      out[2 * i + 1] = p[1];
    });
    return out;
  }
  return Float64Array.from(path as ArrayLike<number>);
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
