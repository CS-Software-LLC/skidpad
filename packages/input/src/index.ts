/**
 * @contactpatch/input — turns keyboards, gamepads, and wheels into a
 * normalised, filtered input frame. Filtering happens here, before the core,
 * so recorded inputs replay identically regardless of device.
 */

export interface InputFrame {
  /** −1 (left) … +1 (right). */
  steer: number;
  /** 0 … 1. */
  throttle: number;
  /** 0 … 1. */
  brake: number;
  /** 0 … 1. */
  handbrake: number;
}

export function emptyFrame(): InputFrame {
  return { steer: 0, throttle: 0, brake: 0, handbrake: 0 };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Symmetric deadzone with rescaling so full deflection still reaches ±1. */
export function applyDeadzone(v: number, deadzone: number): number {
  const a = Math.abs(v);
  if (a <= deadzone) return 0;
  const scaled = (a - deadzone) / (1 - deadzone);
  return Math.sign(v) * clamp(scaled, 0, 1);
}

/**
 * Response curve: `exponent` 1 is linear, above 1 softens the centre (common
 * for gamepad steering), below 1 sharpens it.
 */
export function responseCurve(v: number, exponent: number): number {
  const a = Math.min(Math.abs(v), 1);
  return Math.sign(v) * Math.pow(a, exponent);
}

export interface RampOptions {
  /** Units per second toward the target when a key is held. */
  riseRate: number;
  /** Units per second back toward zero when released. */
  fallRate: number;
}

/**
 * Turns a digital (held / not held) input into an analog value that ramps
 * up and decays, so keyboard driving feels progressive.
 */
export class Ramp {
  value = 0;
  constructor(private readonly opts: RampOptions) {}

  /** Advance by `dt` seconds toward `target` (−1, 0, or +1 for an axis). */
  update(target: number, dt: number): number {
    const t = clamp(target, -1, 1);
    if (t === 0) {
      const step = this.opts.fallRate * dt;
      this.value = Math.abs(this.value) <= step ? 0 : this.value - Math.sign(this.value) * step;
    } else if (Math.sign(t) !== Math.sign(this.value) && this.value !== 0) {
      // Reversing direction: fall through zero at the fall rate first.
      const step = this.opts.fallRate * dt;
      this.value = Math.abs(this.value) <= step ? 0 : this.value - Math.sign(this.value) * step;
    } else {
      const step = this.opts.riseRate * dt;
      this.value = t > 0 ? Math.min(t, this.value + step) : Math.max(t, this.value - step);
    }
    return this.value;
  }

  reset(): void {
    this.value = 0;
  }
}

export interface KeyboardMapping {
  left: string[];
  right: string[];
  throttle: string[];
  brake: string[];
  handbrake: string[];
}

export const defaultKeyboardMapping: KeyboardMapping = {
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  throttle: ["ArrowUp", "KeyW"],
  brake: ["ArrowDown", "KeyS"],
  handbrake: ["Space"],
};

export interface KeyboardOptions {
  mapping?: Partial<KeyboardMapping>;
  steer?: RampOptions;
  throttle?: RampOptions;
  brake?: RampOptions;
}

/**
 * Keyboard driver. Pure state machine: feed it key events and call
 * `update(dt)` each frame. `attach(target)` wires DOM listeners when a DOM
 * exists.
 */
export class KeyboardInput {
  private readonly held = new Set<string>();
  private readonly mapping: KeyboardMapping;
  private readonly steer: Ramp;
  private readonly throttle: Ramp;
  private readonly brake: Ramp;
  private detach: (() => void) | undefined;

  constructor(options: KeyboardOptions = {}) {
    this.mapping = { ...defaultKeyboardMapping, ...options.mapping };
    this.steer = new Ramp(options.steer ?? { riseRate: 2.5, fallRate: 5 });
    this.throttle = new Ramp(options.throttle ?? { riseRate: 3, fallRate: 6 });
    this.brake = new Ramp(options.brake ?? { riseRate: 4, fallRate: 8 });
  }

  keyDown(code: string): void {
    this.held.add(code);
  }

  keyUp(code: string): void {
    this.held.delete(code);
  }

  private any(codes: string[]): boolean {
    return codes.some((c) => this.held.has(c));
  }

  update(dt: number): InputFrame {
    const steerTarget =
      (this.any(this.mapping.right) ? 1 : 0) - (this.any(this.mapping.left) ? 1 : 0);
    return {
      steer: this.steer.update(steerTarget, dt),
      throttle: this.throttle.update(this.any(this.mapping.throttle) ? 1 : 0, dt),
      brake: this.brake.update(this.any(this.mapping.brake) ? 1 : 0, dt),
      handbrake: this.any(this.mapping.handbrake) ? 1 : 0,
    };
  }

  /** Attach DOM listeners. Returns a disposer. Safe to call without a DOM. */
  attach(
    target:
      | {
          addEventListener: EventTarget["addEventListener"];
          removeEventListener: EventTarget["removeEventListener"];
        }
      | undefined = globalThis.window,
  ): () => void {
    if (!target) return () => {};
    const down = (e: Event): void => {
      const k = e as KeyboardEvent;
      this.keyDown(k.code);
      if (isMapped(this.mapping, k.code)) k.preventDefault?.();
    };
    const up = (e: Event): void => this.keyUp((e as KeyboardEvent).code);
    target.addEventListener("keydown", down);
    target.addEventListener("keyup", up);
    this.detach = () => {
      target.removeEventListener("keydown", down);
      target.removeEventListener("keyup", up);
    };
    return this.detach;
  }

  dispose(): void {
    this.detach?.();
    this.held.clear();
  }
}

function isMapped(m: KeyboardMapping, code: string): boolean {
  return [m.left, m.right, m.throttle, m.brake, m.handbrake].some((l) => l.includes(code));
}

export interface GamepadOptions {
  steerAxis?: number;
  throttleAxis?: number | undefined;
  brakeAxis?: number | undefined;
  throttleButton?: number;
  brakeButton?: number;
  handbrakeButton?: number;
  deadzone?: number;
  steerExponent?: number;
}

/**
 * Reads the first connected gamepad through the Gamepad API using the
 * standard mapping (left stick X, right trigger throttle, left trigger
 * brake). Wheels with separate pedal axes can be configured through the
 * axis options; the calibration flow arrives in milestone 5.
 */
export class GamepadInput {
  private readonly opts: Required<Omit<GamepadOptions, "throttleAxis" | "brakeAxis">> &
    Pick<GamepadOptions, "throttleAxis" | "brakeAxis">;

  constructor(options: GamepadOptions = {}) {
    this.opts = {
      steerAxis: options.steerAxis ?? 0,
      throttleAxis: options.throttleAxis,
      brakeAxis: options.brakeAxis,
      throttleButton: options.throttleButton ?? 7,
      brakeButton: options.brakeButton ?? 6,
      handbrakeButton: options.handbrakeButton ?? 0,
      deadzone: options.deadzone ?? 0.08,
      steerExponent: options.steerExponent ?? 1.5,
    };
  }

  /** Map a raw gamepad snapshot to a frame. Pure, for testing. */
  map(
    axes: ArrayLike<number>,
    buttons: ArrayLike<{ value: number; pressed: boolean }>,
  ): InputFrame {
    const raw = axes[this.opts.steerAxis] ?? 0;
    const steer = responseCurve(applyDeadzone(raw, this.opts.deadzone), this.opts.steerExponent);
    const axisValue = (i: number | undefined): number | undefined =>
      i === undefined ? undefined : clamp(((axes[i] ?? -1) + 1) / 2, 0, 1);
    const throttle =
      axisValue(this.opts.throttleAxis) ?? buttons[this.opts.throttleButton]?.value ?? 0;
    const brake = axisValue(this.opts.brakeAxis) ?? buttons[this.opts.brakeButton]?.value ?? 0;
    const handbrake = buttons[this.opts.handbrakeButton]?.pressed ? 1 : 0;
    return { steer, throttle: clamp(throttle, 0, 1), brake: clamp(brake, 0, 1), handbrake };
  }

  /** Poll the first connected gamepad, or return undefined when none. */
  poll(): InputFrame | undefined {
    const nav = globalThis.navigator as Navigator | undefined;
    if (!nav || typeof nav.getGamepads !== "function") return undefined;
    const pads = nav.getGamepads();
    for (const p of pads) {
      if (p) return this.map(p.axes, p.buttons);
    }
    return undefined;
  }
}
