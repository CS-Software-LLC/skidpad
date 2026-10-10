/**
 * Carries Chrono's Sedan tire (`reference/sedan/Sedan_Pac02Tire.tir`, a
 * PAC2002 property file) into Skidpad's Magic Formula 5.2 model.
 *
 * Both evaluate Pacejka's MF 5.2 pure-slip equations from the same file,
 * but Chrono 9.0.1's `ChPac02Tire` departs from the published model in ways
 * that change what its car does, so the file cannot be loaded unchanged:
 *
 *   - It clamps `B·κ` and `B·α` to just under π/2 before the formula
 *     (`CalcFxyMz`), so each pure-slip force rises to about its peak and
 *     stays there instead of falling toward `D·sin(C·π/2)`. A locked
 *     wheel keeps nearly the peak force.
 *   - Its camber state is never set from the wheel (`m_states.gamma` stays
 *     zero), so camber produces no force or moment.
 *   - It mirrors the asymmetric coefficients (`PHY1`, `PVY1`, `PEY3`, …)
 *     on the right-hand tires, and evaluates the formula at `−α` before
 *     negating the force, so the left and right tires' offsets push inward
 *     as a pair, as toe-in would. Skidpad's tire has no side, so the same
 *     file would push all four tires the same way.
 *   - It combines slips with a friction ellipse, not with the file's
 *     combined-slip coefficients (it has none), and has no rolling
 *     resistance (no `[ROLLING_COEFFICIENTS]`, so `QSY1 = 0`).
 *
 * So Skidpad's tire takes the file's peak friction and slip stiffness
 * exactly at every load (`PDX*`, `PKX*`, `PDY*`, `PKY*`), and fits the shape
 * `C` and curvature `E` of each pure-slip curve, least squares, to the odd
 * part of Chrono's clamped curve, as `tire-fit.ts` does for the E90's
 * TMsimple tire. The inward offsets become an equivalent static toe-in
 * (`offsetToe`). Camber terms, the asymmetric terms and rolling resistance
 * are set to zero. Combined slip stays Skidpad's (a structural gap).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { referenceDir } from "./reference.js";
import { magic } from "./tire-fit.js";

export type Tir = Record<string, number>;

/** Numeric keys of a `.tir` file, upper case. */
export function parseTir(text: string): Tir {
  const out: Tir = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/[$!].*$/, "").trim();
    const m = /^([A-Za-z0-9_]+)\s*=\s*([-+0-9.eE]+)$/.exec(line);
    if (m) out[m[1]!.toUpperCase()] = Number(m[2]);
  }
  return out;
}

export function loadSedanTir(): Tir {
  return parseTir(readFileSync(join(referenceDir("sedan"), "Sedan_Pac02Tire.tir"), "utf8"));
}

/** A coefficient, with Chrono's default when the file leaves it out (scale factors 1, others 0). */
const coef = (p: Tir, k: string) => p[k] ?? (k.startsWith("L") ? 1 : 0);

/** Keys `ChPac02Tire::Initialize` negates on the side the tire was not measured on. */
const MIRRORED = [
  "RHX1",
  "QSX1",
  "PEY3",
  "PHY1",
  "PHY2",
  "PVY1",
  "PVY2",
  "RBY3",
  "RVY1",
  "RVY2",
  "QBZ4",
  "QDZ3",
  "QDZ6",
  "QDZ7",
  "QEZ4",
  "QHZ1",
  "QHZ2",
  "SSZ1",
];

/** The coefficients Chrono uses on a right-hand tire of a left-measured file. */
export function mirrored(p: Tir): Tir {
  const out = { ...p };
  for (const k of MIRRORED) out[k] = -coef(p, k);
  return out;
}

const CLAMP = Math.PI / 2 - 0.01;
const clamp = (x: number) => Math.max(-CLAMP, Math.min(CLAMP, x));

/** Nominal load as Chrono uses it, `FNOMIN · LFZO`, N. */
export const fz0Prime = (p: Tir) => coef(p, "FNOMIN") * coef(p, "LFZO");

/**
 * Chrono's pure longitudinal force, N, at slip ratio `kappa` and load `fz`
 * (`CalcFxyMz`, zero camber and pressure change, terrain friction equal to
 * the tire's reference).
 */
