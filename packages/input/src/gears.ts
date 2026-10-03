/**
 * One gear state for the car, shared by every device that can shift, so
 * the keyboard, a gamepad and a wheel agree on what the driver asked for
 * and an automatic never accumulates forward gears it ignores.
 */

/** Highest gear number the device layer will request. */
export const MAX_GEAR = 10;

/**
 * How the car's gearbox takes gear requests (see `VehicleInput.gear` in
 * `@skidpad/core`): an automatic only distinguishes reverse (−1) from drive
 * (0, the gearbox picks the gear); a manual takes −1 reverse, 0 neutral and
 * 1 … n.
 */
export type GearboxMode = "automatic" | "manual";

export interface GearSelectorOptions {
  /** Default `"manual"`, which requests any gear from −1 to `maxGear`. */
  mode?: GearboxMode;
  /** Highest forward gear a manual requests (default {@link MAX_GEAR}). */
  maxGear?: number;
  /** Starting gear (default 0: neutral, or drive for an automatic). */
  gear?: number;
}

/**
 * The requested gear, clamped to what the gearbox takes. For an automatic:
 * shift down from drive selects reverse, shift up from reverse selects
 * drive, and nothing goes past either. For a manual: one gear per shift,
 * reverse below neutral.
 */
export class GearSelector {
  private value = 0;
  private modeValue: GearboxMode;
  private maxValue: number;

  constructor(options: GearSelectorOptions = {}) {
    this.modeValue = options.mode ?? "manual";
    this.maxValue = Math.max(1, Math.floor(options.maxGear ?? MAX_GEAR));
    this.gear = options.gear ?? 0;
  }

  get mode(): GearboxMode {
    return this.modeValue;
  }

  /** Change the gearbox (a different car); the gear is clamped to it. */
  set mode(mode: GearboxMode) {
    this.modeValue = mode;
    this.gear = this.value;
  }

  get maxGear(): number {
    return this.maxValue;
  }

  set maxGear(n: number) {
    this.maxValue = Math.max(1, Math.floor(n));
    this.gear = this.value;
  }

  /** Highest gear this selector requests: 0 (drive) for an automatic. */
  get highest(): number {
    return this.modeValue === "automatic" ? 0 : this.maxValue;
  }

  /** The requested gear, for `VehicleInput.gear`. */
  get gear(): number {
    return this.value;
  }

  set gear(g: number) {
    const n = Number.isFinite(g) ? Math.round(g) : 0;
    this.value = Math.max(-1, Math.min(this.highest, n));
  }

  up(): void {
    this.gear = this.value + 1;
  }

  down(): void {
    this.gear = this.value - 1;
  }

  /** Reverse if not in reverse, else neutral (drive for an automatic). */
  toggleReverse(): void {
    this.gear = this.value < 0 ? 0 : -1;
  }
}
