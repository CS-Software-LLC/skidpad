/**
 * Steering wheels and pedal sets over the Gamepad API, mapped through a
 * calibrated profile. Steering is scaled by the vehicle's own lock, so a
 * 900° wheel turns the road wheels exactly as the definition's steering
 * ratio says and the force-feedback torque means what the core computed.
 */
import {
  AxisCalibrator,
  builtinProfiles,
  calibrateCentred,
  calibratePedal,
  type AxisBinding,
  type ButtonBinding,
  type DeviceRole,
  type WheelProfile,
} from "./calibration.js";
import { clamp } from "./filters.js";
import { GearSelector } from "./gears.js";
import { emptyFrame, type InputFrame } from "./index.js";

/** The subset of `Gamepad` the mapping reads; plain objects work in tests. */
export interface GamepadLike {
  id: string;
  index: number;
  connected: boolean;
  /** The browser's mapping, `"standard"` for a gamepad it knows. */
  mapping?: string;
  axes: ArrayLike<number>;
  buttons: ArrayLike<{ value: number; pressed: boolean }>;
}

export interface WheelInputOptions {
  /** Profiles to match devices against, most specific first. */
  profiles?: WheelProfile[];
  /**
   * Hand-wheel angle, degrees, that maps to full steer input: the vehicle's
   * `steering.ratio × steering.maxWheelAngleDeg`. Defaults to the profile's
   * rotation (so full lock on the wheel is full lock on the car).
   */
  steeringLockDeg?: number;
  /** The gear state to shift; share one between devices. */
  gears?: GearSelector;
  /**
   * Also match pads with the browser's `"standard"` gamepad mapping
   * (default false). Wheels report a non-standard mapping in Chromium;
   * leaving gamepads out keeps a pattern such as the generic profile's
   * `046d` (Logitech's vendor id) from taking a Logitech gamepad for a
   * wheel.
   */
  matchStandardPads?: boolean;
}

/** What the wheel input found on the last poll. */
export interface WheelStatus {
  profile: WheelProfile | undefined;
  wheel: GamepadLike | undefined;
  pedals: GamepadLike | undefined;
  /** Hand-wheel angle, degrees, positive right. */
  wheelAngleDeg: number;
}

export class WheelInput {
  private readonly profiles: WheelProfile[];
  steeringLockDeg: number | undefined;
  /** The gear state this wheel shifts. */
  readonly gears: GearSelector;
  private readonly matchStandardPads: boolean;
  private readonly wasPressed = new Map<string, boolean>();
  readonly status: WheelStatus = {
    profile: undefined,
    wheel: undefined,
    pedals: undefined,
    wheelAngleDeg: 0,
  };

  constructor(options: WheelInputOptions = {}) {
    this.profiles = options.profiles ?? builtinProfiles();
    this.steeringLockDeg = options.steeringLockDeg;
    this.gears = options.gears ?? new GearSelector();
    this.matchStandardPads = options.matchStandardPads ?? false;
  }

  /** Requested gear; −1 reverse, 0 neutral or drive, 1 … n. */
  get gear(): number {
    return this.gears.gear;
  }

  set gear(g: number) {
    this.gears.gear = g;
  }

  /** Replace the active profile set (after calibration). */
  setProfiles(profiles: WheelProfile[]): void {
    this.profiles.splice(0, this.profiles.length, ...profiles);
  }

