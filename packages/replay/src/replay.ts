import type { Lod, LodTarget, PartialVehicleDefinition, Skidpad, World } from "@skidpad/core";

/**
 * Replay format version written by this package. Version 2 added the
 * per-wheel surfaces, the simulation version, the start step and keyframe
 * application state; version 1 replays still play.
 */
export const REPLAY_VERSION = 2;

/** Replay format versions {@link ReplayPlayer} plays. */
export const SUPPORTED_REPLAY_VERSIONS: readonly number[] = [1, 2];

/** Wheels per vehicle in the `surfaces` record. */
export const SURFACE_STRIDE = 4;

const SURFACE_CHANNELS = ["SurfaceId_FL", "SurfaceId_FR", "SurfaceId_RL", "SurfaceId_RR"] as const;

/** Values of one vehicle's input record per step. */
export const INPUT_STRIDE = 6;

const LOD_CODES: readonly Lod[] = ["full", "singleTrack", "frozen"];

/** A full-state checkpoint inside a replay. */
export interface ReplayKeyframe {
  /** Steps recorded before this keyframe (0 is the start). */
  step: number;
  /** One snapshot per recorded vehicle, in replay order. */
  snapshots: Uint8Array[];
  /** One state hash per recorded vehicle, in replay order. */
  hashes: string[];
  /**
   * The application's own state at this step, from the recorder's
   * `keyframeState` (plain JSON data); handed back by the player's
   * `onRestore` whenever it restores this keyframe.
   */
  state?: unknown;
}

/**
 * A recorded run: everything needed to re-simulate it bit for bit in a
 * world holding the same vehicles (same definitions, same surface table and
 * ground) on the built-in host.
 */
export interface Replay {
  version: number;
  /** `@skidpad/core` npm version that recorded it (`Skidpad.version`). */
  coreVersion: string;
  /**
   * `Skidpad.simulationVersion` of the core that recorded it: a core with
   * the same value reproduces the replay bit for bit, a different one may
   * not. Absent when the recorder was given a version string only.
   */
  simulationVersion?: string;
  /** The recording world's step counter when recording started. */
  startStep?: number;
  /** Recorded vehicles' indices in the recording world. */
  vehicles: number[];
  /** Definitions of the recorded vehicles, if the recorder was given them. */
  definitions?: PartialVehicleDefinition[];
  /** Free-form data from the application (track, driver name, lap time). */
  meta?: Record<string, unknown>;
  /** Host steps recorded. */
  steps: number;
  /** Host step length of each step, s. */
  dt: Float64Array;
  /** Inputs applied during each step: `steps × vehicles × INPUT_STRIDE`. */
  inputs: Float64Array;
  /** Level of detail during each step (0 full, 1 single-track, 2 frozen): `steps × vehicles`. */
  lod: Uint8Array;
  /** Substep-rate override of that level, Hz (0 for the definition's): `steps × vehicles`. */
  lodRate: Float64Array;
  /**
   * Surface id under each wheel during each step, as the core reported it:
   * `steps × vehicles × SURFACE_STRIDE` (FL, FR, RL, RR). The player
   * re-applies it with `setWheelSurface`, so a game that moves cars between
   * surfaces on the built-in host replays without help. Absent in version 1.
   */
  surfaces?: Uint8Array;
  /** Checkpoints, in step order; the first is at step 0. */
  keyframes: ReplayKeyframe[];
}

export interface ReplayRecorderOptions {
  /** Which vehicles to record (default: all in the world at `start`). */
  vehicles?: number[];
  /** Steps between keyframes (default 600, 10 s at 60 Hz). */
  keyframeEvery?: number;
  /** Definitions to store with the replay so a player can rebuild the world. */
  definitions?: PartialVehicleDefinition[];
  /** Free-form application data stored with the replay. */
  meta?: Record<string, unknown>;
  /**
   * The application's own state, captured at every keyframe (plain JSON
   * data: lap timing, the race clock). A player hands it back through
   * `onRestore` so a seek restores the game along with the cars.
   */
  keyframeState?: () => unknown;
  /** Record the surface under each wheel every step (default true). */
  recordSurfaces?: boolean;
}

class Grow<T extends Float64Array | Uint8Array> {
  data: T;
  length = 0;
  constructor(private readonly make: (n: number) => T) {
    this.data = make(1024);
  }
  reserve(n: number): void {
    if (this.length + n <= this.data.length) return;
    let cap = this.data.length;
    while (cap < this.length + n) cap *= 2;
    const next = this.make(cap);
    next.set(this.data.subarray(0, this.length) as never);
    this.data = next;
  }
  take(): T {
    return this.data.slice(0, this.length) as T;
  }
}

