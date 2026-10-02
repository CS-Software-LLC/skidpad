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
  /**
   * Hand-wheel angle, rad, positive right, when a wheel is the input. The
   * scaler's runaway guard needs it; without it the guard is off.
   */
  wheelAngle?: number | undefined;
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
  wheelAngleDeg?: number,
): FfbFrame {
  return {
    torque: read("SteeringTorque"),
    damping: steering.columnDamping,
    friction: steering.columnFriction,
    wheelAngle: wheelAngleDeg === undefined ? undefined : (wheelAngleDeg * Math.PI) / 180,
  };
}

export interface FfbScalerOptions {
  /** Overall gain on the torque (default 0.5). */
  gain?: number;
  /** Torque that maps to full device output, N·m. */
  maxTorque?: number;
  /** First-order smoothing time constant, s (0 for none). */
  smoothing?: number;
  /** Flip the sign for a device wired the other way round. */
  invert?: boolean;
  /** Largest output magnitude, 0 … 1 (default 1). */
  limit?: number;
  /**
   * Fastest change of the output, full scale per second (default 5: zero to
   * full in 0.2 s), so no frame can snap the wheel. `Infinity` turns it off.
   */
  slewRate?: number;
  /**
   * Runaway guard: hand-wheel speed away from the centre, rad/s, above which
   * a wheel that is also being pushed is taken as running away (default 10,
   * about 570°/s), and how long it must last, s (default 0.1).
   */
  runawayRate?: number;
  runawayTime?: number;
}

/**
 * Scales physical torque to the device's −1 … 1 output with smoothing, a
 * rate limit and clipping statistics, so a setup panel can show how much of
 * the signal the device cannot reproduce.
 *
 * Safety: a force-feedback wheel is a motor that can spin faster than a
 * hand can follow. Defaults are conservative, and the runaway guard latches
 * the output at zero when the wheel races away from the centre under force,
 * which is what a sign error or a violent spin looks like, until `rearm()`.
 */
export class FfbScaler {
  gain: number;
  maxTorque: number;
  smoothing: number;
  invert: boolean;
  limit: number;
  slewRate: number;
  runawayRate: number;
  runawayTime: number;
  /** Last normalised output. */
  output = 0;
  private clipped = 0;
  private frames = 0;
  private lastAngle: number | undefined;
  private runawayFor = 0;
  private trippedReason: string | undefined;

  constructor(options: FfbScalerOptions = {}) {
    this.gain = options.gain ?? 0.5;
    this.maxTorque = options.maxTorque ?? 8;
    this.smoothing = options.smoothing ?? 0.01;
    this.invert = options.invert ?? false;
    this.limit = options.limit ?? 1;
    this.slewRate = options.slewRate ?? 5;
    this.runawayRate = options.runawayRate ?? 10;
    this.runawayTime = options.runawayTime ?? 0.1;
  }

  /** Why the runaway guard cut the output, or undefined while it has not. */
  get tripped(): string | undefined {
    return this.trippedReason;
  }

  /** Clear the runaway guard; the output ramps back up at the slew rate. */
  rearm(): void {
    this.trippedReason = undefined;
    this.runawayFor = 0;
    this.lastAngle = undefined;
  }

  /**
   * Normalised output in −1 … 1 for a torque in N·m; `wheelAngle` (rad,
   * positive right) feeds the runaway guard.
   */
  scale(torque: number, dt: number, wheelAngle?: number): number {
    const raw = (this.gain * torque) / Math.max(this.maxTorque, 1e-6);
    const limit = Math.max(0, Math.min(1, this.limit));
    const target = Math.max(-limit, Math.min(limit, raw)) * (this.invert ? -1 : 1);
    this.frames++;
    if (Math.abs(raw) > limit) this.clipped++;
    this.watchRunaway(dt, wheelAngle);
    if (this.trippedReason !== undefined) {
      this.output = 0;
      return 0;
    }
    let step = target - this.output;
    if (this.smoothing > 0 && dt > 0) step *= Math.min(1, dt / this.smoothing);
    if (dt > 0 && Number.isFinite(this.slewRate)) {
      const max = this.slewRate * dt;
      step = Math.max(-max, Math.min(max, step));
    }
    this.output += step;
    return this.output;
  }

  /**
   * Trip when the wheel moves away from the centre faster than
   * `runawayRate` for `runawayTime` while the output is pushing. The test
   * ignores the output's sign, so it also catches a device whose sign is
   * the other way round.
   */
  private watchRunaway(dt: number, angle: number | undefined): void {
    if (angle === undefined || !Number.isFinite(angle) || dt <= 0) {
      this.lastAngle = undefined;
      return;
    }
    const last = this.lastAngle;
    this.lastAngle = angle;
    if (last === undefined || this.trippedReason !== undefined) return;
    const rate = (angle - last) / dt;
    const outward = rate * angle > 0;
    if (outward && Math.abs(rate) > this.runawayRate && Math.abs(this.output) > 0.05) {
      this.runawayFor += dt;
      if (this.runawayFor >= this.runawayTime) {
        this.trippedReason = `wheel ran away at ${Math.round((Math.abs(rate) * 180) / Math.PI)}°/s under force`;
      }
    } else {
      this.runawayFor = 0;
    }
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
  // Rumble cannot move anything, so full gain and no rate limit.
  private readonly scaler = new FfbScaler({
    maxTorque: 6,
    smoothing: 0.05,
    gain: 1,
    slewRate: Infinity,
  });
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
