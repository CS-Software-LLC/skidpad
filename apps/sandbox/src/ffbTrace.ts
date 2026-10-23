/**
 * The last few seconds of force feedback for the setup panel's graph: what
 * the car asked of the rim (gain × torque), what the device was sent after
 * smoothing, the slew limit and clipping, and the car torque split by
 * source (ADR-0031), all in N·m at the rim.
 */
import type { FfbScaler } from "@skidpad/input";

/** The breakdown channels, in the order the graph draws them. */
export const FFB_PARTS = [
  ["SteerTorqueMz", "aligning moment"],
  ["SteerTorqueTrail", "mech. trail"],
  ["SteerTorqueScrub", "scrub"],
  ["SteerTorqueLift", "lift"],
  ["SteerTorqueAssist", "assist"],
] as const;

export class FfbTrace {
  readonly requested: Float64Array;
  readonly sent: Float64Array;
  readonly clipped: Uint8Array;
  readonly parts: Float64Array[];
  /** Device full scale at the last sample, N·m. */
  fullScale = 0;
  /** Samples written so far (the newest is at `(count − 1) % capacity`). */
  count = 0;

  constructor(readonly capacity = 600) {
    this.requested = new Float64Array(capacity);
    this.sent = new Float64Array(capacity);
    this.clipped = new Uint8Array(capacity);
    this.parts = FFB_PARTS.map(() => new Float64Array(capacity));
  }

  /** Record one frame after the scaler ran; `read` reads telemetry. */
  push(scaler: FfbScaler, read: (channel: string) => number): void {
    const i = this.count % this.capacity;
    this.requested[i] = scaler.requested;
    this.sent[i] = scaler.sent;
    this.clipped[i] = scaler.lastClipped ? 1 : 0;
    FFB_PARTS.forEach(([channel], k) => (this.parts[k]![i] = scaler.gain * read(channel)));
    this.fullScale = scaler.maxTorque * Math.max(0, Math.min(1, scaler.limit));
    this.count++;
  }

  /** Index into the arrays of the `k`-th of the last `n` samples. */
  at(k: number, n: number): number {
    return (this.count - n + k) % this.capacity;
  }

  clear(): void {
    this.count = 0;
  }
}
