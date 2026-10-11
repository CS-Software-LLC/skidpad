/**
 * Lap and sector timing from simulation state only, so the same inputs give
 * the same times. Time is counted in host steps; a gate crossing is placed
 * inside its step by where the car's path crosses the line.
 *
 * Three gates: start/finish, then two sector lines. A lap counts when they
 * are crossed in order, forwards. A lap is invalid (still timed) after all
 * four wheels leave the track, a backwards crossing, a gate out of order, or
 * a reset.
 */
import type { Gate } from "./geometry.js";

/** Spacing of a lap's time-against-distance profile, m. */
export const PROFILE_SPACING = 10;

export interface LapRecord {
  time: number;
  sectors: [number, number, number];
  valid: boolean;
  /** Elapsed time at every {@link PROFILE_SPACING} metres from the line, s. */
  profile: Float32Array;
}

export interface TimerState {
  /** A lap is being timed. */
  running: boolean;
  valid: boolean;
  /** Laps started since the timer was created. */
  lap: number;
  /** Time into the current lap, s. */
  lapTime: number;
  /** Sector the car is in, 0..2. */
  sector: number;
  /** Completed sectors of the current lap, s. */
  sectorTimes: number[];
  /** Ahead (negative) or behind the best lap at the same distance, s. */
  delta: number | null;
  last: LapRecord | null;
  best: LapRecord | null;
}

export interface StepResult {
  /** A lap finished on this step (valid or not). */
  completed: LapRecord | null;
  /** A lap started on this step. */
  started: boolean;
}

