/**
 * Circuit geometry: one renderer-free description of the track that both the
 * scene and the Rapier world are built from, so what is drawn is what is
 * driven on. No three.js or Rapier imports; everything is plain arrays.
 *
 * Coordinates are three.js world coordinates (y up), as the rest of the
 * sandbox uses: the core's ISO frame maps as (x, y, z) → (x, z, −y). "Left"
 * is the driver's left, which is the core's +y and three's −z when heading
 * along +x.
 */

/** What a strip of ground is, which picks its surface in the surface table. */
export type SurfaceKind = "asphalt" | "kerb" | "grass" | "gravel";
export type RunoffKind = "grass" | "gravel";
export type BarrierKind = "wall" | "tyres";
export type Side = "left" | "right";

/** A point the centreline passes through. */
export interface ControlPoint {
  x: number;
  z: number;
  /** Elevation, m. */
  y: number;
  /** Asphalt width, m (default the circuit's). */
  width?: number;
  /** Banking, degrees; positive raises the left edge (for right-hand corners). */
  bank?: number;
}

/**
 * A feature along part of the lap, between two positions given in control
 * point units: `from: 4.5, to: 5.5` runs from halfway between points 4 and 5
 * to halfway between points 5 and 6. Ranges may wrap past the last point.
 */
export interface Range {
  side: Side;
  from: number;
  to: number;
}

export interface CircuitDescription {
  name: string;
  points: ControlPoint[];
  /** Default asphalt width, m. */
  width: number;
  /** Default runoff width beyond the shoulder, m. */
  runoffWidth: number;
  kerbs: Range[];
  gravel: Array<Range & { width?: number }>;
  /** Wider grass runoff where a default would be too tight. */
  wideRunoff?: Array<Range & { width: number }>;
  barriers: Array<Range & { kind: BarrierKind }>;
  /** Start/finish and the two sector lines, in control point units. */
  gates: [number, number, number];
  /** Grid position behind the start/finish line, m. */
  gridBehind: number;
}

/** One cross-section of the track, every {@link SAMPLE_SPACING} metres. */
export interface Sample {
  /** Centre of the asphalt. */
  x: number;
  y: number;
  z: number;
  /** Distance from sample 0 along the centreline, m. */
  s: number;
  /** Position in control point units, for features. */
  u: number;
  /** Unit tangent, 3D. */
  tx: number;
  ty: number;
  tz: number;
  /** Unit left in plan (x, z). */
  lx: number;
  lz: number;
  width: number;
  /** Banking, rad, positive raising the left edge. */
  bank: number;
  /** Kerb height on each side (0 where there is none), m. */
  kerbL: number;
  kerbR: number;
  runoffL: RunoffKind;
  runoffR: RunoffKind;
  runoffWidthL: number;
  runoffWidthR: number;
}

/** A mesh for one surface kind: positions, indices and per-vertex colours. */
export interface SurfaceMesh {
  kind: SurfaceKind;
  positions: Float32Array;
  indices: Uint32Array;
  /** RGB in 0..1, per vertex. */
  colors: Float32Array;
}

/** A barrier block: a box, in world coordinates. */
export interface BarrierBox {
  kind: BarrierKind;
  center: [number, number, number];
  halfExtents: [number, number, number];
  /** Rotation quaternion `[x, y, z, w]`. */
  quat: [number, number, number, number];
}

/** A timing line across the track, in plan. */
export interface Gate {
  /** Index of the sample the gate sits on. */
  index: number;
  /** Distance of the gate from sample 0, m. */
  s: number;
  /** End points in plan, (x, z). */
  a: [number, number];
  b: [number, number];
  /** Forward direction in plan. */
  forward: [number, number];
}

/** A pose to put the car in: position of the ground under the CG and heading. */
export interface SpawnPose {
  x: number;
  y: number;
  z: number;
  /** Heading as the core's yaw: 0 along +x, positive turning left. */
  yaw: number;
  /** Grade along the heading, rad, positive uphill. */
  pitch: number;
}

export interface Terrain {
  positions: Float32Array;
  indices: Uint32Array;
  /** The grid: corner (x, z), spacing and node counts. */
  minX: number;
  minZ: number;
  spacing: number;
  nx: number;
  nz: number;
}

