/**
 * The circuit, drawn from the same geometry the Rapier world is built from
 * (`geometry.ts`): what you see is what the wheels hit. Everything is
 * generated here; there are no external assets.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  type InstancedMesh,
  Matrix4,
  NearestFilter,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
} from "three";
import { SHOULDER, type CircuitGeometry, type Sample } from "./geometry.js";

function useDisposable<T extends { dispose(): void }>(make: () => T, deps: unknown[]): T {
  const value = useMemo(make, deps);
  useEffect(() => () => value.dispose(), [value]);
  return value;
}

/** Deterministic hash of an integer to [0, 1). */
function hash(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

function Surfaces({ geometry }: { geometry: CircuitGeometry }) {
  const meshes = useMemo(
    () =>
      geometry.surfaces.map((m) => {
        const g = new BufferGeometry();
        g.setAttribute("position", new BufferAttribute(m.positions, 3));
        g.setAttribute("color", new BufferAttribute(m.colors, 3));
        g.setIndex(new BufferAttribute(m.indices, 1));
        g.computeVertexNormals();
        return { kind: m.kind, g };
      }),
    [geometry],
  );
  useEffect(() => () => meshes.forEach((m) => m.g.dispose()), [meshes]);
  return (
    <>
      {meshes.map((m) => (
        <mesh key={m.kind} geometry={m.g} receiveShadow name={`circuit-${m.kind}`}>
          <meshStandardMaterial
            vertexColors
            roughness={m.kind === "kerb" ? 0.7 : 0.95}
            polygonOffset
            polygonOffsetFactor={-1}
            polygonOffsetUnits={-1}
          />
        </mesh>
      ))}
    </>
  );
}

function Terrain({ geometry }: { geometry: CircuitGeometry }) {
  const g = useDisposable(() => {
    const t = geometry.terrain;
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(t.positions, 3));
    g.setIndex(new BufferAttribute(t.indices, 1));
    // Grass with a little variation so speed reads against the ground.
    const colors = new Float32Array(t.positions.length);
    const base = new Color("#3b5a30");
    const dry = new Color("#6b6a3a");
    const c = new Color();
    for (let i = 0; i < t.positions.length / 3; i++) {
      const n = hash(i);
      c.copy(base).lerp(dry, 0.15 + 0.35 * n * n);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute("color", new BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
  }, [geometry]);
  return (
    <mesh geometry={g} receiveShadow name="circuit-terrain">
      <meshStandardMaterial vertexColors roughness={1} />
    </mesh>
  );
}

/** Barriers as instanced boxes, one mesh per kind. */
function Barriers({ geometry }: { geometry: CircuitGeometry }) {
  const walls = useRef<InstancedMesh>(null);
  const tyres = useRef<InstancedMesh>(null);
  const byKind = useMemo(
    () => ({
      wall: geometry.barriers.filter((b) => b.kind === "wall"),
      tyres: geometry.barriers.filter((b) => b.kind === "tyres"),
    }),
    [geometry],
  );
  useLayoutEffect(() => {
    const m = new Matrix4();
    const p = new Vector3();
    const q = new Quaternion();
    const s = new Vector3();
    const c = new Color();
    for (const [mesh, list, colors] of [
      [walls.current, byKind.wall, ["#b8bcc0", "#a3a8ad"]],
      [tyres.current, byKind.tyres, ["#1f2226", "#c23b2e", "#1f2226", "#e6e6e2"]],
    ] as const) {
      if (!mesh) continue;
      list.forEach((b, i) => {
        p.set(...b.center);
        q.set(...b.quat);
        s.set(b.halfExtents[0] * 2, b.halfExtents[1] * 2, b.halfExtents[2] * 2);
        mesh.setMatrixAt(i, m.compose(p, q, s));
        mesh.setColorAt(i, c.set(colors[i % colors.length]!));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [byKind]);
  return (
    <>
      <instancedMesh
        ref={walls}
        args={[undefined, undefined, byKind.wall.length]}
        castShadow
        receiveShadow
        name="circuit-walls"
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.9} />
      </instancedMesh>
      <instancedMesh
        ref={tyres}
        args={[undefined, undefined, byKind.tyres.length]}
        castShadow
        receiveShadow
        name="circuit-tyres"
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.85} />
      </instancedMesh>
    </>
  );
}

/** A flat strip across the asphalt at a sample, for painted lines. */
function stripGeometry(smp: Sample, along: number, lift = 0.012): BufferGeometry {
  const half = smp.width / 2 + SHOULDER;
  const fl = Math.hypot(smp.tx, smp.tz);
  const fx = smp.tx / fl;
  const fz = smp.tz / fl;
  const pts: number[] = [];
  for (const [d, a] of [
    [half, -along / 2],
    [-half, -along / 2],
    [half, along / 2],
    [-half, along / 2],
  ] as const) {
    pts.push(
      smp.x + smp.lx * d + fx * a,
      smp.y + lift + (a * smp.ty) / fl,
      smp.z + smp.lz * d + fz * a,
    );
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pts), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2));
  g.setIndex([0, 2, 1, 1, 2, 3]);
  g.computeVertexNormals();
  return g;
}

function canvasTexture(
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext("2d")!);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function StartFinish({ geometry }: { geometry: CircuitGeometry }) {
  const gate = geometry.gates[0]!;
  const smp = geometry.samples[gate.index]!;
  const line = useDisposable(() => stripGeometry(smp, 1.6), [smp]);
  const checker = useDisposable(() => {
    const t = canvasTexture(16, 2, (ctx) => {
      for (let i = 0; i < 16; i++)
        for (let j = 0; j < 2; j++) {
          ctx.fillStyle = (i + j) % 2 ? "#111" : "#f2f2f2";
          ctx.fillRect(i, j, 1, 1);
        }
    });
    t.magFilter = NearestFilter;
    t.wrapS = RepeatWrapping;
    t.repeat.set(Math.round(smp.width / 1.6), 1);
    return t;
  }, [smp]);
  const banner = useDisposable(
    () =>
      canvasTexture(1024, 128, (ctx) => {
        ctx.fillStyle = "#1c2a3a";
        ctx.fillRect(0, 0, 1024, 128);
        ctx.fillStyle = "#e05b32";
        ctx.fillRect(0, 0, 1024, 10);
        ctx.fillRect(0, 118, 1024, 10);
        ctx.fillStyle = "#f2f2ee";
        ctx.font = "bold 72px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(geometry.description.name.toUpperCase(), 512, 90);
      }),
    [geometry],
  );
  // Gantry posts just outside the shoulders, square to the track.
  const half = smp.width / 2 + SHOULDER + 1.5;
  const yaw = Math.atan2(-smp.tz, smp.tx);
  const span = half * 2;
  return (
    <>
      <mesh geometry={line} receiveShadow>
        <meshStandardMaterial map={checker} roughness={0.8} />
      </mesh>
      <group position={[smp.x, smp.y, smp.z]} rotation={[0, yaw, 0]}>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[0, 3.5, side * half]} castShadow>
            <boxGeometry args={[0.5, 7, 0.5]} />
            <meshStandardMaterial color="#cfd3d6" metalness={0.4} roughness={0.5} />
          </mesh>
        ))}
        <mesh position={[0, 7.2, 0]} castShadow>
          <boxGeometry args={[0.8, 1.4, span + 0.5]} />
          <meshStandardMaterial color="#1c2a3a" />
        </mesh>
        {[-1, 1].map((face) => (
          <mesh key={face} position={[face * 0.41, 7.2, 0]} rotation={[0, (face * Math.PI) / 2, 0]}>
            <planeGeometry args={[span, 1.3]} />
            <meshStandardMaterial map={banner} />
          </mesh>
        ))}
      </group>
    </>
  );
}

