import { describe, expect, it } from "vitest";
import {
  buildCircuit,
  inRange,
  Projector,
  SAMPLE_SPACING,
  SHOULDER,
  TERRAIN_DROP,
  terrainHeight,
  type CircuitGeometry,
} from "./geometry.js";
import { CIRCUIT } from "./layout.js";
import { layoutStats } from "./stats.js";

const g: CircuitGeometry = buildCircuit(CIRCUIT);
const S = g.samples;
const N = S.length;

describe("the circuit's centreline", () => {
  it("closes on itself smoothly", () => {
    for (let i = 0; i < N; i++) {
      const a = S[i]!;
      const b = S[(i + 1) % N]!;
      const step = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      expect(step, `step after sample ${i}`).toBeGreaterThan(SAMPLE_SPACING * 0.9);
      expect(step, `step after sample ${i}`).toBeLessThan(SAMPLE_SPACING * 1.1);
      const dot = a.tx * b.tx + a.ty * b.ty + a.tz * b.tz;
      // A kink, not a corner: corners are bounded by the radius check below.
      expect(dot, `tangent turn after sample ${i}`).toBeGreaterThan(Math.cos((12 * Math.PI) / 180));
      expect(Math.abs(b.bank - a.bank), `bank change after ${i}`).toBeLessThan(0.01);
      expect(Math.abs(b.width - a.width), `width change after ${i}`).toBeLessThan(0.1);
    }
  });

  it("keeps within the limits every preset can drive", () => {
    const st = layoutStats(g);
    expect(st.length).toBeGreaterThan(2000);
    expect(st.length).toBeLessThan(2800);
    // The pickup's turning circle is about 6 m; the hairpin and chicane stay well above it.
    expect(st.minRadius).toBeGreaterThan(15);
    expect(st.maxGrade).toBeLessThan(0.08);
    // Gentle enough that the open-wheeler neither launches over the crest nor
    // bottoms out in the compression at its speed there.
    expect(st.minCrestRadius).toBeGreaterThan(400);
    expect(st.minSagRadius).toBeGreaterThan(300);
    expect(st.maxBankDeg).toBeLessThanOrEqual(8);
    // No part of the track's runoff touches another's.
    expect(st.minClearance).toBeGreaterThan(20);
  });

  it("is the same every time it is built", () => {
    const again = buildCircuit(CIRCUIT);
    expect(again.length).toBe(g.length);
    expect(again.surfaces.map((m) => Array.from(m.positions.slice(0, 30)))).toEqual(
      g.surfaces.map((m) => Array.from(m.positions.slice(0, 30))),
    );
  });
});