export interface CircuitGeometry {
  description: CircuitDescription;
  samples: Sample[];
  length: number;
  surfaces: SurfaceMesh[];
  terrain: Terrain;
  barriers: BarrierBox[];
  gates: Gate[];
  grid: SpawnPose;
}

/** Spacing of the cross-sections, m. */
export const SAMPLE_SPACING = 2.5;
/**
 * Columns the asphalt is split into across its width: a metre or less on the
 * widest asphalt (13 m). A fixed count keeps the vertices of one row's far
 * section and the next row's near section identical, so the mesh welds.
 */
export const ASPHALT_COLUMNS = 13;
/** Shoulder outside the asphalt that carries the kerb where there is one, m. */
export const SHOULDER = 1.2;
/** Painted edge line inside the shoulder, m. */
const EDGE_LINE = 0.25;
/** Height of a kerb's top, m: low enough for the kart and the open-wheeler. */
export const KERB_HEIGHT = 0.035;
/** How far the runoff falls across its width, m. */
const RUNOFF_FALL = 0.12;
/** The terrain sits this far below the runoff's outer edge, m. */
export const TERRAIN_DROP = 0.1;
/** Under the track the terrain follows it this far down, hidden and out of the wheels' way, m. */
const UNDER_TRACK = 0.2;
/** Kerbs ramp up and down over this many samples at their ends. */
const KERB_RAMP = 3;

const BARRIER_HEIGHT = 1.0;
const BARRIER_THICKNESS = 1.4;
/** Barrier blocks span this many samples. */
const BARRIER_SPAN = 4;
const TERRAIN_SPACING = 6;
const TERRAIN_MARGIN = 160;

// ---------------------------------------------------------------------------
// Splines

/** Centripetal Catmull-Rom between p1 and p2 at local t (Barry–Goldman). */
function catmullRom3(
  p0: readonly number[],
  p1: readonly number[],
  p2: readonly number[],
  p3: readonly number[],
  t: number,
  out: number[],
): void {
  const knot = (a: readonly number[], b: readonly number[]) => {
    let d = 0;
    for (let i = 0; i < 3; i++) d += (b[i]! - a[i]!) ** 2;
    return Math.max(Math.sqrt(Math.sqrt(d)), 1e-6);
  };
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const tt = t1 + (t2 - t1) * t;
  for (let i = 0; i < 3; i++) {
    const a1 = ((t1 - tt) * p0[i]! + (tt - t0) * p1[i]!) / (t1 - t0);
    const a2 = ((t2 - tt) * p1[i]! + (tt - t1) * p2[i]!) / (t2 - t1);
    const a3 = ((t3 - tt) * p2[i]! + (tt - t2) * p3[i]!) / (t3 - t2);
    const b1 = ((t2 - tt) * a1 + (tt - t0) * a2) / (t2 - t0);
    const b2 = ((t3 - tt) * a2 + (tt - t1) * a3) / (t3 - t1);
    out[i] = ((t2 - tt) * b1 + (tt - t1) * b2) / (t2 - t1);
  }
}

/** Uniform Catmull-Rom of a scalar; smooth and passes through the values. */
function catmullRom1(v0: number, v1: number, v2: number, v3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * v1 +
      (-v0 + v2) * t +
      (2 * v0 - 5 * v1 + 4 * v2 - v3) * t2 +
      (-v0 + 3 * v1 - 3 * v2 + v3) * t3)
  );
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Whether control-point position `u` lies in `[from, to)` on a loop of `n` points. */
export function inRange(u: number, from: number, to: number, n: number): boolean {
  const a = mod(from, n);
  const len = mod(to - from, n) || (to !== from ? n : 0);
  return mod(u - a, n) < len;
}

// ---------------------------------------------------------------------------
// Centreline

