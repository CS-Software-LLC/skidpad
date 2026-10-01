/**
 * Carries Chrono's TMsimple tire into Skidpad's Magic Formula 5.2 model.
 *
 * TMsimple (Rill's TMeasy, simplified) describes each pure-slip curve by
 * three load-dependent numbers, the initial slope `dF0`, the peak `Fm` and
 * the sliding force `Fs`, each quadratic in `q = Fz / pn` through the values
 * quoted at `pn` and `2·pn`, and draws the curve as
 * `F(s) = Fm · sin(B · (1 − exp(−s / A)))` with `B = π − asin(Fs / Fm)` and
 * `A = Fm · B / dF0` (`ChTMsimpleTire.cpp`, `TMcombinedForces`).
 *
 * The Magic Formula reproduces two of those features exactly at every load:
 *   - the peak, because `Fm / Fz` is linear in load as `PDX1 + PDX2·dfz` is;
 *   - the longitudinal slope, because `dFx0` is quadratic in load as
 *     `Fz·(PKX1 + PKX2·dfz)` is.
 * The lateral slope follows Pacejka's `sin(2·atan(Fz / (PKY2·Fz0)))` and is
 * matched at the nominal load and at 1.5 times it. The shape `C` and
 * curvature `E` are least-squares fits to the TMsimple curve over the slip
 * range the manoeuvres use (`FIT_RANGE`), `E` at the same two loads. The fit
 * error is reported by `fitError`.
 *
 * TMsimple has no aligning moment, no camber force, no overturning moment
 * and no relaxation length, so those terms are scaled to zero and the
 * relaxation lengths set to the smallest value that keeps the deflection
 * transient meaningful (`vehicle.ts`).
 */
import type { TmSimpleTire } from "./chrono-e90.js";

export type Direction = "x" | "y";

/** TMsimple curve parameters at a load. */
export function tmCurve(t: TmSimpleTire, fz: number, dir: Direction) {
  const q = fz / t.pn;
  const quad = (pn: number, p2n: number) => (2 * pn - 0.5 * p2n) * q + (0.5 * p2n - pn) * q * q;
  return dir === "x"
    ? {
        fm: quad(t.fxmPn, t.fxmP2n),
        df0: quad(t.dfx0Pn, t.dfx0P2n),
        fs: quad(t.fxsPn, t.fxsP2n),
      }
    : {
        fm: quad(t.fymPn, t.fymP2n),
        df0: quad(t.dfy0Pn, t.dfy0P2n),
        fs: quad(t.fysPn, t.fysP2n),
      };
}

/** Pure-slip TMsimple force magnitude at slip `s` (≥ 0). */
export function tmForce(t: TmSimpleTire, fz: number, s: number, dir: Direction): number {
  const { fm, df0, fs } = tmCurve(t, fz, dir);
  const b = Math.PI - Math.asin(Math.min(1, Math.max(-1, fs / fm)));
  const a = (fm * b) / df0;
  return fm * Math.sin(b * (1 - Math.exp(-s / a)));
}

/** Slip at which the TMsimple curve peaks. */
export function tmPeakSlip(t: TmSimpleTire, fz: number, dir: Direction): number {
  const { fm, df0, fs } = tmCurve(t, fz, dir);
  const b = Math.PI - Math.asin(fs / fm);
  const a = (fm * b) / df0;
  return -a * Math.log(1 - Math.PI / (2 * b));
}

/** Magic Formula pure-slip curve `D·sin(C·atan(B·x − E·(B·x − atan(B·x))))`. */
export function magic(b: number, c: number, d: number, e: number, x: number): number {
  const bx = b * x;
  return d * Math.sin(c * Math.atan(bx - e * (bx - Math.atan(bx))));
}

