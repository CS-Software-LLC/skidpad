/** Pure input filters: clamping, dead zones, response curves and ramps. */

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