describe("the surface meshes", () => {
  it("face up everywhere", () => {
    for (const m of g.surfaces) {
      const p = m.positions;
      for (let t = 0; t < m.indices.length; t += 3) {
        const [a, b, c] = [m.indices[t]!, m.indices[t + 1]!, m.indices[t + 2]!];
        const ux = p[b * 3]! - p[a * 3]!;
        const uz = p[b * 3 + 2]! - p[a * 3 + 2]!;
        const vx = p[c * 3]! - p[a * 3]!;
        const vz = p[c * 3 + 2]! - p[a * 3 + 2]!;
        // y component of (b − a) × (c − a)
        expect(uz * vx - ux * vz, `${m.kind} triangle ${t / 3}`).toBeGreaterThan(0);
      }
    }
  });

  it("join without cracks: the only open edges are the runoff's outer edges", () => {
    // Weld by exact position across every surface, then count each edge's
    // triangles. A watertight strip of quads round a loop has exactly two
    // open edges per segment, one on each outer side.
    const key = (m: { positions: Float32Array }, i: number) =>
      `${m.positions[i * 3]},${m.positions[i * 3 + 1]},${m.positions[i * 3 + 2]}`;
    const edges = new Map<string, number>();
    for (const m of g.surfaces) {
      for (let t = 0; t < m.indices.length; t += 3) {
        const k = [0, 1, 2].map((j) => key(m, m.indices[t + j]!));
        for (const [a, b] of [
          [k[0]!, k[1]!],
          [k[1]!, k[2]!],
          [k[2]!, k[0]!],
        ] as const) {
          const e = a < b ? `${a}|${b}` : `${b}|${a}`;
          edges.set(e, (edges.get(e) ?? 0) + 1);
        }
      }
    }
    const counts = [...edges.values()];
    expect(counts.filter((c) => c > 2)).toEqual([]);
    expect(counts.filter((c) => c === 1).length).toBe(2 * N);
  });

  it("keeps every asphalt quad flat enough that a wheel crossing its diagonal feels no ridge", () => {
    // Each quad is four consecutive vertices split into two triangles; its
    // twist is the fourth vertex's distance from the plane of the other three.
    const m = g.surfaces.find((s) => s.kind === "asphalt")!;
    const p = m.positions;
    const v = (i: number, k: number) => p[i * 3 + k]!;
    let worst = 0;
    for (let q = 0; q < p.length / 12; q++) {
      const a = 4 * q;
      const u = [0, 1, 2].map((k) => v(a + 1, k) - v(a, k));
      const w = [0, 1, 2].map((k) => v(a + 2, k) - v(a, k));
      const n = [
        u[1]! * w[2]! - u[2]! * w[1]!,
        u[2]! * w[0]! - u[0]! * w[2]!,
        u[0]! * w[1]! - u[1]! * w[0]!,
      ];
      const len = Math.hypot(n[0]!, n[1]!, n[2]!);
      const d = [0, 1, 2].reduce((sum, k) => sum + (v(a + 3, k) - v(a, k)) * n[k]!, 0) / len;
      worst = Math.max(worst, Math.abs(d));
    }
    // One full-width quad per sample twisted by up to 58 mm in the corners.
    expect(worst).toBeLessThan(0.01);
  });

  it("has every kind of ground the description asks for", () => {
    expect(g.surfaces.map((m) => m.kind).sort()).toEqual(["asphalt", "grass", "gravel", "kerb"]);
  });

  it("raises kerbs no higher than the low cars can ride", () => {
    for (const s of S) {
      expect(s.kerbL).toBeLessThanOrEqual(0.035);
      expect(s.kerbR).toBeLessThanOrEqual(0.035);
    }
  });
});

describe("the terrain", () => {
  it("meets the runoff's outer edge without a ditch or a step", () => {
    for (let i = 0; i < N; i += 3) {
      const s = S[i]!;
      for (const side of [1, -1]) {
        const rw = side > 0 ? s.runoffWidthL : s.runoffWidthR;
        const reach = s.width / 2 + SHOULDER + rw;
        // The runoff's outer edge height (its banked plane, less its fall).
        const edge = s.y + side * reach * Math.tan(s.bank) - 0.12;
        for (const out of [0.5, 2, 4, 6]) {
          const d = side * (reach + out);
          const h = terrainHeight(g.terrain, s.x + s.lx * d, s.z + s.lz * d);
          expect(h, `sample ${i} side ${side} +${out} m`).toBeGreaterThan(
            edge - TERRAIN_DROP - 0.4,
          );
          // Tight corners bring the ground up to a gentle bank beside the runoff.
          expect(h, `sample ${i} side ${side} +${out} m`).toBeLessThan(edge + 0.5);
        }
      }
    }
  });

  it("stays under the track", () => {
    for (let i = 0; i < N; i += 3) {
      const s = S[i]!;
      for (const side of [1, -1]) {
        const rw = side > 0 ? s.runoffWidthL : s.runoffWidthR;
        for (const d of [0, s.width / 2, s.width / 2 + SHOULDER + rw / 2]) {
          const lat = side * d;
          const surface = s.y + lat * Math.tan(s.bank) - (d > s.width / 2 + SHOULDER ? 0.06 : 0);
          const h = terrainHeight(g.terrain, s.x + s.lx * lat, s.z + s.lz * lat);
          expect(h, `sample ${i} at ${lat.toFixed(1)} m`).toBeLessThan(surface - 0.02);
        }
      }
    }
  });
});