function buildSamples(desc: CircuitDescription): Sample[] {
  const pts = desc.points;
  const n = pts.length;
  if (n < 4) throw new Error("a circuit needs at least four control points");
  const P = (i: number) => {
    const p = pts[mod(i, n)]!;
    return [p.x, p.y, p.z];
  };
  const W = (i: number) => pts[mod(i, n)]!.width ?? desc.width;
  const B = (i: number) => ((pts[mod(i, n)]!.bank ?? 0) * Math.PI) / 180;

  // Dense polyline with its control-point parameter, then resample by length.
  const SUB = 400;
  const dense: number[] = [];
  const denseU: number[] = [];
  const q = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < SUB; k++) {
      catmullRom3(P(i - 1), P(i), P(i + 1), P(i + 2), k / SUB, q);
      dense.push(q[0]!, q[1]!, q[2]!);
      denseU.push(i + k / SUB);
    }
  }
  const m = denseU.length;
  const cum = new Float64Array(m + 1);
  for (let j = 0; j < m; j++) {
    const a = j * 3;
    const b = ((j + 1) % m) * 3;
    cum[j + 1] =
      cum[j]! +
      Math.hypot(
        dense[b]! - dense[a]!,
        dense[b + 1]! - dense[a + 1]!,
        dense[b + 2]! - dense[a + 2]!,
      );
  }
  const length = cum[m]!;
  const count = Math.round(length / SAMPLE_SPACING);
  const ds = length / count;
  const samples: Sample[] = [];
  let j = 0;
  for (let i = 0; i < count; i++) {
    const s = i * ds;
    while (cum[j + 1]! < s) j++;
    const f = (s - cum[j]!) / (cum[j + 1]! - cum[j]! || 1);
    const a = j * 3;
    const b = ((j + 1) % m) * 3;
    const lerp = (o: number) => dense[a + o]! + (dense[b + o]! - dense[a + o]!) * f;
    const uA = denseU[j]!;
    const uB = j + 1 < m ? denseU[j + 1]! : n;
    const u = uA + (uB - uA) * f;
    const seg = Math.floor(u);
    const t = u - seg;
    samples.push({
      x: lerp(0),
      y: lerp(1),
      z: lerp(2),
      s,
      u,
      tx: 0,
      ty: 0,
      tz: 0,
      lx: 0,
      lz: 0,
      width: catmullRom1(W(seg - 1), W(seg), W(seg + 1), W(seg + 2), t),
      bank: catmullRom1(B(seg - 1), B(seg), B(seg + 1), B(seg + 2), t),
      kerbL: 0,
      kerbR: 0,
      runoffL: "grass",
      runoffR: "grass",
      runoffWidthL: desc.runoffWidth,
      runoffWidthR: desc.runoffWidth,
    });
  }
  const N = samples.length;
  for (let i = 0; i < N; i++) {
    const p = samples[mod(i - 1, N)]!;
    const nx = samples[(i + 1) % N]!;
    const c = samples[i]!;
    let tx = nx.x - p.x;
    let ty = nx.y - p.y;
    let tz = nx.z - p.z;
    const tl = Math.hypot(tx, ty, tz);
    tx /= tl;
    ty /= tl;
    tz /= tl;
    c.tx = tx;
    c.ty = ty;
    c.tz = tz;
    const pl = Math.hypot(tx, tz);
    // Left of travel: heading +x has its left at −z.
    c.lx = tz / pl;
    c.lz = -tx / pl;
  }
  applyFeatures(desc, samples);
  return samples;
}

