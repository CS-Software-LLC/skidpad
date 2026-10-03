import type { World } from "@skidpad/core";

/** Ghost format version written by this package. */
export const GHOST_VERSION = 1;

/** Values per ghost frame: time, position xyz, yaw, pitch, roll, steer, speed. */
export const GHOST_STRIDE = 9;

/**
 * The pose of a ghost car at one moment, in the core's ISO frame (x
 * forward, y left, z up). Angles in radians; the body orientation is yaw
 * about z, then pitch about the new y, then roll about the new x (z-y-x
 * intrinsic), the order the core's `Yaw`, `Pitch` and `Roll` channels use.
 * {@link ghostQuaternion} turns it into the quaternion the `Quat*`
 * channels hold.
 */
export interface GhostPose {
  /** Time since the start of the ghost, s. */
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  /** Road-wheel steer angle, rad. */
  steer: number;
  /** Speed, m/s. */
  speed: number;
}

/**
 * A pose track: what a car looked like over time, without its physics.
 * Plays back with no simulation at all, so a ghost costs an interpolation
 * per frame and survives core updates that would break a replay.
 */
export interface Ghost {
  version: number;
  /** Free-form application data (driver, lap time, track). */
  meta?: Record<string, unknown>;
  /** `frames × GHOST_STRIDE` values; times start at 0 and increase. */
  frames: Float32Array;
}

const CHANNELS = ["PosX", "PosY", "PosZ", "Yaw", "Pitch", "Roll", "SteerAngle", "Speed"] as const;

export interface GhostRecorderOptions {
  /** Record every `every`-th sample (default 1). */
  every?: number;
  meta?: Record<string, unknown>;
}

/**
 * Samples one vehicle's pose from a world's telemetry. Call {@link sample}
 * after each `world.step`: a frame's time is the time at the end of the
 * step it follows, and {@link finish} shifts the times so the first frame
 * is at zero. To line a ghost up with a clock (a lap), call {@link restart}
 * when the clock starts: it records the pose at that moment as the frame
 * at time zero, so ghost time `t` is exactly `t / dt` steps after it.
 */
export class GhostRecorder {
  private frames = new Float32Array(GHOST_STRIDE * 1024);
  private count = 0;
  private calls = 0;
  private time = 0;
  private readonly every: number;
  private readonly index: number[];
  private meta: Record<string, unknown> | undefined;

  constructor(
    private readonly world: World,
    private readonly vehicle: number,
    sp: { channel(name: string): number },
    options: GhostRecorderOptions = {},
  ) {
    this.every = Math.max(1, Math.floor(options.every ?? 1));
    this.meta = options.meta;
    this.index = CHANNELS.map((c) => {
      const i = sp.channel(c);
      if (i < 0) throw new Error(`telemetry has no ${c} channel`);
      return i;
    });
  }

  /** Frames recorded so far. */
  get length(): number {
    return this.count;
  }

  /**
   * Drop everything recorded and start a new ghost from the vehicle's
   * current pose, recorded as the frame at time zero (a lap starts on the
   * step that crossed the line). `meta` replaces the options' metadata.
   */
  restart(meta?: Record<string, unknown>): void {
    this.count = 0;
    this.calls = 0;
    this.time = 0;
    if (meta !== undefined) this.meta = meta;
    this.record(0);
    this.calls = 1;
  }

  /** Record the vehicle's pose after a step of `dt` seconds. */
  sample(dt: number): void {
    this.time += dt;
    if (this.calls++ % this.every !== 0) return;
    this.record(this.time);
  }

  private record(time: number): void {
    if (this.count * GHOST_STRIDE + GHOST_STRIDE > this.frames.length) {
      const next = new Float32Array(this.frames.length * 2);
      next.set(this.frames);
      this.frames = next;
    }
    const tel = this.world.telemetryView(this.vehicle);
    const o = this.count * GHOST_STRIDE;
    const f = this.frames;
    f[o] = time;
    for (let c = 0; c < CHANNELS.length; c++) f[o + 1 + c] = tel[this.index[c]!]!;
    this.count++;
  }

  /** The ghost so far, with times starting at zero. */
  finish(): Ghost {
    const frames = this.frames.slice(0, this.count * GHOST_STRIDE);
    const t0 = frames[0] ?? 0;
    for (let o = 0; o < frames.length; o += GHOST_STRIDE) frames[o] = frames[o]! - t0;
    const g: Ghost = { version: GHOST_VERSION, frames };
    if (this.meta) g.meta = this.meta;
    return g;
  }
}

/** Duration of a ghost, s. */
export function ghostDuration(ghost: Ghost): number {
  const n = ghost.frames.length / GHOST_STRIDE;
  return n > 0 ? ghost.frames[(n - 1) * GHOST_STRIDE]! : 0;
}

