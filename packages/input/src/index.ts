/**
 * @skidpad/input — turns keyboards, gamepads, and wheels into a
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
  /** Clutch pedal, 0 (engaged) … 1 (open). */
  clutch: number;
  /**
   * Requested gear: −1 reverse, 0 neutral (manual) or drive (automatic),
   * 1 … n forward (a manual). The device layer holds the gear in a
   * {@link GearSelector}; the core follows it. An automatic treats every
   * value from 0 up as drive, so give the devices a selector in
   * `"automatic"` mode to keep them from counting gears it ignores.
   */
  gear: number;
}

export { clamp, applyDeadzone, responseCurve, Ramp, type RampOptions } from "./filters.js";
export * from "./calibration.js";
export * from "./wheel.js";
export * from "./touch.js";
export * from "./ffb.js";
export * from "./logitech.js";
export * from "./gears.js";
export * from "./mixer.js";
import { clamp, applyDeadzone, responseCurve, Ramp, type RampOptions } from "./filters.js";
import { GearSelector } from "./gears.js";

export function emptyFrame(): InputFrame {
  return { steer: 0, throttle: 0, brake: 0, handbrake: 0, clutch: 0, gear: 0 };
}

export interface KeyboardMapping {
  left: string[];
  right: string[];
  throttle: string[];
  brake: string[];
  handbrake: string[];
  /** One gear up per press. */
  shiftUp: string[];
  /** One gear down per press; below first is reverse. */
  shiftDown: string[];
  /** Toggles reverse (none by default). */
  reverse: string[];
  /** Clutch pedal while held. */
  clutch: string[];
}

export const defaultKeyboardMapping: KeyboardMapping = {
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  throttle: ["ArrowUp", "KeyW"],
  brake: ["ArrowDown", "KeyS"],
  handbrake: ["Space"],
  shiftUp: ["KeyE", "ShiftRight"],
  shiftDown: ["KeyQ", "ShiftLeft"],
  reverse: [],
  clutch: ["KeyC"],
};

export interface KeyboardOptions {
  mapping?: Partial<KeyboardMapping>;
  steer?: RampOptions;
  throttle?: RampOptions;
  brake?: RampOptions;
  /**
   * The gear state to shift; share one between devices. Default: a
   * selector of its own in `"manual"` mode.
   */
  gears?: GearSelector;
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
  /** The gear state this keyboard shifts. */
  readonly gears: GearSelector;

  constructor(options: KeyboardOptions = {}) {
    this.gears = options.gears ?? new GearSelector();
    this.mapping = { ...defaultKeyboardMapping, ...options.mapping };
    this.steer = new Ramp(options.steer ?? { riseRate: 2.5, fallRate: 5 });
    this.throttle = new Ramp(options.throttle ?? { riseRate: 3, fallRate: 6 });
    this.brake = new Ramp(options.brake ?? { riseRate: 4, fallRate: 8 });
  }

  /** Requested gear; −1 reverse, 0 neutral or drive, 1 … n. */
  get gear(): number {
    return this.gears.gear;
  }

  set gear(g: number) {
    this.gears.gear = g;
  }

  keyDown(code: string): void {
    // Shifts are edge triggered: one gear per press, key repeat ignored.
    if (!this.held.has(code)) {
      if (this.mapping.shiftUp.includes(code)) this.gears.up();
      if (this.mapping.shiftDown.includes(code)) this.gears.down();
      if (this.mapping.reverse.includes(code)) this.gears.toggleReverse();
    }
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
      clutch: this.any(this.mapping.clutch) ? 1 : 0,
      gear: this.gear,
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
  return [
    m.left,
    m.right,
    m.throttle,
    m.brake,
    m.handbrake,
    m.shiftUp,
    m.shiftDown,
    m.reverse,
    m.clutch,
  ].some((l) => l.includes(code));
}

export interface GamepadOptions {
  steerAxis?: number;
  throttleAxis?: number | undefined;
  brakeAxis?: number | undefined;
  throttleButton?: number;
  brakeButton?: number;
  handbrakeButton?: number;
  /** Shift up (default 5, the right bumper); `-1` for none. */
  shiftUpButton?: number;
  /** Shift down (default 4, the left bumper); `-1` for none. */
  shiftDownButton?: number;
  /** Toggle reverse (default 3, the top face button); `-1` for none. */
  reverseButton?: number;
  deadzone?: number;
  /** Response curve on the stick (default 2; 1 is linear). */
  steerExponent?: number;
  /**
   * Fraction of full lock that full stick asks for (default 1). Changeable
   * live through {@link GamepadInput.steerSensitivity}.
   */
  steerSensitivity?: number;
  /**
   * How fast the steering winds on, away from centre, in full-lock
   * fractions per second (default 2, so centre to full lock takes 0.5 s).
   * The stick asks for an angle and the wheel turns toward it at this rate,
   * so a flicked stick turns the wheel over time instead of in one frame.
   * Changeable live through {@link GamepadInput.steerRate}. `Infinity`
   * turns it off.
   */
  steerRate?: number;
  /**
   * How fast the steering unwinds toward centre, in full-lock fractions per
   * second (default 5, so full lock to centre takes 0.2 s). Faster than
   * winding on, so letting go of the stick straightens the car promptly.
   */
  steerReturnRate?: number;
  /** The gear state to shift; share one between devices. */
  gears?: GearSelector;
  /**
   * Which connected pad `poll()` reads. Default: the first with the
   * browser's `"standard"` mapping, so a wheel (which reports a
   * non-standard mapping) is never read as a gamepad.
   */
  pick?: (pad: Gamepad) => boolean;
}

/**
 * Reads a gamepad through the Gamepad API using the standard mapping (left
 * stick X steers, right trigger throttle, left trigger brake, bottom face
 * button handbrake, bumpers shift, top face button toggles reverse).
 * Wheels belong to `WheelInput` and its calibration flow.
 */
export class GamepadInput {
  private readonly opts: Required<
    Omit<
      GamepadOptions,
      "throttleAxis" | "brakeAxis" | "gears" | "pick" | "steerSensitivity" | "steerRate"
    >
  > &
    Pick<GamepadOptions, "throttleAxis" | "brakeAxis">;
  private readonly pick: (pad: Gamepad) => boolean;
  private readonly wasPressed: boolean[] = [];
  /** The gear state this gamepad shifts. */
  readonly gears: GearSelector;
  /** The pad the last `poll()` read, for pointing a rumble sink at it. */
  lastPad: Gamepad | undefined;
  /** Fraction of full lock at full stick, 0…1; safe to change while driving. */
  steerSensitivity: number;
  /** Wind-on rate in full locks per second; safe to change while driving. */
  steerRate: number;
  private steer = 0;