export function chronoFx(p: Tir, fz: number, kappa: number): number {
  const dfz = (fz - fz0Prime(p)) / fz0Prime(p);
  const cx = coef(p, "PCX1") * coef(p, "LCX");
  const shx = (coef(p, "PHX1") + coef(p, "PHX2") * dfz) * coef(p, "LHX");
  const svx = fz * (coef(p, "PVX1") + coef(p, "PVX2") * dfz) * coef(p, "LVX") * coef(p, "LMUX");
  const kx = kappa + shx;
  const ex = Math.min(
    (coef(p, "PEX1") + coef(p, "PEX2") * dfz + coef(p, "PEX3") * dfz * dfz) *
      (1 - coef(p, "PEX4") * Math.sign(kx)) *
      coef(p, "LEX"),
    1,
  );
  const dx = Math.abs((coef(p, "PDX1") + coef(p, "PDX2") * dfz) * coef(p, "LMUX")) * fz;
  const kxk =
    fz *
    (coef(p, "PKX1") + coef(p, "PKX2") * dfz) *
    Math.exp(coef(p, "PKX3") * dfz) *
    coef(p, "LKX");
  const bx = kxk / (cx * dx + 0.1);
  const x1 = clamp(bx * kx);
  return dx * Math.sin(cx * Math.atan(x1 - ex * (x1 - Math.atan(x1)))) + svx;
}

/**
 * Chrono's pure lateral force on a tire, N, in Skidpad's (ISO) convention:
 * `alpha` is the ISO slip angle, positive with the contact sliding left,
 * which gives a negative force. Chrono evaluates its formula at `−alpha`
 * and negates the result.
 */
export function chronoFy(p: Tir, fz: number, alpha: number): number {
  const a = -alpha;
  const fz0 = fz0Prime(p);
  const dfz = (fz - fz0) / fz0;
  const cy = coef(p, "PCY1") * coef(p, "LCY");
  const ky =
    coef(p, "PKY1") *
    coef(p, "FNOMIN") *
    Math.sin(2 * Math.atan(fz / (coef(p, "PKY2") * fz0))) *
    coef(p, "LFZO") *
    coef(p, "LMUY");
  const shy = (coef(p, "PHY1") + coef(p, "PHY2") * dfz) * coef(p, "LHY");
  const ay = a + shy;
  const svy = fz * (coef(p, "PVY1") + coef(p, "PVY2") * dfz) * coef(p, "LVY") * coef(p, "LMUY");
  const ey = Math.min(
    (coef(p, "PEY1") + coef(p, "PEY2") * dfz) *
      (1 - coef(p, "PEY3") * Math.sign(ay)) *
      coef(p, "LEY"),
    1,
  );
  const dy = Math.abs((coef(p, "PDY1") + coef(p, "PDY2") * dfz) * coef(p, "LMUY")) * fz;
  const by = ky / (cy * dy + 0.1);
  const y1 = clamp(by * ay);
  return -(dy * Math.sin(cy * Math.atan(y1 - ey * (y1 - Math.atan(y1)))) + svy);
}

/** The left and right tires' mean, odd in slip angle: what an axle of mirrored tires gives. */
export function chronoFyOdd(p: Tir, fz: number, alpha: number): number {
  return 0.5 * (chronoFy(p, fz, alpha) - chronoFy(p, fz, -alpha));
}

/**
 * Toe-in, degrees per wheel, that gives a tire with no offsets the same
 * lateral force when rolling straight as Chrono's left tire has from its
 * offsets at load `fz` (the right tire mirrors it). Positive pushes both
 * tires inward, as toe-in does.
 */
export function offsetToe(p: Tir, fz: number): number {
  const h = 1e-4;
  const slope = (chronoFyOdd(p, fz, h) - chronoFyOdd(p, fz, -h)) / (2 * h);
  // A left wheel toed in by δ runs at an ISO slip angle of +δ, and pushes inward (−y).
  return ((chronoFy(p, fz, 0) / slope) * 180) / Math.PI;
}

/** Slip ranges the shape is fitted over, as `tire-fit.ts`: to a locked wheel, and 0.3 rad. */
export const FIT_RANGE = { x: 1.0, y: 0.3 };

