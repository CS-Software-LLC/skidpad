/**
 * The sandbox track: a closed loop drawn as a ribbon, the skidpad circle,
 * and a set of box obstacles (speed bumps, a ramp, a kerb) that exist as
 * Rapier colliders when the Rapier host is active and as decoration
 * otherwise. Everything here is in three.js coordinates (y up); the core's
 * ISO frame maps onto it as (x, y, z) → (x, z, −y).
 */
import { CatmullRomCurve3, Euler, Quaternion, Vector3 } from "three";

export interface Obstacle {
  /** Centre in three.js coordinates, m. */
  position: [number, number, number];
  /** Full size `[x, y, z]`, m. */
  size: [number, number, number];
  /** Euler rotation `[x, y, z]`, rad. */
  rotation: [number, number, number];
  color: string;
  label: string;
}

const RAMP_ANGLE = Math.atan2(0.7, 8);

export const OBSTACLES: Obstacle[] = [
  // Three speed bumps across the straight.
  ...[36, 40, 44].map<Obstacle>((x) => ({
    position: [x, 0.03, 0],
    size: [0.5, 0.07, 10],
    rotation: [0, 0, 0],
    color: "#c9a227",
    label: "bump",
  })),
  // A ramp rising 0.7 m over 8 m, open at the far end: a jump at speed.
  {
    position: [70, 0.35 * 0.5 - 0.15, 0],
    size: [8, 0.3, 6],
    rotation: [0, 0, RAMP_ANGLE],
    color: "#8f5a3c",
    label: "ramp",
  },
  // A kerb along the left edge of the back straight.
  {
    position: [-40, 0.06, 5],
    size: [30, 0.12, 0.4],
    rotation: [0, 0, 0],
    color: "#d9534f",
    label: "kerb",
  },
];

/** Quaternion of an obstacle, for both the renderer and the Rapier collider. */
export function obstacleQuaternion(o: Obstacle): Quaternion {
  return new Quaternion().setFromEuler(new Euler(o.rotation[0], o.rotation[1], o.rotation[2]));
}

/** Control points of the loop in three.js coordinates (y up), m. */
export const TRACK_POINTS: Vector3[] = [
  new Vector3(-60, 0, 0),
  new Vector3(0, 0, 0),
  new Vector3(90, 0, 0),
  new Vector3(130, 0, -20),
  new Vector3(140, 0, -70),
  new Vector3(100, 0, -110),
  new Vector3(30, 0, -120),
  new Vector3(-50, 0, -100),
  new Vector3(-110, 0, -60),
  new Vector3(-100, 0, -10),
];

export const TRACK_WIDTH = 9;

/**
 * Ribbon geometry attributes for the loop: positions and an index buffer for
 * a triangle strip, plus the left and right edge polylines.
 */
export function trackRibbon(segments = 400): {
  positions: Float32Array;
  index: Uint32Array;
  left: Float32Array;
  right: Float32Array;
} {
  const curve = new CatmullRomCurve3(TRACK_POINTS, true, "centripetal");
  const pts = curve.getPoints(segments);
  const n = pts.length;
  const positions = new Float32Array(n * 2 * 3);
  const left = new Float32Array(n * 3);
  const right = new Float32Array(n * 3);
  const up = new Vector3(0, 1, 0);
  const tangent = new Vector3();
  const side = new Vector3();
  for (let i = 0; i < n; i++) {
    const p = pts[i]!;
    tangent.subVectors(pts[(i + 1) % n]!, pts[(i - 1 + n) % n]!).normalize();
    side
      .crossVectors(up, tangent)
      .normalize()
      .multiplyScalar(TRACK_WIDTH / 2);
    positions.set([p.x + side.x, 0.01, p.z + side.z], i * 6);
    positions.set([p.x - side.x, 0.01, p.z - side.z], i * 6 + 3);
    left.set([p.x + side.x, 0.03, p.z + side.z], i * 3);
    right.set([p.x - side.x, 0.03, p.z - side.z], i * 3);
  }
  const index = new Uint32Array((n - 1) * 6);
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
  }
  return { positions, index, left, right };
}