/**
 * Records a world's run as inputs plus periodic full-state keyframes
 * (ADR-0021). Call {@link step} in place of `world.step`: it steps the
 * world, then records the inputs each vehicle ran with (including what a
 * path-following driver wrote) and its level of detail.
 *
 * The surface under each wheel is recorded every step (as the core
 * reports it), so surface changes on the built-in host replay exactly.
 * Other changes the replay cannot see (a reset, a restore, a definition
 * change, a ground slope) are caught by the keyframes: the player re-syncs
 * at the next one. To reproduce them instead, re-apply them in the
 * player's `beforeStep`, and capture the game's own state with
 * `keyframeState` so a seek can restore it through `onRestore`. Level
 * changes are seen; pass the recorder to a `LodController` (it forwards
 * `setLod`) to record their substep rate too.
 */
export class ReplayRecorder implements LodTarget {
  private readonly vehicles: number[];
  private readonly keyframeEvery: number;
  private readonly dt = new Grow((n) => new Float64Array(n));
  private readonly inputs = new Grow((n) => new Float64Array(n));
  private readonly lodCodes = new Grow((n) => new Uint8Array(n));
  private readonly lodRates = new Grow((n) => new Float64Array(n));
  private readonly surfaces = new Grow((n) => new Uint8Array(n));
  private readonly coreVersion: string;
  private readonly simulationVersion: string | undefined;
  private readonly startStep: number;
  private readonly keyframes: ReplayKeyframe[] = [];
  /** Substep-rate override of each recorded vehicle's current level. */
  private readonly rates: number[];
  private readonly lastLod: Lod[];
  private readonly setHere: boolean[];
  private steps = 0;

  /**
   * `core` is the loaded core (`sp`), which also stamps the replay with its
   * `simulationVersion`, or just a version string.
   */
  constructor(
    private readonly world: World,
    core: Pick<Skidpad, "version" | "simulationVersion"> | string,
    private readonly options: ReplayRecorderOptions = {},
  ) {
    if (typeof core === "string") {
      this.coreVersion = core;
      this.simulationVersion = undefined;
    } else {
      this.coreVersion = core.version;
      this.simulationVersion = core.simulationVersion || undefined;
    }
    this.startStep = world.stepCount;
    this.vehicles = options.vehicles ?? Array.from({ length: world.vehicleCount }, (_, i) => i);
    if (this.vehicles.length === 0) throw new Error("nothing to record: the world has no vehicles");
    this.keyframeEvery = Math.max(1, Math.floor(options.keyframeEvery ?? 600));
    this.rates = this.vehicles.map(() => 0);
    this.lastLod = this.vehicles.map((v) => world.lod(v));
    this.setHere = this.vehicles.map(() => false);
    this.keyframe();
  }

  /** Steps recorded so far. */
  get length(): number {
    return this.steps;
  }

  get vehicleCount(): number {
    return this.world.vehicleCount;
  }

  lod(vehicle: number): Lod {
    return this.world.lod(vehicle);
  }

  /** Forwards to `world.setLod` and remembers the substep rate for the replay. */
  setLod(vehicle: number, lod: Lod, substepRateHz = 0): void {
    this.world.setLod(vehicle, lod, substepRateHz);
    const k = this.vehicles.indexOf(vehicle);
    if (k >= 0) {
      this.rates[k] = substepRateHz;
      this.setHere[k] = true;
    }
  }

  /** Step the world by `dt` and record the step. */
  step(dt: number): void {
    this.world.step(dt);
    this.capture(dt);
  }

  /**
   * Record a step the application already took with `world.step(dt)`.
   * Use this when something else owns the stepping (a host adapter).
   */
  capture(dt: number): void {
    const n = this.vehicles.length;
    this.dt.reserve(1);
    this.dt.data[this.dt.length++] = dt;
    this.inputs.reserve(n * INPUT_STRIDE);
    this.lodCodes.reserve(n);
    this.lodRates.reserve(n);
    for (let k = 0; k < n; k++) {
      const v = this.vehicles[k]!;
      this.inputs.data.set(this.world.inputView(v), this.inputs.length);
      this.inputs.length += INPUT_STRIDE;
      const lod = this.world.lod(v);
      // A level changed straight on the world, not through the recorder,
      // is recorded with the definition's substep rate.
      if (lod !== this.lastLod[k] && !this.setHere[k]) this.rates[k] = 0;
      this.lastLod[k] = lod;
      this.setHere[k] = false;
      this.lodCodes.data[this.lodCodes.length++] = LOD_CODES.indexOf(lod);
      this.lodRates.data[this.lodRates.length++] = this.rates[k]!;
      if (this.options.recordSurfaces ?? true) {
        this.surfaces.reserve(SURFACE_STRIDE);
        for (const c of SURFACE_CHANNELS) {
          this.surfaces.data[this.surfaces.length++] = this.world.read(v, c);
        }
      }
    }
    this.steps++;
    if (this.steps % this.keyframeEvery === 0) this.keyframe();
  }

