/**
 * Steering wheels and pedal sets over the Gamepad API, mapped through a
 * calibrated profile. Steering is scaled by the vehicle's own lock, so a
 * 900° wheel turns the road wheels exactly as the definition's steering
 * ratio says and the force-feedback torque means what the core computed.
 */
import {
  builtinProfiles,
  calibrateCentred,
  calibratePedal,
  type AxisBinding,
  type ButtonBinding,
  type DeviceRole,
  type WheelProfile,
} from "./calibration.js";
import { clamp } from "./filters.js";
import { emptyFrame, MAX_GEAR, type InputFrame } from "./index.js";

/** The subset of `Gamepad` the mapping reads; plain objects work in tests. */
export interface GamepadLike {
  id: string;
  index: number;
  connected: boolean;
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
  /** Requested gear, held here like the keyboard does. */
  gear = 0;
  private readonly wasPressed = new Map<string, boolean>();
  private reverse = false;
  readonly status: WheelStatus = {
    profile: undefined,
    wheel: undefined,
    pedals: undefined,
    wheelAngleDeg: 0,
  };

  constructor(options: WheelInputOptions = {}) {
    this.profiles = options.profiles ?? builtinProfiles();
    this.steeringLockDeg = options.steeringLockDeg;
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
      if (p && p.connected) list.push(p);
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
    if (this.risingEdge("up", profile.shiftUp)) this.gear = Math.min(MAX_GEAR, this.gear + 1);
    if (this.risingEdge("down", profile.shiftDown)) this.gear = Math.max(-1, this.gear - 1);
    if (this.risingEdge("reverse", profile.reverse)) {
      this.reverse = !this.reverse;
      this.gear = this.reverse ? -1 : 0;
    }
    frame.gear = this.gear;
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

  /** The moving axis once its travel exceeds `threshold`, else undefined. */
  result(threshold = 0.5): { device: DeviceRole; axis: number; travel: number } | undefined {
    let best: { device: DeviceRole; axis: number; travel: number } | undefined;
    for (const [key, lo] of this.lo) {
      const travel = (this.hi.get(key) ?? lo) - lo;
      if (travel > threshold && (!best || travel > best.travel)) {
        const [device, axis] = key.split(":");
        best = { device: device as DeviceRole, axis: Number(axis), travel };
      }
    }
    return best;
  }

  reset(): void {
    this.lo.clear();
    this.hi.clear();
  }
}
