/** Original sandbox artwork, licensed with Skidpad (MIT OR Apache-2.0).
 * All coordinates are metres, +X forward, +Y up. The origin is the CG's
 * ground projection at static ride height; Scene places it relative to the CG.
 * Geometry is authored parametrically so wheel arches follow live tuning.
 */
import { useMemo } from "react";
import { DoubleSide, Shape } from "three";

type Point = [number, number, number];
const PAINT = "#e05b32";
const TRIM = "#171e25";

function Panel({
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

function Part({
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

export function Hatchback({
  frontAxle,
  rearAxle,
  halfWidth,
  frontRadius,
  rearRadius,
}: {
  frontAxle: number;
  rearAxle: number;
  halfWidth: number;
  frontRadius: number;
  rearRadius: number;
}) {
  const wheelbase = frontAxle - rearAxle;
  const front = frontAxle + wheelbase * 0.29;
  const rear = rearAxle - wheelbase * 0.25;
  const belt = Math.max(frontRadius, rearRadius) + 0.52;
  const roof = belt + 0.57;
  const w = halfWidth;
  const roofW = w * 0.79;
  const cowl = frontAxle - wheelbase * 0.12;
  const roofFront = cowl - wheelbase * 0.24;
  const roofRear = rearAxle + wheelbase * 0.06;
  const hatch = rear + 0.13;
  const pillar = roofRear + (roofFront - roofRear) * 0.45;
  const body = useMemo(() => {
    const s = new Shape();
    s.moveTo(rear, 0.19);
    s.lineTo(rear, belt - 0.18);
    s.lineTo(rear + 0.12, belt);
    s.lineTo(cowl, belt);
    s.lineTo(front - 0.18, belt - 0.12);
    s.lineTo(front, belt - 0.27);
    s.lineTo(front, 0.19);
    // Open arches, including clearance for suspension travel and steering.
    for (const [x, r] of [
      [frontAxle, frontRadius],
      [rearAxle, rearRadius],
    ] as const) {
      const radius = r + 0.115;
      const angle = Math.asin((0.19 - r) / radius);
      s.lineTo(x + Math.cos(angle) * radius, 0.19);
      s.absarc(x, r, radius, angle, Math.PI - angle, false);
    }
    s.lineTo(rear, 0.19);
    s.closePath();
    return s;
  }, [rear, belt, cowl, front, frontAxle, frontRadius, rearAxle, rearRadius]);

  return (
    <group name="hatchback-body">
      <mesh position={[0, 0, -w + 0.025]} castShadow receiveShadow>
        <extrudeGeometry
          args={[
            body,
            {
              depth: 2 * w - 0.05,
              bevelEnabled: true,
              bevelSegments: 2,
              steps: 1,
              bevelSize: 0.025,
              bevelThickness: 0.025,
              curveSegments: 16,
            },
          ]}
        />
        <meshStandardMaterial color={PAINT} metalness={0.32} roughness={0.32} />
      </mesh>
      {/* Roof, windshield, rear glass and side glazing form a tapered cabin. */}
      <Panel
        color={PAINT}
        points={[
          [roofRear, roof, -roofW],
          [roofFront, roof, -roofW],
          [roofFront, roof, roofW],
          [roofRear, roof, roofW],
        ]}
      />
      <Panel
        glass
        points={[
          [roofFront, roof - 0.025, -roofW],
          [cowl, belt + 0.015, -w * 0.94],
          [cowl, belt + 0.015, w * 0.94],
          [roofFront, roof - 0.025, roofW],
        ]}
      />
      <Panel
        glass
        points={[
          [hatch, belt + 0.02, -w * 0.94],
          [roofRear, roof - 0.025, -roofW],
          [roofRear, roof - 0.025, roofW],
          [hatch, belt + 0.02, w * 0.94],
        ]}
      />
      {[-1, 1].map((side) => (
        <group key={side}>
          <Panel
            color={PAINT}
            points={[
              [hatch, belt, side * w],
              [cowl, belt, side * w],
              [roofFront, roof, side * roofW],
              [roofRear, roof, side * roofW],
            ]}
          />
          <Panel
            glass
            points={[
              [pillar + 0.055, belt + 0.065, side * w * 0.985],
              [cowl - 0.1, belt + 0.065, side * w * 0.985],
              [roofFront - 0.045, roof - 0.055, side * (roofW + 0.025)],
              [pillar + 0.055, roof - 0.055, side * (roofW + 0.025)],
            ]}
          />
          <Panel
            glass
            points={[
              [hatch + 0.18, belt + 0.065, side * w * 0.985],
              [pillar - 0.055, belt + 0.065, side * w * 0.985],
              [pillar - 0.055, roof - 0.055, side * (roofW + 0.025)],
              [roofRear + 0.07, roof - 0.055, side * (roofW + 0.025)],
            ]}
          />
          <Part
            position={[(frontAxle + rearAxle) / 2, 0.22, side * w]}
            size={[Math.max(0.15, wheelbase - frontRadius - rearRadius - 0.28), 0.1, 0.065]}
            color={TRIM}
          />
          <Part
            position={[pillar + 0.21, belt - 0.11, side * (w + 0.028)]}
            size={[0.18, 0.035, 0.025]}
            color={TRIM}
          />
          <Part
            position={[cowl - 0.06, belt + 0.09, side * (w + 0.07)]}
            size={[0.13, 0.045, 0.19]}
            color={TRIM}
          />
          <Part
            position={[cowl - 0.08, belt + 0.13, side * (w + 0.16)]}
            size={[0.21, 0.13, 0.17]}
          />
          <Part
            position={[cowl - 0.19, belt + 0.13, side * (w + 0.16)]}
            size={[0.012, 0.09, 0.12]}
            color="#8fa4ae"
          />
          <Part
            position={[front - 0.025, belt - 0.23, side * w * 0.7]}
            size={[0.055, 0.115, w * 0.4]}
            color="#e7f5ff"
            glow
          />
          <Part
            position={[rear - 0.012, belt - 0.12, side * w * 0.76]}
            size={[0.045, 0.12, w * 0.35]}
            color="#ee3029"
            glow
          />
          {/* Hood creases and dark lower sill give the silhouette some structure. */}
          <Part
            position={[(cowl + front - 0.2) / 2, belt - 0.048, side * w * 0.6]}
            size={[front - cowl - 0.25, 0.013, 0.025]}
            rotation={[0, 0, -Math.atan2(0.12, front - 0.18 - cowl)]}
            color="#c94728"
          />
        </group>
      ))}
      <Part position={[front + 0.02, 0.34, 0]} size={[0.06, 0.2, w * 1.5]} color={TRIM} />
      <Part position={[front + 0.03, belt - 0.24, 0]} size={[0.06, 0.13, w * 0.68]} color={TRIM} />
      <Part position={[rear - 0.025, 0.31, 0]} size={[0.07, 0.18, w * 1.85]} color={TRIM} />
      <Part position={[rear - 0.032, belt - 0.24, 0]} size={[0.016, 0.12, 0.4]} color="#e8e5dc" />
      <Part
        position={[roofRear - 0.035, roof + 0.018, 0]}
        size={[0.21, 0.055, roofW * 2.05]}
        color={TRIM}
      />
      <Part position={[rear + 0.06, 0.25, w * 0.63]} size={[0.23, 0.075, 0.095]} color="#a8b0b3" />
    </group>
  );
}

/** The whole assembly spins around local Z. Steering belongs to its parent. */
export function AlloyWheel({ radius, side }: { radius: number; side: number }) {
  const width = 0.22;
  const rim = radius * 0.67;
  return (
    <group name="alloy-wheel">
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[radius, radius, width, 32]} />
        <meshStandardMaterial color="#20242a" roughness={0.94} />
      </mesh>
      <group position={[0, 0, side * (width / 2 + 0.006)]}>
        <mesh>
          <circleGeometry args={[rim, 32]} />
          <meshStandardMaterial color="#161c22" side={DoubleSide} />
        </mesh>
        <mesh>
          <torusGeometry args={[rim, 0.018, 6, 32]} />
          <meshStandardMaterial color="#c5ced5" metalness={0.7} roughness={0.26} />
        </mesh>
        {[0, 1, 2, 3, 4].map((i) => (
          <group key={i} rotation={[0, 0, (i * Math.PI * 2) / 5]}>
            <Part
              position={[rim * 0.48, 0, side * 0.005]}
              size={[rim * 0.97, 0.035, 0.025]}
              color="#c5ced5"
            />
          </group>
        ))}
        <mesh>
          <sphereGeometry args={[0.046, 12, 8]} />
          <meshStandardMaterial color="#8b99a4" metalness={0.7} roughness={0.3} />
        </mesh>
        {/* Asymmetric sidewall mark makes low-speed wheel rotation readable. */}
        <Part position={[0, radius * 0.86, 0]} size={[0.047, 0.018, 0.008]} color="#a8aaa2" />
      </group>
    </group>
  );
}