function applyFeatures(desc: CircuitDescription, samples: Sample[]): void {
  const n = desc.points.length;
  const N = samples.length;
  const kerbL = new Uint8Array(N);
  const kerbR = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const smp = samples[i]!;
    for (const k of desc.kerbs) {
      if (inRange(smp.u, k.from, k.to, n)) (k.side === "left" ? kerbL : kerbR)[i] = 1;
    }
    for (const w of desc.wideRunoff ?? []) {
      if (inRange(smp.u, w.from, w.to, n)) {
        if (w.side === "left") smp.runoffWidthL = Math.max(smp.runoffWidthL, w.width);
        else smp.runoffWidthR = Math.max(smp.runoffWidthR, w.width);
      }
    }
    for (const g of desc.gravel) {
      if (inRange(smp.u, g.from, g.to, n)) {
        if (g.side === "left") {
          smp.runoffL = "gravel";
          if (g.width) smp.runoffWidthL = Math.max(smp.runoffWidthL, g.width);
        } else {
          smp.runoffR = "gravel";
          if (g.width) smp.runoffWidthR = Math.max(smp.runoffWidthR, g.width);
        }
      }
    }
  }
  // Kerbs ramp up and down at their ends so a wheel never meets a step.
  const ramp = (flags: Uint8Array, i: number) => {
    if (!flags[i]) return 0;
    let d = KERB_RAMP;
    for (let k = 1; k <= KERB_RAMP; k++) {
      if (!flags[mod(i - k, N)] || !flags[mod(i + k, N)]) {
        d = k - 1;
        break;
      }
    }
    return KERB_HEIGHT * Math.min(1, d / KERB_RAMP);
  };
  for (let i = 0; i < N; i++) {
    samples[i]!.kerbL = ramp(kerbL, i);
    samples[i]!.kerbR = ramp(kerbR, i);
  }
  // Runoff widths change smoothly too: average over a short window.
  const smooth = (get: (s: Sample) => number, set: (s: Sample, v: number) => void) => {
    const src = samples.map(get);
    const H = 6;
    for (let i = 0; i < N; i++) {
      let sum = 0;
      for (let k = -H; k <= H; k++) sum += src[mod(i + k, N)]!;
      set(samples[i]!, sum / (2 * H + 1));
    }
  };
  smooth(
    (s) => s.runoffWidthL,
    (s, v) => (s.runoffWidthL = v),
  );
  smooth(
    (s) => s.runoffWidthR,
    (s, v) => (s.runoffWidthR = v),
  );
}

// ---------------------------------------------------------------------------
// Cross-sections

/**
 * Lateral stations of one side, from the asphalt edge outwards: offset from
 * the centre (m) and height above the banked plane (m). Index 0 is the
 * asphalt edge, 1 the end of the painted line, 2 the outer end of the kerb's
 * flat top, 3 the outer edge of the shoulder (start of the runoff), 4 the
 * outer edge of the runoff.
 */
function stations(smp: Sample, side: Side): Array<[number, number]> {
  const half = smp.width / 2;
  const kh = side === "left" ? smp.kerbL : smp.kerbR;
  const rw = side === "left" ? smp.runoffWidthL : smp.runoffWidthR;
  return [
    [half, 0],
    [half + EDGE_LINE, kh],
    [half + SHOULDER - 0.25, kh],
    [half + SHOULDER, 0],
    [half + SHOULDER + rw, -RUNOFF_FALL],
  ];
}

/** World position of a point `d` metres left of the centre (negative right), `h` above the banked plane. */
function lateral(smp: Sample, d: number, h: number, out: number[]): number[] {
  const cb = Math.cos(smp.bank);
  const sb = Math.sin(smp.bank);
  // The banked plane's up is the world up rotated about the tangent.
  out[0] = smp.x + smp.lx * (d * cb - h * sb);
  out[1] = smp.y + d * sb + h * cb;
  out[2] = smp.z + smp.lz * (d * cb - h * sb);
  return out;
}

/** The ten section points of a sample, from the left runoff edge to the right one. */
function sectionPoints(smp: Sample): number[][] {
  const left = stations(smp, "left");
  const right = stations(smp, "right");
  const pts: number[][] = [];
  for (let k = 4; k >= 0; k--) pts.push(lateral(smp, left[k]![0], left[k]![1], [0, 0, 0]));
  for (let k = 0; k <= 4; k++) pts.push(lateral(smp, -right[k]![0], right[k]![1], [0, 0, 0]));
  return pts;
}

/** Height of the runoff's outer edge on a side, for the terrain and barriers. */
function outerEdge(smp: Sample, side: Side): number[] {
  const st = stations(smp, side)[4]!;
  return lateral(smp, side === "left" ? st[0] : -st[0], st[1], [0, 0, 0]);
}

const COLORS: Record<string, [number, number, number]> = {
  asphalt: [0.2, 0.215, 0.24],
  line: [0.86, 0.87, 0.85],
  kerbRed: [0.78, 0.16, 0.13],
  kerbWhite: [0.9, 0.9, 0.88],
  grass: [0.24, 0.38, 0.2],
  gravel: [0.62, 0.55, 0.43],
};