  private keyframe(): void {
    const kf: ReplayKeyframe = {
      step: this.steps,
      snapshots: this.vehicles.map((v) => this.world.snapshot(v)),
      hashes: this.vehicles.map((v) => this.world.stateHash(v)),
    };
    if (this.options.keyframeState) kf.state = this.options.keyframeState();
    this.keyframes.push(kf);
  }

  /** The recording so far. The recorder can keep recording afterwards. */
  finish(): Replay {
    const r: Replay = {
      version: REPLAY_VERSION,
      coreVersion: this.coreVersion,
      vehicles: [...this.vehicles],
      steps: this.steps,
      dt: this.dt.take(),
      inputs: this.inputs.take(),
      lod: this.lodCodes.take(),
      lodRate: this.lodRates.take(),
      keyframes: [...this.keyframes],
      startStep: this.startStep,
    };
    if (this.simulationVersion) r.simulationVersion = this.simulationVersion;
    if (this.options.recordSurfaces ?? true) r.surfaces = this.surfaces.take();
    if (this.options.definitions) r.definitions = this.options.definitions;
    if (this.options.meta) r.meta = this.options.meta;
    return r;
  }
}

export interface ReplayPlayerOptions {
  /**
   * World index of each replay vehicle, in replay order (default 0, 1, …).
   */
  targets?: number[];
  /**
   * Compare state hashes at every keyframe and restore the keyframe on a
   * mismatch (default true).
   */
  verify?: boolean;
  /**
   * Called before each recorded step is simulated, after the player has
   * written its inputs, level of detail and surfaces: re-apply whatever
   * else the game changed on the world during recording (ground slope,
   * surfaces it chooses itself) here. `step` is the index of the step about
   * to run.
   */
  beforeStep?: (step: number, world: World) => void;
  /**
   * Called after the player restores a keyframe (at the start, on a seek,
   * and on a re-sync) with the step it restored to and the application
   * state recorded there, so the game can restore its own state too.
   */
  onRestore?: (step: number, state: unknown) => void;
  /**
   * Set the world's step counter to the recording's at every keyframe
   * restore, so `worldHash()` matches the recording world (default true).
   * Turn off when the playback world steps other vehicles too.
   */
  followStepCount?: boolean;
}

/**
 * Plays a {@link Replay} back by re-simulating it in a world that holds the
 * same vehicles. The player owns the world's stepping while it plays: it
 * writes each step's inputs and level of detail, then steps. Use a world of
 * its own, with no path-following drivers set (the recorded inputs already
 * include theirs).
 */
export class ReplayPlayer {
  private readonly targets: number[];
  private readonly verify: boolean;
  private readonly beforeStep: ((step: number, world: World) => void) | undefined;
  private readonly onRestore: ((step: number, state: unknown) => void) | undefined;
  private readonly followStepCount: boolean;
  /** Surface ids last applied to each target's wheels; cleared by a restore. */
  private readonly appliedSurfaces: Int16Array;
  private cursor = 0;
  private resyncs = 0;
  /** Level and rate last applied to each target; cleared by a restore. */
  private applied: (string | null)[];

  constructor(
    private readonly world: World,
    readonly replay: Replay,
    options: ReplayPlayerOptions = {},
  ) {
    if (!SUPPORTED_REPLAY_VERSIONS.includes(replay.version)) {
      throw new Error(
        `replay version ${replay.version} is not supported (expected ${SUPPORTED_REPLAY_VERSIONS.join(" or ")})`,
      );
    }
    const n = replay.vehicles.length;
    this.targets = options.targets ?? Array.from({ length: n }, (_, i) => i);
    if (this.targets.length !== n) {
      throw new Error(`replay has ${n} vehicles but ${this.targets.length} targets were given`);
    }
    if (world.vehicleCount <= Math.max(...this.targets)) {
      throw new Error("the world does not hold every target vehicle");
    }
    this.verify = options.verify ?? true;
    this.beforeStep = options.beforeStep;
    this.onRestore = options.onRestore;
    this.followStepCount = options.followStepCount ?? true;
    this.applied = this.targets.map(() => null);
    this.appliedSurfaces = new Int16Array(n * SURFACE_STRIDE).fill(-1);
    this.restoreKeyframe(0);
  }