  constructor(options: GamepadOptions = {}) {
    this.gears = options.gears ?? new GearSelector();
    this.pick = options.pick ?? ((p) => p.mapping === "standard");
    this.opts = {
      steerAxis: options.steerAxis ?? 0,
      throttleAxis: options.throttleAxis,
      brakeAxis: options.brakeAxis,
      throttleButton: options.throttleButton ?? 7,
      brakeButton: options.brakeButton ?? 6,
      handbrakeButton: options.handbrakeButton ?? 0,
      shiftUpButton: options.shiftUpButton ?? 5,
      shiftDownButton: options.shiftDownButton ?? 4,
      reverseButton: options.reverseButton ?? 3,
      deadzone: options.deadzone ?? 0.08,
      steerExponent: options.steerExponent ?? 2,
      steerReturnRate: options.steerReturnRate ?? 5,
    };
    this.steerSensitivity = options.steerSensitivity ?? 1;
    this.steerRate = options.steerRate ?? 2;
  }

  /**
   * Map a raw gamepad snapshot to a frame `dt` seconds after the last one.
   * Shifts are taken on the press of a button and steering is rate limited,
   * so call it once per frame; it needs no browser, for testing.
   */
  map(
    axes: ArrayLike<number>,
    buttons: ArrayLike<{ value: number; pressed: boolean }>,
    dt = 1 / 60,
  ): InputFrame {
    const raw = axes[this.opts.steerAxis] ?? 0;
    const target =
      clamp(this.steerSensitivity, 0, 1) *
      responseCurve(applyDeadzone(raw, this.opts.deadzone), this.opts.steerExponent);
    this.steer = this.slew(target, dt);
    const steer = this.steer;
    const axisValue = (i: number | undefined): number | undefined =>
      i === undefined ? undefined : clamp(((axes[i] ?? -1) + 1) / 2, 0, 1);
    const throttle =
      axisValue(this.opts.throttleAxis) ?? buttons[this.opts.throttleButton]?.value ?? 0;
    const brake = axisValue(this.opts.brakeAxis) ?? buttons[this.opts.brakeButton]?.value ?? 0;
    const handbrake = buttons[this.opts.handbrakeButton]?.pressed ? 1 : 0;
    if (this.edge(buttons, this.opts.shiftUpButton)) this.gears.up();
    if (this.edge(buttons, this.opts.shiftDownButton)) this.gears.down();
    if (this.edge(buttons, this.opts.reverseButton)) this.gears.toggleReverse();
    return {
      steer,
      throttle: clamp(throttle, 0, 1),
      brake: clamp(brake, 0, 1),
      handbrake,
      clutch: 0,
      gear: this.gears.gear,
    };
  }

  /**
   * Moves the steering toward `target` over `dt`: at the return rate while
   * heading for centre, at the wind-on rate away from it. A move across
   * centre spends the first part of the step returning.
   */
  private slew(target: number, dt: number): number {
    const from = this.steer;
    if (!(dt > 0)) return from;
    const wind = Math.max(this.steerRate, 0);
    const back = Math.max(this.opts.steerReturnRate, 0);
    if (from === 0 || Math.sign(target) === Math.sign(from)) {
      const rate = Math.abs(target) < Math.abs(from) ? back : wind;
      const step = rate * dt;
      return from + clamp(target - from, -step, step);
    }
    // Target is at or past centre: unwind first, then wind on the other way.
    const toCentre = Math.abs(from) / back;
    if (toCentre >= dt) return from - Math.sign(from) * back * dt;
    const step = wind * (dt - toCentre);
    return clamp(target, -step, step);
  }

  private edge(buttons: ArrayLike<{ pressed: boolean }>, i: number): boolean {
    if (i < 0) return false;
    const now = buttons[i]?.pressed ?? false;
    const before = this.wasPressed[i] ?? false;
    this.wasPressed[i] = now;
    return now && !before;
  }

  /**
   * Poll the first connected pad `pick` accepts (by default the first with
   * the standard mapping), or return undefined when none. The pad read is
   * left in {@link lastPad}. `dt` is the time since the last poll.
   */
  poll(dt = 1 / 60): InputFrame | undefined {
    const nav = globalThis.navigator as Navigator | undefined;
    this.lastPad = undefined;
    if (!nav || typeof nav.getGamepads !== "function") return undefined;
    for (const p of nav.getGamepads()) {
      if (p && p.connected && this.pick(p)) {
        this.lastPad = p;
        return this.map(p.axes, p.buttons, dt);
      }
    }
    return undefined;
  }
}