/**
 * Shape `C` and curvature `E` that best reproduce the TMsimple curve at load
 * `fz` over slips `0 … sMax` (slip ratio, or slip angle in rad), least
 * squares; `fixedC` holds `C` and fits `E` only. Peak and slope are already
 * fixed by `D` and `K`, so these two only shape the rise and the fall past
 * the peak.
 */
function fitShape(
  t: TmSimpleTire,
  fz: number,
  dir: Direction,
  d: number,
  k: number,
  sMax: number,
  fixedC?: number,
): { c: number; e: number } {
  const n = 120;
  const target: number[] = [];
  for (let i = 1; i <= n; i++) {
    const x = (sMax * i) / n;
    target.push(tmForce(t, fz, dir === "y" ? Math.tan(x) : x, dir));
  }
  const cost = (c: number, e: number) => {
    if (e > 1) return Infinity;
    let sum = 0;
    for (let i = 1; i <= n; i++) {
      const x = (sMax * i) / n;
      const r = magic(k / (c * d), c, d, e, x) - target[i - 1]!;
      sum += r * r;
    }
    return sum;
  };
  let best = { c: fixedC ?? 1.5, e: 0, cost: Infinity };
  // Coarse grid, then shrinking pattern search.
  const cs =
    fixedC !== undefined ? [fixedC] : Array.from({ length: 41 }, (_, i) => 1.0 + i * 0.025);
  for (const c of cs) {
    for (let j = 0; j <= 60; j++) {
      const e = -2 + j * 0.05;
      const v = cost(c, e);
      if (v < best.cost) best = { c, e, cost: v };
    }
  }
  for (let step = 0.02; step > 1e-6; step *= 0.5) {
    let moved = true;
    while (moved) {
      moved = false;
      const dirs: [number, number][] =
        fixedC !== undefined
          ? [
              [0, 1],
              [0, -1],
            ]
          : [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ];
      for (const [dc, de] of dirs) {
        const c = best.c + dc * step;
        const e = best.e + de * step;
        const v = cost(c, e);
        if (v < best.cost) {
          best = { c, e, cost: v };
          moved = true;
        }
      }
    }
  }
  return { c: best.c, e: best.e };
}

/**
 * Slip ranges the shape is fitted over: the longitudinal curve out to a
 * locked wheel (slip ratio 1, the 100–0 km/h stop locks every wheel), the
 * lateral curve out to 0.3 rad (well past the peak near 0.12 rad; the
 * reference manoeuvres stay below it).
 */
export const FIT_RANGE = { x: 1.0, y: 0.3 };

/** Pacejka's lateral stiffness load factor. */
const kyShape = (fz: number, fz0: number, pky2: number) =>
  Math.sin(2 * Math.atan(fz / (pky2 * fz0)));

export type MfFit = ReturnType<typeof fitMagicFormula>;

/**
 * Magic Formula coefficients (lower-case `.tir` names) for a TMsimple tire
 * at nominal load `fz0`.
 */