  /** Steps played so far. */
  get position(): number {
    return this.cursor;
  }

  /** Steps in the replay. */
  get length(): number {
    return this.replay.steps;
  }

  /** Whether every step has been played. */
  get done(): boolean {
    return this.cursor >= this.replay.steps;
  }

  /** Recorded time played so far, s. */
  get time(): number {
    let t = 0;
    for (let k = 0; k < this.cursor; k++) t += this.replay.dt[k]!;
    return t;
  }

  /**
   * Keyframes whose state hash did not match while playing, each one
   * restored. Zero for a replay played in the world it was recorded for.
   */
  get desyncs(): number {
    return this.resyncs;
  }

  /** Play up to `count` steps (default 1). Returns the steps played. */
  advance(count = 1): number {
    const n = this.replay.vehicles.length;
    let played = 0;
    while (played < count && this.cursor < this.replay.steps) {
      const k = this.cursor;
      for (let j = 0; j < n; j++) {
        const v = this.targets[j]!;
        const lod = LOD_CODES[this.replay.lod[k * n + j]!]!;
        const rate = this.replay.lodRate[k * n + j]!;
        const key = `${lod}@${rate}`;
        if (this.applied[j] !== key) {
          this.world.setLod(v, lod, rate);
          this.applied[j] = key;
        }
        const o = (k * n + j) * INPUT_STRIDE;
        this.world.inputView(v).set(this.replay.inputs.subarray(o, o + INPUT_STRIDE));
        const surfaces = this.replay.surfaces;
        if (surfaces) {
          for (let w = 0; w < SURFACE_STRIDE; w++) {
            const id = surfaces[(k * n + j) * SURFACE_STRIDE + w]!;
            const a = j * SURFACE_STRIDE + w;
            if (this.appliedSurfaces[a] !== id) {
              this.world.setWheelSurface(v, w as 0 | 1 | 2 | 3, id);
              this.appliedSurfaces[a] = id;
            }
          }
        }
      }
      this.beforeStep?.(k, this.world);
      this.world.step(this.replay.dt[k]!);
      this.cursor++;
      played++;
      if (this.verify) this.check();
    }
    return played;
  }

  /**
   * Jump to step `step` (clamped to the replay): restore the last keyframe
   * at or before it and re-simulate from there.
   */
  seek(step: number): void {
    const target = Math.max(0, Math.min(this.replay.steps, Math.floor(step)));
    let best = 0;
    this.replay.keyframes.forEach((kf, i) => {
      if (kf.step <= target) best = i;
    });
    // Moving forward within the same keyframe interval needs no restore.
    const kf = this.replay.keyframes[best]!;
    if (!(target >= this.cursor && this.cursor >= kf.step)) this.restoreKeyframe(best);
    this.advance(target - this.cursor);
  }

  private check(): void {
    const kf = this.replay.keyframes.find((f) => f.step === this.cursor);
    if (!kf) return;
    const same = this.targets.every((v, j) => this.world.stateHash(v) === kf.hashes[j]);
    if (!same) {
      this.resyncs++;
      this.restore(kf);
    }
  }

  private restoreKeyframe(index: number): void {
    const kf = this.replay.keyframes[index]!;
    this.restore(kf);
    this.cursor = kf.step;
  }

  private restore(kf: ReplayKeyframe): void {
    this.targets.forEach((v, j) => this.world.restore(v, kf.snapshots[j]!));
    this.applied.fill(null);
    this.appliedSurfaces.fill(-1);
    if (this.followStepCount && this.replay.startStep !== undefined) {
      this.world.setStepCount(this.replay.startStep + kf.step);
    }
    this.onRestore?.(kf.step, kf.state);
  }
}

/**
 * A fresh world holding a replay's vehicles, built from the definitions
 * stored with it. The surface table, ground slopes and surface ids are the
 * application's to set as they were when recording.
 */
export function createReplayWorld(sp: Skidpad, replay: Replay): World {
  const defs = replay.definitions;
  if (!defs || defs.length !== replay.vehicles.length) {
    throw new Error(
      "the replay carries no definitions; record with ReplayRecorder({ definitions })",
    );
  }
  const w = sp.createWorld(defs.length);
  for (const d of defs) w.addVehicle(d);
  return w;
}