/**
 * The part of a ghost between `from` and `to` seconds (both included),
 * re-timed to start at zero: a lap out of a longer session. Frame times are
 * stored as 32-bit floats, so the bounds are rounded the same way before
 * comparing: a bound computed as the same float64 time a frame was
 * recorded at always includes that frame. {@link sliceGhostFrames} slices
 * by frame index instead.
 */
export function sliceGhost(ghost: Ghost, from: number, to: number): Ghost {
  const n = ghost.frames.length / GHOST_STRIDE;
  const lo = Math.fround(from);
  const hi = Math.fround(to);
  let first = n;
  let last = -1;
  for (let i = 0; i < n; i++) {
    const t = ghost.frames[i * GHOST_STRIDE]!;
    if (t >= lo && t <= hi) {
      first = Math.min(first, i);
      last = i;
    }
  }
  return sliceGhostFrames(ghost, first, last + 1);
}

/**
 * Frames `from` (included) to `to` (excluded) of a ghost, re-timed to start
 * at zero. With one frame per step, frame `k` is `k` steps after the first.
 */
export function sliceGhostFrames(ghost: Ghost, from: number, to: number): Ghost {
  const n = ghost.frames.length / GHOST_STRIDE;
  const a = Math.max(0, Math.min(n, Math.floor(from)));
  const b = Math.max(a, Math.min(n, Math.floor(to)));
  const frames = ghost.frames.slice(a * GHOST_STRIDE, b * GHOST_STRIDE);
  const t0 = frames[0] ?? 0;
  for (let o = 0; o < frames.length; o += GHOST_STRIDE) frames[o] = frames[o]! - t0;
  const g: Ghost = { version: GHOST_VERSION, frames };
  if (ghost.meta) g.meta = ghost.meta;
  return g;
}

/**
 * The body orientation of a pose as a quaternion `[x, y, z, w]` (body to
 * world, ISO frame), composed yaw, then pitch, then roll as the core does.
 * Uses `Math.sin` and `Math.cos`: for drawing, not for anything that must
 * be deterministic.
 */
export function ghostQuaternion(
  pose: Pick<GhostPose, "yaw" | "pitch" | "roll">,
  out: [number, number, number, number] = [0, 0, 0, 1],
): [number, number, number, number] {
  const [sy, cy] = [Math.sin(pose.yaw / 2), Math.cos(pose.yaw / 2)];
  const [sp, cp] = [Math.sin(pose.pitch / 2), Math.cos(pose.pitch / 2)];
  const [sr, cr] = [Math.sin(pose.roll / 2), Math.cos(pose.roll / 2)];
  out[0] = sr * cp * cy - cr * sp * sy;
  out[1] = cr * sp * cy + sr * cp * sy;
  out[2] = cr * cp * sy - sr * sp * cy;
  out[3] = cr * cp * cy + sr * sp * sy;
  return out;
}

function lerpAngle(a: number, b: number, f: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * f;
}

/**
 * Interpolates a ghost's pose at any time. Lookups that move forward a
 * little each frame cost O(1).
 */
export class GhostPlayer {
  private cursor = 0;
  readonly duration: number;
  private readonly n: number;

  constructor(readonly ghost: Ghost) {
    if (ghost.version !== GHOST_VERSION) {
      throw new Error(
        `ghost version ${ghost.version} is not supported (expected ${GHOST_VERSION})`,
      );
    }
    this.n = ghost.frames.length / GHOST_STRIDE;
    if (this.n < 1) throw new Error("the ghost has no frames");
    this.duration = ghostDuration(ghost);
  }

  /**
   * Pose at time `t` seconds (clamped to the ghost). Pass `out` to avoid
   * allocating.
   */
  poseAt(t: number, out?: GhostPose): GhostPose {
    const f = this.ghost.frames;
    const time = (i: number) => f[i * GHOST_STRIDE]!;
    const tt = Math.max(0, Math.min(this.duration, t));
    let i = Math.min(this.cursor, this.n - 1);
    if (time(i) > tt) {
      // Went back: binary search from the start.
      let lo = 0;
      let hi = i;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (time(mid) <= tt) lo = mid;
        else hi = mid - 1;
      }
      i = lo;
    } else {
      while (i + 1 < this.n && time(i + 1) <= tt) i++;
    }
    this.cursor = i;
    const j = Math.min(i + 1, this.n - 1);
    const a = i * GHOST_STRIDE;
    const b = j * GHOST_STRIDE;
    const span = f[b]! - f[a]!;
    const k = span > 0 ? (tt - f[a]!) / span : 0;
    const lerp = (o: number) => f[a + o]! + (f[b + o]! - f[a + o]!) * k;
    const r = out ?? { t: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, steer: 0, speed: 0 };
    r.t = tt;
    r.x = lerp(1);
    r.y = lerp(2);
    r.z = lerp(3);
    r.yaw = lerpAngle(f[a + 4]!, f[b + 4]!, k);
    r.pitch = lerp(5);
    r.roll = lerp(6);
    r.steer = lerp(7);
    r.speed = lerp(8);
    return r;
  }
}
