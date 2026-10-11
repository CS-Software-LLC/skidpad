/**
 * Layout measures of a built circuit, for the tests and the preview script:
 * the numbers that decide whether every preset can drive it.
 */
import { SHOULDER, type CircuitGeometry } from "./geometry.js";

export interface LayoutStats {
  length: number;
  samples: number;
  /** Tightest plan radius, m, and where (distance along the lap). */
  minRadius: number;
  minRadiusAt: number;
  /** Steepest grade, as a fraction (0.08 = 8 %). */
  maxGrade: number;
  maxGradeAt: number;
  /** Tightest crest and sag radii in the vertical plane, m. */
  minCrestRadius: number;
  minCrestAt: number;
  minSagRadius: number;
  minSagAt: number;
  /** Largest banking, degrees. */
  maxBankDeg: number;
  /** Closest approach between two parts of the track more than 200 m apart along it, edge to edge, m. */
  minClearance: number;
  minClearanceAt: number;
  minElevation: number;
  maxElevation: number;
}

export function layoutStats(g: CircuitGeometry): LayoutStats {
  const S = g.samples;
  const N = S.length;
  const at = (i: number) => S[((i % N) + N) % N]!;
  const W = 4; // samples either side for the curvature estimates (10 m)
  let minRadius = Infinity;
  let minRadiusAt = 0;
  let maxGrade = 0;
  let maxGradeAt = 0;
  let minCrest = Infinity;
  let minCrestAt = 0;
  let minSag = Infinity;
  let minSagAt = 0;
  let maxBank = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < N; i++) {
    const a = at(i - W);
    const b = at(i);
    const c = at(i + W);
    // Plan radius through three points.
    const ab = Math.hypot(b.x - a.x, b.z - a.z);
    const bc = Math.hypot(c.x - b.x, c.z - b.z);
    const ca = Math.hypot(a.x - c.x, a.z - c.z);
    const cross = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
    const r = cross > 1e-9 ? (ab * bc * ca) / (2 * cross) : Infinity;
    if (r < minRadius) {
      minRadius = r;
      minRadiusAt = b.s;
    }
    const grade = Math.abs(b.ty) / Math.hypot(b.tx, b.tz);
    if (grade > maxGrade) {
      maxGrade = grade;
      maxGradeAt = b.s;
    }
    // Vertical curvature: second difference of elevation over plan distance.
    const h1 = ab;
    const h2 = bc;
    const ypp = (2 * ((c.y - b.y) / h2 - (b.y - a.y) / h1)) / (h1 + h2);
    if (ypp < 0 && -1 / ypp < minCrest) {
      minCrest = -1 / ypp;
      minCrestAt = b.s;
    }
    if (ypp > 0 && 1 / ypp < minSag) {
      minSag = 1 / ypp;
      minSagAt = b.s;
    }
    maxBank = Math.max(maxBank, Math.abs((b.bank * 180) / Math.PI));
    minY = Math.min(minY, b.y);
    maxY = Math.max(maxY, b.y);
  }
  // Clearance between distant parts of the track.
  let minClear = Infinity;
  let minClearAt = 0;
  const reach = (i: number) =>
    at(i).width / 2 + SHOULDER + Math.max(at(i).runoffWidthL, at(i).runoffWidthR);
  for (let i = 0; i < N; i += 2) {
    for (let j = 0; j < N; j += 2) {
      const ds = Math.abs(at(i).s - at(j).s);
      if (Math.min(ds, g.length - ds) < 200) continue;
      const d = Math.hypot(at(i).x - at(j).x, at(i).z - at(j).z) - reach(i) - reach(j);
      if (d < minClear) {
        minClear = d;
        minClearAt = at(i).s;
      }
    }
  }
  return {
    length: g.length,
    samples: N,
    minRadius,
    minRadiusAt,
    maxGrade,
    maxGradeAt,
    minCrestRadius: minCrest,
    minCrestAt,
    minSagRadius: minSag,
    minSagAt,
    maxBankDeg: maxBank,
    minClearance: minClear,
    minClearanceAt: minClearAt,
    minElevation: minY,
    maxElevation: maxY,
  };
}