class MeshBuilder {
  positions: number[] = [];
  indices: number[] = [];
  colors: number[] = [];
  constructor(readonly kind: SurfaceKind) {}
  /** A quad a-b-c-d (a, b on one section, c, d on the next), facing up. */
  quad(a: number[], b: number[], c: number[], d: number[], color: readonly number[]): void {
    const base = this.positions.length / 3;
    for (const p of [a, b, c, d]) {
      this.positions.push(p[0]!, p[1]!, p[2]!);
      this.colors.push(color[0]!, color[1]!, color[2]!);
    }
    // Normal of triangle a-c-b; flip the winding if it points down.
    const ux = c[0]! - a[0]!;
    const uz = c[2]! - a[2]!;
    const vx = b[0]! - a[0]!;
    const vz = b[2]! - a[2]!;
    const ny = uz * vx - ux * vz;
    if (ny >= 0) this.indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    else this.indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  build(): SurfaceMesh {
    return {
      kind: this.kind,
      positions: new Float32Array(this.positions),
      indices: new Uint32Array(this.indices),
      colors: new Float32Array(this.colors),
    };
  }
}

/** Point `k` of {@link ASPHALT_COLUMNS} + 1 across the asphalt from edge `p` to edge `q`; the ends are the edges exactly, so neighbouring strips weld. */
function columnPoint(p: number[], q: number[], k: number): number[] {
  if (k === 0) return p;
  if (k === ASPHALT_COLUMNS) return q;
  const t = k / ASPHALT_COLUMNS;
  return [p[0]! + (q[0]! - p[0]!) * t, p[1]! + (q[1]! - p[1]!) * t, p[2]! + (q[2]! - p[2]!) * t];
}

function buildSurfaces(samples: Sample[]): SurfaceMesh[] {
  const N = samples.length;
  const meshes: Record<SurfaceKind, MeshBuilder> = {
    asphalt: new MeshBuilder("asphalt"),
    kerb: new MeshBuilder("kerb"),
    grass: new MeshBuilder("grass"),
    gravel: new MeshBuilder("gravel"),
  };
  const sections = samples.map(sectionPoints);
  for (let i = 0; i < N; i++) {
    const A = sections[i]!;
    const C = sections[(i + 1) % N]!;
    const s0 = samples[i]!;
    const s1 = samples[(i + 1) % N]!;
    // Columns 0..9: left runoff edge … right runoff edge. Strips between
    // neighbouring columns; 4–5 is the asphalt.
    for (let c = 0; c < 9; c++) {
      const left = c < 4;
      const kerbHere = left ? s0.kerbL > 0 || s1.kerbL > 0 : s0.kerbR > 0 || s1.kerbR > 0;
      const runoff = left ? s0.runoffL : s0.runoffR;
      let kind: SurfaceKind;
      let color: readonly number[];
      // Strip 0 and 8 are the runoff; 1–3 and 5–7 the shoulder; 4 the asphalt.
      if (c === 0 || c === 8) {
        kind = runoff;
        color = COLORS[runoff]!;
      } else if (c === 4) {
        kind = "asphalt";
        color = COLORS.asphalt!;
      } else if (kerbHere) {
        kind = "kerb";
        // Alternating blocks about 2.5 m long.
        color = Math.floor(s0.s / 2.5) % 2 === 0 ? COLORS.kerbRed! : COLORS.kerbWhite!;
      } else {
        kind = "asphalt";
        const line = c === 3 || c === 5;
        color = line ? COLORS.line! : COLORS.asphalt!;
      }
      if (c === 4) {
        // The asphalt in narrow columns: across a corner on a grade the
        // section lines are not parallel, so one full-width quad twists and
        // folds along its diagonal into a ridge the wheels hit every
        // sample. The fold shrinks with the column width.
        for (let k = 0; k < ASPHALT_COLUMNS; k++) {
          const a = columnPoint(A[4]!, A[5]!, k);
          const b = columnPoint(A[4]!, A[5]!, k + 1);
          const cc = columnPoint(C[4]!, C[5]!, k);
          const d = columnPoint(C[4]!, C[5]!, k + 1);
          meshes[kind].quad(a, b, cc, d, color);
        }
        continue;
      }
      meshes[kind].quad(A[c]!, A[c + 1]!, C[c]!, C[c + 1]!, color);
    }
  }
  return (Object.values(meshes) as MeshBuilder[])
    .map((m) => m.build())
    .filter((m) => m.indices.length > 0);
}

// ---------------------------------------------------------------------------
// Terrain

/** Nearest-sample lookup in plan, through a uniform bucket grid. */
export class SampleIndex {
  private readonly cell = 25;
  private readonly buckets = new Map<string, number[]>();
  constructor(private readonly samples: readonly Sample[]) {
    samples.forEach((s, i) => {
      const k = this.key(Math.floor(s.x / this.cell), Math.floor(s.z / this.cell));
      const b = this.buckets.get(k);
      if (b) b.push(i);
      else this.buckets.set(k, [i]);
    });
  }
  private key(i: number, j: number): string {
    return `${i},${j}`;
  }
  /** Index of the sample nearest to (x, z) in plan. */
  nearest(x: number, z: number): number {
    const ci = Math.floor(x / this.cell);
    const cj = Math.floor(z / this.cell);
    let best = -1;
    let bestD = Infinity;
    for (let r = 0; r < 64; r++) {
      for (let i = ci - r; i <= ci + r; i++) {
        for (let j = cj - r; j <= cj + r; j++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
          for (const k of this.buckets.get(this.key(i, j)) ?? []) {
            const s = this.samples[k]!;
            const d = (s.x - x) ** 2 + (s.z - z) ** 2;
            if (d < bestD) {
              bestD = d;
              best = k;
            }
          }
        }
      }
      // Anything in a ring further out is at least r cells away.
      if (best >= 0 && Math.sqrt(bestD) <= r * this.cell) break;
    }
    return best;
  }
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function buildTerrain(samples: Sample[]): Terrain {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const s of samples) {
    minX = Math.min(minX, s.x);
    maxX = Math.max(maxX, s.x);
    minZ = Math.min(minZ, s.z);
    maxZ = Math.max(maxZ, s.z);
  }
  minX -= TERRAIN_MARGIN;
  maxX += TERRAIN_MARGIN;
  minZ -= TERRAIN_MARGIN;
  maxZ += TERRAIN_MARGIN;
  const nx = Math.ceil((maxX - minX) / TERRAIN_SPACING) + 1;
  const nz = Math.ceil((maxZ - minZ) / TERRAIN_SPACING) + 1;
  const index = new SampleIndex(samples);
  const coarse = samples.filter((_, i) => i % 8 === 0);
  const positions = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = minX + i * TERRAIN_SPACING;
      const z = minZ + j * TERRAIN_SPACING;
      const k = index.nearest(x, z);
      const smp = samples[k]!;
      const dx = x - smp.x;
      const dz = z - smp.z;
      const side: Side = dx * smp.lx + dz * smp.lz >= 0 ? "left" : "right";
      const d = Math.hypot(dx, dz);
      const rw = side === "left" ? smp.runoffWidthL : smp.runoffWidthR;
      const reach = smp.width / 2 + SHOULDER + rw;
      let y: number;
      if (d < reach + 0.5) {
        // Under the track: just below its surface, so the ground meets the
        // runoff's outer edge without a ditch between grid nodes.
        const lat = dx * smp.lx + dz * smp.lz;
        const fall =
          RUNOFF_FALL * Math.max(0, Math.min(1, (Math.abs(lat) - smp.width / 2 - SHOULDER) / rw));
        y = smp.y + lat * Math.tan(smp.bank) - fall - UNDER_TRACK;
      } else {
        const edge = outerEdge(smp, side)[1]! - TERRAIN_DROP;
        // Far from the track the ground follows a smoothed version of the
        // circuit's elevation, so hills carry on into the landscape.
        let wsum = 0;
        let ysum = 0;
        for (const c of coarse) {
          const w = 1 / ((c.x - x) ** 2 + (c.z - z) ** 2 + 60 * 60);
          wsum += w;
          ysum += w * c.y;
        }
        const regional = ysum / wsum - 0.5;
        const f = smoothstep(4, 90, d - reach);
        y = edge + (regional - edge) * f;
      }
      positions.set([x, y, z], (j * nx + i) * 3);
    }
  }
  const indices = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let o = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      // Counter-clockwise seen from above (+y): a, c, b and b, c, d.
      indices.set([a, c, b, b, c, d], o);
      o += 6;
    }
  }
  return { positions, indices, minX, minZ, spacing: TERRAIN_SPACING, nx, nz };
}