function Board({
  smp,
  side,
  offset,
  label,
  color,
}: {
  smp: Sample;
  side: 1 | -1;
  offset: number;
  label: string;
  color: string;
}) {
  const texture = useDisposable(
    () =>
      canvasTexture(256, 256, (ctx) => {
        ctx.fillStyle = "#e8e7dd";
        ctx.fillRect(0, 0, 256, 256);
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 256, 22);
        ctx.fillStyle = "#18242e";
        ctx.textAlign = "center";
        ctx.font = "bold 120px sans-serif";
        ctx.fillText(label, 128, 170);
      }),
    [label, color],
  );
  const d = side * (smp.width / 2 + SHOULDER + offset);
  const yaw = Math.atan2(-smp.tz, smp.tx);
  return (
    <group position={[smp.x + smp.lx * d, smp.y, smp.z + smp.lz * d]} rotation={[0, yaw, 0]}>
      <mesh position={[0, 0.8, 0]} castShadow>
        <boxGeometry args={[0.08, 1.6, 0.08]} />
        <meshStandardMaterial color="#77818a" metalness={0.5} roughness={0.5} />
      </mesh>
      {/* Faces the oncoming car, which approaches along +x of this group. */}
      <mesh position={[-0.03, 1.7, 0]} rotation={[0, -Math.PI / 2, 0]} castShadow>
        <planeGeometry args={[1.1, 1.1]} />
        <meshStandardMaterial map={texture} roughness={0.9} />
      </mesh>
    </group>
  );
}