export function fitMagicFormula(t: TmSimpleTire, fz0: number) {
  const fz1 = 1.5 * fz0;

  // Longitudinal: peak and slope are exact, linear and quadratic in load.
  const x0 = tmCurve(t, fz0, "x");
  const x1 = tmCurve(t, fz1, "x");
  const pdx1 = x0.fm / fz0;
  const pdx2 = (x1.fm / fz1 - pdx1) / 0.5;
  const pkx1 = x0.df0 / fz0;
  const pkx2 = (x1.df0 / fz1 - pkx1) / 0.5;
  const sx0 = fitShape(t, fz0, "x", x0.fm, x0.df0, FIT_RANGE.x);
  const sx1 = fitShape(t, fz1, "x", x1.fm, x1.df0, FIT_RANGE.x, sx0.c);
  const pcx1 = sx0.c;
  const pex1 = sx0.e;
  const pex2 = (sx1.e - pex1) / 0.5;

  // Lateral: peak exact; slope matched at the two loads through PKY2.
  const y0 = tmCurve(t, fz0, "y");
  const y1 = tmCurve(t, fz1, "y");
  const pdy1 = y0.fm / fz0;
  const pdy2 = (y1.fm / fz1 - pdy1) / 0.5;
  const ratio = y1.df0 / y0.df0;
  let lo = 0.3;
  let hi = 50;
  for (let i = 0; i < 100; i++) {
    const mid = 0.5 * (lo + hi);
    const r = kyShape(fz1, fz0, mid) / kyShape(fz0, fz0, mid);
    // The ratio rises toward 1.5 (linear) as PKY2 grows.
    if (r < ratio) lo = mid;
    else hi = mid;
  }
  const pky2 = 0.5 * (lo + hi);
  const pky1 = -y0.df0 / (fz0 * kyShape(fz0, fz0, pky2));
  const ky1 = -pky1 * fz0 * kyShape(fz1, fz0, pky2);
  const sy0 = fitShape(t, fz0, "y", y0.fm, y0.df0, FIT_RANGE.y);
  const sy1 = fitShape(t, fz1, "y", y1.fm, ky1, FIT_RANGE.y, sy0.c);
  const pcy1 = sy0.c;
  const pey1 = sy0.e;
  const pey2 = (sy1.e - pey1) / 0.5;

  return {
    fz0,
    unloadedRadius: t.unloadedRadius,
    pdx1,
    pdx2,
    pdx3: 0,
    pkx1,
    pkx2,
    pkx3: 0,
    pcx1,
    pex1,
    pex2,
    pex3: 0,
    pex4: 0,
    pdy1,
    pdy2,
    pdy3: 0,
    pky1,
    pky2,
    pky3: 0,
    pcy1,
    pey1,
    pey2,
    pey3: 0,
    pey4: 0,
    // TMsimple: no aligning moment, camber force, overturning moment or
    // force-offset moment.
    ltr: 0,
    lres: 0,
    ls: 0,
    lgay: 0,
    lgaz: 0,
    lmx: 0,
    lvmx: 0,
    qsy1: t.rollingResistance,
    qsy2: 0,
    qsy3: 0,
    qsy4: 0,
  };
}

/**
 * Largest difference between the fitted Magic Formula and TMsimple pure-slip
 * curves over the fitted slip ranges, as a fraction of the TMsimple peak, at
 * the given loads.
 */
export function fitError(t: TmSimpleTire, mf: MfFit, loads: number[]) {
  let worstX = 0;
  let worstY = 0;
  for (const fz of loads) {
    const dfz = (fz - mf.fz0) / mf.fz0;
    const dx = (mf.pdx1 + mf.pdx2 * dfz) * fz;
    const kx = fz * (mf.pkx1 + mf.pkx2 * dfz);
    const ex = Math.min(mf.pex1 + mf.pex2 * dfz, 1);
    const dy = (mf.pdy1 + mf.pdy2 * dfz) * fz;
    const ky = -mf.pky1 * mf.fz0 * kyShape(fz, mf.fz0, mf.pky2);
    const ey = Math.min(mf.pey1 + mf.pey2 * dfz, 1);
    const peakX = tmCurve(t, fz, "x").fm;
    const peakY = tmCurve(t, fz, "y").fm;
    for (let i = 1; i <= 200; i++) {
      const k = (FIT_RANGE.x * i) / 200;
      const fxMf = magic(kx / (mf.pcx1 * dx), mf.pcx1, dx, ex, k);
      worstX = Math.max(worstX, Math.abs(fxMf - tmForce(t, fz, k, "x")) / peakX);
      const a = (FIT_RANGE.y * i) / 200;
      const fyMf = magic(ky / (mf.pcy1 * dy), mf.pcy1, dy, ey, a);
      worstY = Math.max(worstY, Math.abs(fyMf - tmForce(t, fz, Math.tan(a), "y")) / peakY);
    }
  }
  return { longitudinal: worstX, lateral: worstY };
}