/** Height of the terrain mesh at (x, z), on the same triangles the mesh uses. */
export function terrainHeight(t: Terrain, x: number, z: number): number {
  const fx = (x - t.minX) / t.spacing;
  const fz = (z - t.minZ) / t.spacing;
  const i = Math.max(0, Math.min(t.nx - 2, Math.floor(fx)));
  const j = Math.max(0, Math.min(t.nz - 2, Math.floor(fz)));
  const u = fx - i;
  const v = fz - j;
  const h = (ii: number, jj: number) => t.positions[(jj * t.nx + ii) * 3 + 1]!;
  const a = h(i, j);
  const b = h(i + 1, j);
  const c = h(i, j + 1);
  const d = h(i + 1, j + 1);
  // Triangles a-c-b (u + v ≤ 1) and b-c-d.
  return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
}

// ---------------------------------------------------------------------------
// Barriers, gates, grid

/** Quaternion of a yaw about +y followed by a pitch about the new z. */
export function yawPitchQuat(yaw: number, pitch: number): [number, number, number, number] {
  const cy = Math.cos(yaw / 2);
  const sy = Math.sin(yaw / 2);
  const cp = Math.cos(pitch / 2);
  const sp = Math.sin(pitch / 2);
  // q = qy(yaw) · qz(pitch)
  return [sy * sp, sy * cp, cy * sp, cy * cp];
}

