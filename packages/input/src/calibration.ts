/**
 * Axis calibration and device profiles. A raw gamepad axis becomes a steer
 * value in −1 … 1 or a pedal in 0 … 1 through a calibration the user records
 * once (end stops, rest position, dead zone, inversion); a profile binds the
 * axes and buttons of a wheel and its pedals to the input frame and is
 * stored as plain JSON.
 */
import { clamp, responseCurve } from "./filters.js";

export interface AxisCalibration {
  /** Raw value at one end stop (or the pedal at rest). */
  min: number;
  /** Raw value at the other end stop (or the pedal fully pressed). */
  max: number;
  /** Raw value at rest, for centred axes; omitted for pedals. */
  center?: number;
  /** Fraction of the range around the centre (or above rest) ignored. */
  deadzone: number;
  invert: boolean;
  /** Response curve exponent; 1 is linear. */
  exponent: number;
}

export function defaultCentredCalibration(): AxisCalibration {
  return { min: -1, max: 1, center: 0, deadzone: 0.02, invert: false, exponent: 1 };
}

export function defaultPedalCalibration(): AxisCalibration {
  // Most wheels report pedals as −1 (released) … 1 (pressed).
  return { min: -1, max: 1, deadzone: 0.03, invert: false, exponent: 1 };
}

/** Apply a centred calibration: −1 … 1 with the dead zone rescaled away. */
export function calibrateCentred(raw: number, c: AxisCalibration): number {
  const center = c.center ?? 0.5 * (c.min + c.max);
  const half = raw >= center ? c.max - center : center - c.min;
  if (!(Math.abs(half) > 1e-9)) return 0;
  let v = clamp((raw - center) / half, -1, 1);
  if (c.invert) v = -v;
  const a = Math.abs(v);
  if (a <= c.deadzone) return 0;
  v = Math.sign(v) * clamp((a - c.deadzone) / (1 - c.deadzone), 0, 1);
  return responseCurve(v, c.exponent);
}

/** Apply a pedal calibration: 0 (rest) … 1 (fully pressed). */
export function calibratePedal(raw: number, c: AxisCalibration): number {
  const span = c.max - c.min;
  if (!(Math.abs(span) > 1e-9)) return 0;
  let v = clamp((raw - c.min) / span, 0, 1);
  if (c.invert) v = 1 - v;
  if (v <= c.deadzone) return 0;
  v = clamp((v - c.deadzone) / (1 - c.deadzone), 0, 1);
  return responseCurve(v, c.exponent);
}

/**
 * Records the travel of an axis while the user moves it to both end stops,
 * then returns a calibration. For a centred axis call `rest()` with the
 * wheel released first.
 */
export class AxisCalibrator {
  private lo = Infinity;
  private hi = -Infinity;
  private restValue: number | undefined;
  private samples = 0;

  constructor(private readonly centred: boolean) {}

  /** Mark the current raw value as the rest position. */
  rest(raw: number): void {
    this.restValue = raw;
  }

  sample(raw: number): void {
    if (!Number.isFinite(raw)) return;
    this.lo = Math.min(this.lo, raw);
    this.hi = Math.max(this.hi, raw);
    this.samples++;
  }

  /** Raw travel seen so far; a calibration needs clearly more than noise. */
  get travel(): number {
    return this.samples > 0 ? this.hi - this.lo : 0;
  }

  reset(): void {
    this.lo = Infinity;
    this.hi = -Infinity;
    this.restValue = undefined;
    this.samples = 0;
  }

  /** The calibration, or undefined when too little travel was seen. */
  result(deadzone = this.centred ? 0.02 : 0.03): AxisCalibration | undefined {
    if (this.travel < 0.2) return undefined;
    const base: AxisCalibration = {
      min: this.lo,
      max: this.hi,
      deadzone,
      invert: false,
      exponent: 1,
    };
    if (this.centred) {
      base.center = this.restValue ?? 0.5 * (this.lo + this.hi);
    } else if (this.restValue !== undefined && this.restValue > 0.5 * (this.lo + this.hi)) {
      // The pedal reads high at rest: it is inverted.
      base.invert = true;
    }
    return base;
  }
}

/** Where an axis or button lives: on the wheel base or on a separate pedal set. */
export type DeviceRole = "wheel" | "pedals";

export interface AxisBinding {
  device: DeviceRole;
  axis: number;
  calibration: AxisCalibration;
}

