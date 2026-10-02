/** Original procedural artwork, MIT OR Apache-2.0. Metres; +X forward, +Y up. */
import { DoubleSide } from "three";

export type Point = [number, number, number];
const PAINT = "#e05b32";
export const TRIM = "#171e25";

export function Panel({
  points,
  color = "#243c48",
  glass = false,
}: {
  points: [Point, Point, Point, Point];
  color?: string;
  glass?: boolean;
}) {
  const positions = new Float32Array([
    ...points[0],
    ...points[1],
    ...points[2],
    ...points[0],
    ...points[2],
    ...points[3],
  ]);
  return (
    <mesh castShadow receiveShadow>
      <bufferGeometry onUpdate={(g) => g.computeVertexNormals()}>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <meshStandardMaterial
        color={color}
        metalness={glass ? 0.45 : 0.25}
        roughness={glass ? 0.16 : 0.35}
        side={DoubleSide}
      />
    </mesh>
  );
}

export function Part({
  position,
  size,
  color = PAINT,
  rotation = [0, 0, 0],
  glow = false,
}: {
  position: Point;
  size: Point;
  color?: string;
  rotation?: Point;
  glow?: boolean;
}) {
  return (
    <mesh position={position} rotation={rotation} castShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={color}
        metalness={0.25}
        roughness={0.38}
        emissive={glow ? color : "#000000"}
        emissiveIntensity={glow ? 0.8 : 0}
      />
    </mesh>
  );
}

/** A closed section loft. Each station is [x, bottom, top, half width]. */
export function Hull({
  sections,
  color,
  bevel = 0.08,
}: {
  sections: ReadonlyArray<readonly [number, number, number, number]>;
  color: string;
  bevel?: number;
}) {
  const rings = sections.map(([x, bottom, top, w]) => {
    const edge = Math.min(bevel, (top - bottom) / 3, w / 3);
    return [
      [x, bottom, -w + edge],
      [x, bottom + edge, -w],
      [x, top - edge, -w],
      [x, top, -w + edge],
      [x, top, w - edge],
      [x, top - edge, w],
      [x, bottom + edge, w],
      [x, bottom, w - edge],
    ] as Point[];
  });
  const positions: number[] = [];
  const tri = (a: Point, b: Point, c: Point) => positions.push(...a, ...b, ...c);
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i]!;
    const b = rings[i + 1]!;
    for (let j = 0; j < 8; j++) {
      const next = (j + 1) % 8;
      tri(a[j]!, b[j]!, b[next]!);
      tri(a[j]!, b[next]!, a[next]!);
    }
  }
  for (const ring of [rings[0]!, rings[rings.length - 1]!]) {
    for (let j = 1; j < 7; j++) tri(ring[0]!, ring[j]!, ring[j + 1]!);
  }
  return (
    <mesh castShadow receiveShadow>
      <bufferGeometry onUpdate={(g) => g.computeVertexNormals()}>
        <bufferAttribute attach="attributes-position" args={[new Float32Array(positions), 3]} />
      </bufferGeometry>
      <meshStandardMaterial color={color} metalness={0.28} roughness={0.36} side={DoubleSide} />
    </mesh>
  );
}