/** Where segment p0→p1 crosses segment a→b, as the fraction along p0→p1, or null. */
export function crossing(
  p0x: number,
  p0z: number,
  p1x: number,
  p1z: number,
  a: readonly [number, number],
  b: readonly [number, number],
): number | null {
  const rx = p1x - p0x;
  const rz = p1z - p0z;
  const sx = b[0] - a[0];
  const sz = b[1] - a[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = a[0] - p0x;
  const qz = a[1] - p0z;
  const t = (qx * sz - qz * sx) / den;
  const u = (qx * rz - qz * rx) / den;
  // Half-open in t so a crossing exactly on a step boundary counts once.
  if (t <= 0 || t > 1 || u < 0 || u > 1) return null;
  return t;
}

/** Elapsed time at distance `d` along a profile, interpolated. */
export function profileTime(profile: Float32Array, d: number): number {
  const k = d / PROFILE_SPACING;
  const i = Math.max(0, Math.min(profile.length - 2, Math.floor(k)));
  const f = Math.max(0, Math.min(1, k - i));
  return profile[i]! + (profile[i + 1]! - profile[i]!) * f;
}

export class LapTimer {
  private steps = 0;
  private running = false;
  private valid = true;
  private lap = 0;
  private start = 0;
  /** Index of the gate expected next: 1, 2, then 0 to finish. */
  private next = 1;
  private sectorStart = 0;
  private sectorTimes: number[] = [];
  private delta: number | null = null;
  private last: LapRecord | null = null;
  private best: LapRecord | null = null;
  // Distance and time pairs of the current lap, for its profile.
  private dists: number[] = [];
  private times: number[] = [];

  constructor(
    private readonly gates: readonly Gate[],
    private readonly length: number,
    private readonly dt: number,
  ) {
    if (gates.length !== 3) throw new Error("the timer needs three gates");
  }

  /** A best lap from before (a stored one), or null to forget it. */
  setBest(best: LapRecord | null): void {
    this.best = best;
  }

  /** Stop timing until the car next crosses the start/finish line. */
  stop(): void {
    this.running = false;
    this.delta = null;
  }

  /** The current lap no longer counts (a reset, a shortcut). */
  invalidate(): void {
    this.valid = false;
  }

  /** A lap is being timed (cheaper than {@link state} every step). */
  get isRunning(): boolean {
    return this.running;
  }

  get state(): TimerState {
    return {
      running: this.running,
      valid: this.valid,
      lap: this.lap,
      lapTime: this.running ? this.steps * this.dt - this.start : 0,
      sector: this.running ? (this.next + 2) % 3 : 0,
      sectorTimes: [...this.sectorTimes],
      delta: this.delta,
      last: this.last,
      best: this.best,
    };
  }

  /**
   * Advance one host step. `p` is the car's plan position (x, z) before the
   * step and `c` after it; `s` is the distance along the lap of `c` (from the
   * projector); `offTrack` says all four wheels were off the track.
   */
  step(px: number, pz: number, cx: number, cz: number, s: number, offTrack: boolean): StepResult {
    this.steps++;
    const result: StepResult = { completed: null, started: false };
    if (this.running && offTrack) this.valid = false;
    const mx = cx - px;
    const mz = cz - pz;
    for (let g = 0; g < 3; g++) {
      const gate = this.gates[g]!;
      const f = crossing(px, pz, cx, cz, gate.a, gate.b);
      if (f === null) continue;
      const t = (this.steps - 1 + f) * this.dt;
      const forwards = mx * gate.forward[0] + mz * gate.forward[1] > 0;
      if (!forwards) {
        if (this.running) this.valid = false;
        continue;
      }
      if (g === 0) {
        if (this.running && this.next === 0) {
          result.completed = this.finish(t);
        } else if (this.running) {
          // Back at the line without the sectors: a shortcut or a reset.
          this.valid = false;
        }
        this.begin(t);
        result.started = true;
      } else if (this.running) {
        if (g === this.next) {
          this.sectorTimes.push(t - this.sectorStart);
          this.sectorStart = t;
          this.next = g === 2 ? 0 : g + 1;
        } else {
          this.valid = false;
        }
      }
    }
    if (this.running) {
      const elapsed = this.steps * this.dt - this.start;
      const d = (s - this.gates[0]!.s + this.length) % this.length;
      // Record only forward progress; the wrap just after the line reads as
      // nearly a full lap, so ignore distances that jump.
      const lastD = this.dists.length ? this.dists[this.dists.length - 1]! : 0;
      if (d > lastD && d - lastD < 50) {
        this.dists.push(d);
        this.times.push(elapsed);
      }
      this.delta =
        this.best && this.best.valid && this.dists.length
          ? elapsed - profileTime(this.best.profile, d)
          : null;
    }
    return result;
  }

  private begin(t: number): void {
    this.running = true;
    this.valid = true;
    this.lap++;
    this.start = t;
    this.sectorStart = t;
    this.next = 1;
    this.sectorTimes = [];
    this.dists = [0];
    this.times = [this.steps * this.dt - t];
  }

  private finish(t: number): LapRecord {
    const time = t - this.start;
    this.sectorTimes.push(t - this.sectorStart);
    const record: LapRecord = {
      time,
      sectors: [this.sectorTimes[0]!, this.sectorTimes[1]!, this.sectorTimes[2]!],
      valid: this.valid,
      profile: this.profile(time),
    };
    this.last = record;
    if (record.valid && (!this.best || record.time < this.best.time)) this.best = record;
    return record;
  }

  /** Time at every PROFILE_SPACING metres, ending at the lap time at the full length. */
  private profile(time: number): Float32Array {
    const n = Math.ceil(this.length / PROFILE_SPACING) + 1;
    const out = new Float32Array(n);
    const ds = [...this.dists, this.length];
    const ts = [...this.times, time];
    let j = 0;
    for (let k = 0; k < n; k++) {
      const d = Math.min(this.length, k * PROFILE_SPACING);
      while (j < ds.length - 2 && ds[j + 1]! < d) j++;
      const span = ds[j + 1]! - ds[j]!;
      const f = span > 0 ? Math.max(0, Math.min(1, (d - ds[j]!) / span)) : 0;
      out[k] = ts[j]! + (ts[j + 1]! - ts[j]!) * f;
    }
    return out;
  }
}
