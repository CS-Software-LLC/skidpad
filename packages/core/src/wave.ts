/**
 * Deterministic test waveforms built from basic arithmetic only.
 *
 * `Math.sin` and friends are implementation-approximated by the ECMAScript
 * specification and differ across engines in the last bit (observed between
 * Chromium and Node while building the determinism harness). Scripted inputs
 * for replays, golden results, and cross-platform tests must therefore avoid
 * them. Addition, multiplication, division, and remainder are IEEE-754
 * correctly rounded everywhere, so these helpers are bit-exact on every
 * engine.
 */

/**
 * Triangle wave in [−1, 1] with the given integer period, starting at 0 and
 * rising. `step` and `phase` are integers; `period` must be a positive even
 * integer for an exactly symmetric wave.
 */
export function triangleWave(step: number, period: number, phase = 0): number {
  const p = Math.max(2, Math.floor(period));
  const k = (((Math.floor(step) + Math.floor(phase)) % p) + p) % p;
  const half = p / 2;
  // Rises from −1 to +1 over the first half, falls back over the second.
  return k < half ? (2 * k) / half - 1 : 3 - (2 * k) / half;
}

/**
 * Smooth, sine-like wave in [−1, 1] from a triangle wave through a cubic
 * (`1.5x − 0.5x³`), still basic arithmetic only.
 */
export function smoothWave(step: number, period: number, phase = 0): number {
  const x = triangleWave(step, period, phase);
  return 1.5 * x - 0.5 * x * x * x;
}