/** Shape `C` and curvature `E` best reproducing `target` over `0 … sMax`, least squares. */
function fitShape(
  target: (s: number) => number,
  d: number,
  k: number,
  sMax: number,
  fixedC?: number,
): { c: number; e: number } {
  const n = 150;
  const xs = Array.from({ length: n }, (_, i) => (sMax * (i + 1)) / n);
  const ys = xs.map(target);
  const cost = (c: number, e: number) =>
    e > 1
      ? Infinity
      : xs.reduce((s, x, i) => s + (magic(k / (c * d), c, d, e, x) - ys[i]!) ** 2, 0);
  let best = { c: fixedC ?? 1.5, e: 0, cost: Infinity };
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

/** Peak force and slope at the origin of Chrono's curves at a load (both exact in the fit). */
function peakAndSlope(p: Tir, fz: number) {
  const fz0 = fz0Prime(p);
  const dfz = (fz - fz0) / fz0;
  return {
    dx: (coef(p, "PDX1") + coef(p, "PDX2") * dfz) * fz,
    kx: fz * (coef(p, "PKX1") + coef(p, "PKX2") * dfz) * Math.exp(coef(p, "PKX3") * dfz),
    dy: (coef(p, "PDY1") + coef(p, "PDY2") * dfz) * fz,
    ky: Math.abs(coef(p, "PKY1") * fz0 * Math.sin(2 * Math.atan(fz / (coef(p, "PKY2") * fz0)))),
  };
}

/**
 * The Magic Formula overrides (lower-case `.tir` names) that make Skidpad's
 * import of the file behave as Chrono's tire: `C` from the nominal load,
 * `E` from it and 1.5 times it, the rest as the module comment says.
 */
export function fitPac02(p: Tir) {
  const fz0 = fz0Prime(p);
  const fz1 = 1.5 * fz0;
  const a = peakAndSlope(p, fz0);
  const b = peakAndSlope(p, fz1);
  const sx0 = fitShape((k) => chronoFx(p, fz0, k), a.dx, a.kx, FIT_RANGE.x);
  const sx1 = fitShape((k) => chronoFx(p, fz1, k), b.dx, b.kx, FIT_RANGE.x, sx0.c);
  const sy0 = fitShape((t) => -chronoFyOdd(p, fz0, t), a.dy, a.ky, FIT_RANGE.y);
  const sy1 = fitShape((t) => -chronoFyOdd(p, fz1, t), b.dy, b.ky, FIT_RANGE.y, sy0.c);
  return {
    pcx1: sx0.c,
    pex1: sx0.e,
    pex2: (sx1.e - sx0.e) / 0.5,
    pex3: 0,
    pex4: 0,
    pcy1: sy0.c,
    pey1: sy0.e,
    pey2: (sy1.e - sy0.e) / 0.5,
    pey3: 0,
    pey4: 0,
    // Offsets that Chrono mirrors left to right: carried as toe (`offsetToe`).
    phy1: 0,
    phy2: 0,
    pvy1: 0,
    pvy2: 0,
    qhz1: 0,
    qhz2: 0,
    qdz6: 0,
    qdz7: 0,
    ssz1: 0,
    // No camber in Chrono's tire.
    pdx3: 0,
    rvy3: 0,
    lgay: 0,
    lgaz: 0,
    // No rolling resistance in Chrono's tire.
    qsy1: 0,
    qsy2: 0,
    qsy3: 0,
    qsy4: 0,
  };
}

export type Pac02Fit = ReturnType<typeof fitPac02>;

/**
 * Largest difference between the fitted Magic Formula and Chrono's
 * pure-slip curves over the fitted ranges, as a fraction of Chrono's peak,
 * at the given loads.
 */
export function fitError(p: Tir, fit: Pac02Fit, loads: number[]) {
  const fz0 = fz0Prime(p);
  let worstX = 0;
  let worstY = 0;
  for (const fz of loads) {
    const dfz = (fz - fz0) / fz0;
    const { dx, kx, dy, ky } = peakAndSlope(p, fz);
    const ex = Math.min(fit.pex1 + fit.pex2 * dfz, 1);
    const ey = Math.min(fit.pey1 + fit.pey2 * dfz, 1);
    for (let i = 1; i <= 200; i++) {
      const k = (FIT_RANGE.x * i) / 200;
      const fx = magic(kx / (fit.pcx1 * dx), fit.pcx1, dx, ex, k);
      worstX = Math.max(worstX, Math.abs(fx - chronoFx(p, fz, k)) / dx);
      const t = (FIT_RANGE.y * i) / 200;
      const fy = magic(ky / (fit.pcy1 * dy), fit.pcy1, dy, ey, t);
      worstY = Math.max(worstY, Math.abs(fy + chronoFyOdd(p, fz, t)) / dy);
    }
  }
  return { longitudinal: worstX, lateral: worstY };
}