describe("barriers, gates and the grid", () => {
  it("keeps barriers clear of the track", () => {
    const proj = new Projector(S, g.length);
    for (const b of g.barriers) {
      const p = proj.project(b.center[0], b.center[2]);
      const smp = S[p.index]!;
      const inner = Math.abs(p.lateral) - b.halfExtents[2];
      expect(inner).toBeGreaterThan(smp.width / 2 + SHOULDER + 5);
      const [x, y, z, w] = b.quat;
      expect(Math.hypot(x, y, z, w)).toBeCloseTo(1, 9);
    }
  });

  it("puts the gates across the track in lap order, facing forwards", () => {
    expect(g.gates).toHaveLength(3);
    const start = g.gates[0]!.s;
    const along = g.gates.map((gt) => (gt.s - start + g.length) % g.length);
    expect(along[0]).toBe(0);
    expect(along[1]!).toBeGreaterThan(along[0]!);
    expect(along[2]!).toBeGreaterThan(along[1]!);
    for (const gt of g.gates) {
      const smp = S[gt.index]!;
      const span = Math.hypot(gt.a[0] - gt.b[0], gt.a[1] - gt.b[1]);
      expect(span).toBeGreaterThan(smp.width + 2 * SHOULDER);
      const fl = Math.hypot(smp.tx, smp.tz);
      expect(gt.forward[0] * (smp.tx / fl) + gt.forward[1] * (smp.tz / fl)).toBeCloseTo(1, 6);
    }
  });

  it("puts the grid on the centreline behind the start line, facing along the lap", () => {
    const proj = new Projector(S, g.length);
    const p = proj.project(g.grid.x, g.grid.z);
    expect(Math.abs(p.lateral)).toBeLessThan(0.01);
    const behind = (g.gates[0]!.s - p.s + g.length) % g.length;
    expect(behind).toBeGreaterThan(CIRCUIT.gridBehind - SAMPLE_SPACING);
    expect(behind).toBeLessThan(CIRCUIT.gridBehind + SAMPLE_SPACING);
    const smp = S[p.index]!;
    expect(Math.cos(g.grid.yaw)).toBeCloseTo(smp.tx / Math.hypot(smp.tx, smp.tz), 6);
    expect(Math.sin(g.grid.yaw)).toBeCloseTo(-smp.tz / Math.hypot(smp.tx, smp.tz), 6);
  });
});

describe("projection onto the centreline", () => {
  it("finds distance and offset on and off the track", () => {
    const proj = new Projector(S, g.length);
    for (let i = 0; i < N; i += 37) {
      const s = S[i]!;
      for (const off of [-8, 0, 3]) {
        const p = proj.project(s.x + s.lx * off, s.z + s.lz * off);
        expect(p.s).toBeCloseTo(s.s, 0);
        expect(p.lateral).toBeCloseTo(off, 0);
      }
    }
  });

  it("follows a car across the start of the sample list", () => {
    const proj = new Projector(S, g.length);
    let prev = -1;
    for (let k = -20; k <= 20; k++) {
      const s = S[(k + N) % N]!;
      const p = proj.project(s.x, s.z);
      if (prev >= 0) {
        const ds = (p.s - prev + g.length) % g.length;
        expect(ds).toBeGreaterThan(0);
        expect(ds).toBeLessThan(2 * SAMPLE_SPACING);
      }
      prev = p.s;
    }
  });
});

describe("feature ranges", () => {
  it("wrap past the last control point", () => {
    expect(inRange(29.8, 29.5, 0.4, 30)).toBe(true);
    expect(inRange(0.2, 29.5, 0.4, 30)).toBe(true);
    expect(inRange(0.5, 29.5, 0.4, 30)).toBe(false);
    expect(inRange(5, 4.4, 6.4, 30)).toBe(true);
    expect(inRange(6.4, 4.4, 6.4, 30)).toBe(false);
  });
});
