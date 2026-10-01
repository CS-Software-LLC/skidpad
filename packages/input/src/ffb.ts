/**
 * Force feedback: the core's `SteeringTorque` (N·m at the hand wheel, in the
 * sign of the steer input) plus the definition's column friction and
 * damping, scaled for a device and handed to a sink. Sinks are per device
 * class; this module has the device-independent parts and a torque-to-rumble
 * fallback for gamepads.
 */

/** One frame of force feedback, in physical units. */
export interface FfbFrame {
  /** Torque at the hand wheel, N·m, positive turning the wheel right. */
  torque: number;
  /** Damping to apply at the device, N·m per rad/s of wheel rate. */
  damping: number;
  /** Friction to apply at the device, N·m. */
  friction: number;
}

/** A device that reproduces the frame. */
export interface FfbSink {
  readonly name: string;
  readonly connected: boolean;
  /** Torque the device reaches at full output, N·m (a guess for rumble). */
  readonly maxTorque: number;
  /** Deliver a frame; `dt` is the host step. May be asynchronous. */
  update(frame: FfbFrame, dt: number): void | Promise<void>;
  /** Zero the output and release the device. */
  stop(): void | Promise<void>;
}

/** Read the frame from the core's telemetry and the definition. */
export function ffbFrameFromTelemetry(
  read: (channel: string) => number,
  steering: { columnFriction: number; columnDamping: number },
): FfbFrame {
  return {
    torque: read("SteeringTorque"),
    damping: steering.columnDamping,
    friction: steering.columnFriction,
  };
}

export interface FfbScalerOptions {
  /** Overall gain on the torque. */
  gain?: number;
  /** Torque that maps to full device output, N·m. */
  maxTorque?: number;
  /** First-order smoothing time constant, s (0 for none). */
  smoothing?: number;
  /** Flip the sign for a device wired the other way round. */
  invert?: boolean;
}

/**
 * Scales physical torque to the device's −1 … 1 output with smoothing and
 * clipping statistics, so a setup panel can show how much of the signal the
 * device cannot reproduce.
 */
export class FfbScaler {
  gain: number;
  maxTorque: number;
  smoothing: number;
  invert: boolean;
  /** Last normalised output. */
  output = 0;
  private clipped = 0;
  private frames = 0;

  constructor(options: FfbScalerOptions = {}) {
    this.gain = options.gain ?? 1;
    this.maxTorque = options.maxTorque ?? 8;
    this.smoothing = options.smoothing ?? 0.01;
    this.invert = options.invert ?? false;
  }

  /** Normalised output in −1 … 1 for a torque in N·m. */
  scale(torque: number, dt: number): number {
    const raw = (this.gain * torque) / Math.max(this.maxTorque, 1e-6);
    const target = Math.max(-1, Math.min(1, raw)) * (this.invert ? -1 : 1);
    this.frames++;
    if (Math.abs(raw) > 1) this.clipped++;
    if (this.smoothing > 0 && dt > 0) {
      const a = Math.min(1, dt / this.smoothing);
      this.output += (target - this.output) * a;
    } else {
      this.output = target;
    }
    return this.output;
  }

  /** Fraction of frames that hit the device's limit since the last reset. */
  get clipFraction(): number {
    return this.frames > 0 ? this.clipped / this.frames : 0;
  }

  resetStats(): void {
    this.clipped = 0;
    this.frames = 0;
  }
}

/** The vibration actuator of a gamepad, as the Gamepad API exposes it. */
export interface RumbleActuatorLike {
  playEffect(
    type: "dual-rumble",
    params: {
      duration: number;
      startDelay?: number;
      strongMagnitude: number;
      weakMagnitude: number;
    },
  ): Promise<unknown>;
  reset?(): Promise<unknown>;
}

/**
 * Torque to rumble: the fallback for gamepads. Strong motor for the torque
 * magnitude, weak motor for the friction share. Nothing like a wheel, but
 * the grip limit is felt as the torque drops off.
 */
export class GamepadRumbleSink implements FfbSink {
  readonly name = "gamepad rumble";
  readonly maxTorque = 6;
  private readonly scaler = new FfbScaler({ maxTorque: 6, smoothing: 0.05 });
  private last = 0;

  constructor(private readonly actuator: () => RumbleActuatorLike | undefined) {}

  get connected(): boolean {
    return this.actuator() !== undefined;
  }

  async update(frame: FfbFrame, dt: number): Promise<void> {
    const act = this.actuator();
    if (!act) return;
    const level = Math.abs(this.scaler.scale(frame.torque, dt));
    // Only re-issue the effect when the level moved: the actuator queue is
    // short and each call restarts the effect.
    if (Math.abs(level - this.last) < 0.03) return;
    this.last = level;
    await act.playEffect("dual-rumble", {
      duration: 100,
      strongMagnitude: level,
      weakMagnitude: Math.min(1, frame.friction / 2),
    });
  }

  async stop(): Promise<void> {
    const act = this.actuator();
    this.last = 0;
    await act?.reset?.();
  }
}