export interface ButtonBinding {
  device: DeviceRole;
  button: number;
}

/** A wheel (and optionally separate pedals) mapped onto the input frame. */
export interface WheelProfile {
  id: string;
  name: string;
  /**
   * Regular expressions (JavaScript syntax, as strings) matched against
   * `Gamepad.id` to pick the devices. A leading `(?i)` makes the match
   * case-insensitive, as JavaScript has no inline flag. Pads with the
   * standard gamepad mapping are not considered unless `WheelInput` is
   * told to (`matchStandardPads`).
   */
  match: { wheel: string; pedals?: string };
  /** Physical rotation of the wheel, lock to lock, degrees. */
  rotationDeg: number;
  steer: AxisBinding;
  throttle: AxisBinding;
  brake: AxisBinding;
  clutch?: AxisBinding;
  handbrake?: ButtonBinding;
  shiftUp?: ButtonBinding;
  shiftDown?: ButtonBinding;
  /** Toggles between drive and reverse (for sequential paddles with no reverse). */
  reverse?: ButtonBinding;
}

export const PROFILE_FORMAT = 1;

/** Minimal storage shape (`localStorage` or anything with the same methods). */
export interface ProfileStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const KEY = "skidpad.input.profiles";

export function loadProfiles(storage: ProfileStorage | undefined): WheelProfile[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { format?: number; profiles?: WheelProfile[] };
    if (parsed.format !== PROFILE_FORMAT || !Array.isArray(parsed.profiles)) return [];
    return parsed.profiles;
  } catch {
    return [];
  }
}

export function saveProfiles(storage: ProfileStorage | undefined, profiles: WheelProfile[]): void {
  if (!storage) return;
  try {
    storage.setItem(KEY, JSON.stringify({ format: PROFILE_FORMAT, profiles }));
  } catch {
    // Storage full or blocked: the profile lives for this session only.
  }
}

/**
 * Built-in starting profiles. Axis numbers are how Chromium exposes these
 * devices as gamepads and are starting points for the calibration flow,
 * not guarantees [VERIFY on hardware]: the sandbox's setup panel assigns
 * each control by moving it, which overrides them.
 */
export function builtinProfiles(): WheelProfile[] {
  const pedal = (device: DeviceRole, axis: number): AxisBinding => ({
    device,
    axis,
    calibration: defaultPedalCalibration(),
  });
  return [
    {
      id: "logitech-g-pro",
      name: "Logitech G PRO Racing Wheel + PRO Racing Pedals",
      // The wheel base and the pedals enumerate as two gamepads when the
      // pedals are on their own USB lead.
      // Not "046d.*Pro": Chromium ids read "Vendor: 046d Product: …", so
      // that matched every Logitech device.
      match: { wheel: "PRO Racing Wheel|046d Product: (c272|c268)\\b", pedals: "Pedals|Pedal" },
      rotationDeg: 900,
      steer: { device: "wheel", axis: 0, calibration: defaultCentredCalibration() },
      throttle: pedal("pedals", 0),
      brake: pedal("pedals", 1),
      clutch: pedal("pedals", 2),
      handbrake: { device: "wheel", button: 3 },
      shiftUp: { device: "wheel", button: 5 },
      shiftDown: { device: "wheel", button: 4 },
      reverse: { device: "wheel", button: 2 },
    },
    {
      id: "logitech-g29-g923",
      name: "Logitech G29 / G923 (pedals on the wheel base)",
      match: { wheel: "046d.*(G29|G923|c24f|c266|c267|c26e|c26d)|Logitech.*G92" },
      rotationDeg: 900,
      steer: { device: "wheel", axis: 0, calibration: defaultCentredCalibration() },
      throttle: pedal("wheel", 2),
      brake: pedal("wheel", 5),
      clutch: pedal("wheel", 1),
      handbrake: { device: "wheel", button: 3 },
      shiftUp: { device: "wheel", button: 5 },
      shiftDown: { device: "wheel", button: 4 },
    },
    {
      id: "generic-wheel",
      name: "Generic wheel (calibrate to use)",
      match: { wheel: "(?i)wheel|racing|046d|044f|0eb7|2433|3416" },
      rotationDeg: 900,
      steer: { device: "wheel", axis: 0, calibration: defaultCentredCalibration() },
      throttle: pedal("wheel", 1),
      brake: pedal("wheel", 2),
    },
  ];
}