  /** Pick the profile and devices for a set of connected gamepads. */
  match(pads: ArrayLike<GamepadLike | null | undefined>): WheelStatus {
    const list: GamepadLike[] = [];
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (p && p.connected && (this.matchStandardPads || p.mapping !== "standard")) list.push(p);
    }
    for (const profile of this.profiles) {
      const wheel = list.find((p) => matches(profile.match.wheel, p.id));
      if (!wheel) continue;
      const pedals = profile.match.pedals
        ? list.find((p) => p !== wheel && matches(profile.match.pedals!, p.id))
        : undefined;
      this.status.profile = profile;
      this.status.wheel = wheel;
      this.status.pedals = pedals;
      return this.status;
    }
    this.status.profile = undefined;
    this.status.wheel = undefined;
    this.status.pedals = undefined;
    return this.status;
  }

  private device(role: DeviceRole): GamepadLike | undefined {
    // A profile without separate pedals reads them from the wheel base.
    return role === "pedals" ? (this.status.pedals ?? this.status.wheel) : this.status.wheel;
  }

  private axis(b: AxisBinding | undefined): number | undefined {
    if (!b) return undefined;
    const d = this.device(b.device);
    if (!d) return undefined;
    const raw = d.axes[b.axis];
    return raw === undefined ? undefined : raw;
  }

  private pressed(b: ButtonBinding | undefined): boolean {
    if (!b) return false;
    const d = this.device(b.device);
    return d?.buttons[b.button]?.pressed ?? false;
  }

  /** Rising edge of a button since the last poll. */
  private risingEdge(key: string, b: ButtonBinding | undefined): boolean {
    const now = this.pressed(b);
    const before = this.wasPressed.get(key) ?? false;
    this.wasPressed.set(key, now);
    return now && !before;
  }

  /** Map the matched devices to a frame; undefined when no wheel is matched. */
  map(): InputFrame | undefined {
    const profile = this.status.profile;
    if (!profile || !this.status.wheel) return undefined;
    const frame = emptyFrame();
    const steerRaw = this.axis(profile.steer);
    const steerNorm =
      steerRaw === undefined ? 0 : calibrateCentred(steerRaw, profile.steer.calibration);
    const angle = steerNorm * 0.5 * profile.rotationDeg;
    this.status.wheelAngleDeg = angle;
    const lock = this.steeringLockDeg ?? 0.5 * profile.rotationDeg;
    frame.steer = clamp(angle / lock, -1, 1);
    const pedal = (b: AxisBinding | undefined): number => {
      const raw = this.axis(b);
      return raw === undefined || !b ? 0 : calibratePedal(raw, b.calibration);
    };
    frame.throttle = pedal(profile.throttle);
    frame.brake = pedal(profile.brake);
    frame.clutch = pedal(profile.clutch);
    frame.handbrake = this.pressed(profile.handbrake) ? 1 : 0;
    if (this.risingEdge("up", profile.shiftUp)) this.gears.up();
    if (this.risingEdge("down", profile.shiftDown)) this.gears.down();
    if (this.risingEdge("reverse", profile.reverse)) this.gears.toggleReverse();
    frame.gear = this.gears.gear;
    return frame;
  }

  /** Match and map the browser's gamepads; undefined without a wheel. */
  poll(): InputFrame | undefined {
    const nav = globalThis.navigator as Navigator | undefined;
    if (!nav || typeof nav.getGamepads !== "function") return undefined;
    this.match(nav.getGamepads() as ArrayLike<GamepadLike | null>);
    return this.map();
  }
}

function matches(pattern: string, id: string): boolean {
  try {
    // A leading `(?i)` asks for case-insensitive matching.
    const insensitive = pattern.startsWith("(?i)");
    const re = new RegExp(insensitive ? pattern.slice(4) : pattern, insensitive ? "i" : "");
    return re.test(id);
  } catch {
    return false;
  }
}

/** An axis {@link AxisFinder} found moving, with the raw range it saw. */
export interface AxisFound {
  device: DeviceRole;
  axis: number;
  /** Raw travel seen. */
  travel: number;
  /** Lowest and highest raw value seen. */
  min: number;
  max: number;
}

/**
 * Finds which axis the user is moving: feed it gamepad snapshots while they
 * press one pedal or turn the wheel, and it reports the axis with the most
 * travel once that travel is clear. Used by the setup flow to assign
 * controls without knowing the device's axis order.
 */
export class AxisFinder {
  private readonly lo = new Map<string, number>();
  private readonly hi = new Map<string, number>();

  sample(role: DeviceRole, pad: GamepadLike): void {
    for (let i = 0; i < pad.axes.length; i++) {
      const key = `${role}:${i}`;
      const v = pad.axes[i] ?? 0;
      this.lo.set(key, Math.min(this.lo.get(key) ?? v, v));
      this.hi.set(key, Math.max(this.hi.get(key) ?? v, v));
    }
  }

  /**
   * The moving axis once its travel exceeds `threshold`, else undefined,
   * leaving out the axes in `exclude` (ones already assigned, so brushing
   * the throttle while finding the brake does not pick the throttle
   * again). The result carries the range seen, and {@link binding} turns
   * it into a calibrated binding.
   */
  result(
    threshold = 0.5,
    exclude: ReadonlyArray<{ device: DeviceRole; axis: number }> = [],
  ): AxisFound | undefined {
    let best: AxisFound | undefined;
    for (const [key, lo] of this.lo) {
      const hi = this.hi.get(key) ?? lo;
      const travel = hi - lo;
      if (travel > threshold && (!best || travel > best.travel)) {
        const [device, axis] = key.split(":");
        const found: AxisFound = {
          device: device as DeviceRole,
          axis: Number(axis),
          travel,
          min: lo,
          max: hi,
        };
        if (exclude.some((e) => e.device === found.device && e.axis === found.axis)) continue;
        best = found;
      }
    }
    return best;
  }

  /**
   * A binding for a found axis, calibrated over the range seen. `rest` is
   * the axis's raw value at rest (released pedal, centred wheel): it sets a
   * centred axis's centre, and a pedal that reads high at rest is inverted.
   */
  binding(found: AxisFound, centred: boolean, rest?: number): AxisBinding {
    const cal = new AxisCalibrator(centred);
    cal.sample(found.min);
    cal.sample(found.max);
    if (rest !== undefined) cal.rest(rest);
    const calibration = cal.result() ?? {
      min: found.min,
      max: found.max,
      deadzone: centred ? 0.02 : 0.03,
      invert: false,
      exponent: 1,
    };
    return { device: found.device, axis: found.axis, calibration };
  }

  reset(): void {
    this.lo.clear();
    this.hi.clear();
  }
}