function buildBarriers(desc: CircuitDescription, samples: Sample[]): BarrierBox[] {
  const n = desc.points.length;
  const N = samples.length;
  const out: BarrierBox[] = [];
  for (const side of ["left", "right"] as const) {
    for (let i = 0; i < N; i += BARRIER_SPAN) {
      const a = samples[i]!;
      const kind = desc.barriers.find((b) => b.side === side && inRange(a.u, b.from, b.to, n));
      if (!kind) continue;
      const b = samples[(i + BARRIER_SPAN) % N]!;
      const sign = side === "left" ? 1 : -1;
      const pa = outerEdge(a, side);
      const pb = outerEdge(b, side);
      // Push the block outward so its inner face sits just past the runoff.
      const off = 0.3 + BARRIER_THICKNESS / 2;
      const ax = pa[0]! + sign * a.lx * off;
      const az = pa[2]! + sign * a.lz * off;
      const bx = pb[0]! + sign * b.lx * off;
      const bz = pb[2]! + sign * b.lz * off;
      const dx = bx - ax;
      const dz = bz - az;
      const dy = pb[1]! - pa[1]!;
      const plan = Math.hypot(dx, dz);
      const yaw = Math.atan2(-dz, dx);
      const pitch = Math.atan2(dy, plan);
      const len = Math.hypot(plan, dy) + 0.6;
      // Bury the bottom so it meets the terrain below the runoff edge.
      const bury = 0.4;
      out.push({
        kind: kind.kind,
        center: [(ax + bx) / 2, (pa[1]! + pb[1]!) / 2 + BARRIER_HEIGHT / 2 - bury, (az + bz) / 2],
        halfExtents: [len / 2, (BARRIER_HEIGHT + bury) / 2, BARRIER_THICKNESS / 2],
        quat: yawPitchQuat(yaw, pitch),
      });
    }
  }
  return out;
}