function SectorLines({ geometry }: { geometry: CircuitGeometry }) {
  const lines = useMemo(
    () => geometry.gates.slice(1).map((g) => stripGeometry(geometry.samples[g.index]!, 0.3)),
    [geometry],
  );
  useEffect(() => () => lines.forEach((l) => l.dispose()), [lines]);
  return (
    <>
      {lines.map((l, i) => (
        <mesh key={i} geometry={l}>
          <meshStandardMaterial color="#e8c547" roughness={0.8} />
        </mesh>
      ))}
      {geometry.gates.slice(1).map((g, i) => (
        <Board
          key={i}
          smp={geometry.samples[g.index]!}
          side={1}
          offset={3}
          label={`S${i + 2}`}
          color="#e8c547"
        />
      ))}
    </>
  );
}

/** Distance-to-corner boards before the heavy braking zones, on the outside. */
function BrakingBoards({ geometry }: { geometry: CircuitGeometry }) {
  const boards = useMemo(() => {
    const S = geometry.samples;
    // Turn 1's turn-in and the chicane's entry, in control-point units.
    const corners: Array<{ u: number; side: 1 | -1 }> = [
      { u: 3.6, side: 1 },
      { u: 23.5, side: 1 },
    ];
    const out: Array<{ smp: Sample; side: 1 | -1; label: string }> = [];
    for (const c of corners) {
      let at = 0;
      let best = Infinity;
      S.forEach((s, i) => {
        if (Math.abs(s.u - c.u) < best) {
          best = Math.abs(s.u - c.u);
          at = i;
        }
      });
      for (const m of [150, 100, 50]) {
        const i = (at - Math.round(m / (geometry.length / S.length)) + S.length) % S.length;
        out.push({ smp: S[i]!, side: c.side, label: String(m) });
      }
    }
    return out;
  }, [geometry]);
  return (
    <>
      {boards.map((b, i) => (
        <Board key={i} smp={b.smp} side={b.side} offset={2.5} label={b.label} color="#e05b32" />
      ))}
    </>
  );
}

/** Trees well away from the track, for depth and a sense of speed. */
function Trees({ geometry }: { geometry: CircuitGeometry }) {
  const crowns = useRef<InstancedMesh>(null);
  const trunks = useRef<InstancedMesh>(null);
  const spots = useMemo(() => {
    const t = geometry.terrain.positions;
    const S = geometry.samples;
    const out: Array<[number, number, number, number]> = [];
    for (let i = 0; i < t.length / 3; i++) {
      if (hash(i * 7 + 3) > 0.035) continue;
      const x = t[i * 3]!;
      const y = t[i * 3 + 1]!;
      const z = t[i * 3 + 2]!;
      let near = Infinity;
      for (let k = 0; k < S.length; k += 4)
        near = Math.min(near, Math.hypot(S[k]!.x - x, S[k]!.z - z));
      if (near < 45) continue;
      out.push([x + (hash(i) - 0.5) * 4, y, z + (hash(i + 1) - 0.5) * 4, 0.7 + hash(i + 2) * 0.8]);
    }
    return out;
  }, [geometry]);
  useLayoutEffect(() => {
    const m = new Matrix4();
    const q = new Quaternion();
    const p = new Vector3();
    const s = new Vector3();
    spots.forEach(([x, y, z, k], i) => {
      crowns.current?.setMatrixAt(i, m.compose(p.set(x, y + 4.5 * k, z), q, s.set(k, k, k)));
      trunks.current?.setMatrixAt(i, m.compose(p.set(x, y + 1 * k, z), q, s.set(k, k, k)));
    });
    for (const mesh of [crowns.current, trunks.current]) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [spots]);
  return (
    <>
      <instancedMesh
        ref={crowns}
        args={[undefined, undefined, spots.length]}
        castShadow
        name="circuit-trees"
      >
        <coneGeometry args={[2.2, 7, 7]} />
        <meshStandardMaterial color="#2c4a2a" roughness={1} flatShading />
      </instancedMesh>
      <instancedMesh ref={trunks} args={[undefined, undefined, spots.length]}>
        <cylinderGeometry args={[0.25, 0.3, 2, 6]} />
        <meshStandardMaterial color="#4a3a2a" roughness={1} />
      </instancedMesh>
    </>
  );
}

export function CircuitScene({ geometry }: { geometry: CircuitGeometry }) {
  return (
    <group name="circuit">
      <Terrain geometry={geometry} />
      <Surfaces geometry={geometry} />
      <Barriers geometry={geometry} />
      <StartFinish geometry={geometry} />
      <SectorLines geometry={geometry} />
      <BrakingBoards geometry={geometry} />
      <Trees geometry={geometry} />
    </group>
  );
}