/** The sample nearest to control-point position `u`. */
function sampleAtU(samples: Sample[], u: number, n: number): number {
  const target = mod(u, n);
  let best = 0;
  let bestD = Infinity;
  samples.forEach((s, i) => {
    const d = Math.min(Math.abs(s.u - target), n - Math.abs(s.u - target));
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

function buildGate(smp: Sample, index: number): Gate {
  const half = smp.width / 2 + SHOULDER + Math.max(smp.runoffWidthL, smp.runoffWidthR) + 2;
  const fl = Math.hypot(smp.tx, smp.tz);
  return {
    index,
    s: smp.s,
    a: [smp.x + smp.lx * half, smp.z + smp.lz * half],
    b: [smp.x - smp.lx * half, smp.z - smp.lz * half],
    forward: [smp.tx / fl, smp.tz / fl],
  };
}

/** A pose on the centreline at sample `i`, facing along the lap. */
export function poseAt(samples: readonly Sample[], i: number): SpawnPose {
  const smp = samples[mod(i, samples.length)]!;
  const fl = Math.hypot(smp.tx, smp.tz);
  return {
    x: smp.x,
    y: smp.y,
    z: smp.z,
    // Core yaw: heading +x is 0; three's −z is the core's +y (left).
    yaw: Math.atan2(-smp.tz, smp.tx),
    pitch: Math.atan2(smp.ty, fl),
  };
}

// ---------------------------------------------------------------------------

/** Build everything from a description. Pure: the same input gives the same output. */
export function buildCircuit(desc: CircuitDescription): CircuitGeometry {
  const samples = buildSamples(desc);
  const N = samples.length;
  const n = desc.points.length;
  const gates = desc.gates.map((u) => {
    const i = sampleAtU(samples, u, n);
    return buildGate(samples[i]!, i);
  });
  const behind = Math.round(desc.gridBehind / SAMPLE_SPACING);
  return {
    description: desc,
    samples,
    length: samples[N - 1]!.s + (samples[N - 1]!.s - samples[N - 2]!.s),
    surfaces: buildSurfaces(samples),
    terrain: buildTerrain(samples),
    barriers: buildBarriers(desc, samples),
    gates,
    grid: poseAt(samples, gates[0]!.index - behind),
  };
}

// ---------------------------------------------------------------------------
// Projection onto the centreline

export interface Projection {
  /** Sample at the start of the segment the point projects onto. */
  index: number;
  /** Distance along the lap from sample 0, m. */
  s: number;
  /** Offset to the left of the centre, m. */
  lateral: number;
}

/**
 * Projects positions onto the centreline. Searches near the last answer, so
 * a car moving along the track costs a few dot products per step; it falls
 * back to the bucket grid after a jump (a reset, a teleport).
 */
export class Projector {
  private last = -1;
  private readonly index: SampleIndex;
  constructor(
    private readonly samples: readonly Sample[],
    private readonly length: number,
  ) {
    this.index = new SampleIndex(samples);
  }

  /** Forget the last answer (after a reset). */
  reset(): void {
    this.last = -1;
  }

  project(x: number, z: number): Projection {
    const N = this.samples.length;
    let best = -1;
    let bestD = Infinity;
    if (this.last >= 0) {
      for (let k = -12; k <= 12; k++) {
        const i = mod(this.last + k, N);
        const s = this.samples[i]!;
        const d = (s.x - x) ** 2 + (s.z - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      // Too far from where it was: look it up properly.
      if (bestD > 30 * 30) best = -1;
    }
    if (best < 0) best = this.index.nearest(x, z);
    // Project onto whichever neighbouring segment contains the point.
    const c = this.samples[best]!;
    const ahead = (x - c.x) * c.tx + (z - c.z) * c.tz >= 0;
    const i0 = ahead ? best : mod(best - 1, N);
    const a = this.samples[i0]!;
    const b = this.samples[(i0 + 1) % N]!;
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const el = ex * ex + ez * ez || 1;
    const f = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / el));
    const segLen = i0 + 1 < N ? b.s - a.s : this.length - a.s;
    const px = a.x + ex * f;
    const pz = a.z + ez * f;
    this.last = best;
    return {
      index: i0,
      s: a.s + segLen * f,
      lateral: (x - px) * a.lx + (z - pz) * a.lz,
    };
  }
}
