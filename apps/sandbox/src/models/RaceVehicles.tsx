/** Original kart and single-seater artwork, MIT OR Apache-2.0. */
import { useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Quaternion, Vector3, type Group, type Mesh } from "three";
import type { SimSnapshot } from "../sim.js";
import { Hull, Part, TRIM, type Point } from "./parts.js";
import { WHEEL_STYLES, type ModelDimensions } from "./types.js";

type SnapshotRef = MutableRefObject<SimSnapshot>;
const UP = new Vector3(0, 1, 0);

function Rod({
  start,
  end,
  radius = 0.022,
  color = TRIM,
}: {
  start: Point;
  end: Point;
  radius?: number;
  color?: string;
}) {
  const a = new Vector3(...start),
    b = new Vector3(...end);
  const delta = b.clone().sub(a);
  return (
    <mesh
      position={a.add(b).multiplyScalar(0.5)}
      quaternion={new Quaternion().setFromUnitVectors(UP, delta.clone().normalize())}
      castShadow
    >
      <cylinderGeometry args={[radius, radius, delta.length(), 8]} />
      <meshStandardMaterial color={color} metalness={0.45} roughness={0.4} />
    </mesh>
  );
}

/** Illustrative wishbones: their outboard ends follow the same snapshot as the hubs. */
function SuspensionLink({
  start,
  hub,
  wheel,
  snapshot,
}: {
  start: Point;
  hub: Point;
  wheel: number;
  snapshot: SnapshotRef;
}) {
  const mesh = useRef<Mesh>(null);
  const direction = useMemo(() => new Vector3(), []);
  useFrame(() => {
    const rod = mesh.current;
    if (!rod) return;
    const y = hub[1] + snapshot.current.wheelTravel[wheel]!;
    direction.set(hub[0] - start[0], y - start[1], hub[2] - start[2]);
    rod.position.set((start[0] + hub[0]) / 2, (start[1] + y) / 2, (start[2] + hub[2]) / 2);
    rod.scale.y = direction.length();
    rod.quaternion.setFromUnitVectors(UP, direction.normalize());
  });
  return (
    <mesh ref={mesh} name="suspension-link" castShadow>
      <cylinderGeometry args={[0.015, 0.015, 1, 8]} />
      <meshStandardMaterial color="#555f68" metalness={0.6} roughness={0.38} />
    </mesh>
  );
}

function SteeringWheel({
  position,
  radius,
  ratio,
  snapshot,
}: {
  position: Point;
  radius: number;
  ratio: number;
  snapshot: SnapshotRef;
}) {
  const spin = useRef<Group>(null);
  useFrame(() => {
    if (spin.current) spin.current.rotation.z = -snapshot.current.wheelSteer[0] * ratio;
  });
  return (
    <group position={position} rotation={[0, Math.PI / 2, -0.25]}>
      <group ref={spin}>
        <mesh castShadow>
          <torusGeometry args={[radius, radius * 0.12, 8, 24]} />
          <meshStandardMaterial color="#262c31" roughness={0.8} />
        </mesh>
        {[0, 1, 2].map((i) => (
          <group key={i} rotation={[0, 0, (i * Math.PI * 2) / 3]}>
            <Part
              position={[radius * 0.46, 0, 0]}
              size={[radius, radius * 0.14, 0.025]}
              color="#b8c0c4"
            />
          </group>
        ))}
      </group>
    </group>
  );
}

export function Kart({ d, snapshot }: { d: ModelDimensions; snapshot: SnapshotRef }) {
  const a = d.frontAxle,
    b = d.rearAxle,
    wb = a - b;
  const frameW = Math.min(d.frontHalfTrack, d.rearHalfTrack) * 0.49;
  const seat = b + wb * 0.32;
  const front = a + d.frontRadius + 0.16;
  const rear = b - d.rearRadius - 0.12;
  const color = "#e5b62b",
    frame = "#be3934";
  return (
    <group name="kart-body">
      <Part position={[(a + b) / 2, 0.095, 0]} size={[wb, 0.025, frameW * 2]} color="#424e57" />
      {[-1, 1].map((side) => (
        <group key={side}>
          <Rod start={[rear, 0.11, side * frameW]} end={[a, 0.11, side * frameW]} color={frame} />
          <Rod
            start={[a, 0.11, side * frameW]}
            end={[front, 0.12, side * frameW * 0.8]}
            color={frame}
          />
          <Rod
            start={[b + 0.08, 0.1, side * frameW]}
            end={[a - 0.15, 0.1, side * frameW * 1.45]}
            color={frame}
          />
          <group position={[0, 0, side * frameW * 1.4]}>
            <Hull
              color={color}
              bevel={0.03}
              sections={[
                [b + d.rearRadius + 0.055, 0.075, 0.2, 0.12],
                [a - d.frontRadius - 0.06, 0.08, 0.22, 0.12],
              ]}
            />
            <Part
              position={[(a + b) / 2, 0.155, side * 0.123]}
              size={[wb * 0.36, 0.07, 0.008]}
              color="#f4ecda"
            />
          </group>
          <Rod
            start={[a - 0.09, 0.125, side * frameW]}
            end={[a, d.frontRadius, side * (d.frontHalfTrack - 0.065)]}
            radius={0.016}
            color="#929da4"
          />
        </group>
      ))}
      <Rod
        start={[b, d.rearRadius, -d.rearHalfTrack]}
        end={[b, d.rearRadius, d.rearHalfTrack]}
        radius={0.022}
        color="#929da4"
      />
      <Rod
        start={[rear, 0.14, -d.rearHalfTrack * 0.91]}
        end={[rear, 0.14, d.rearHalfTrack * 0.91]}
        radius={0.036}
      />
      <Hull
        color={color}
        bevel={0.03}
        sections={[
          [a + 0.04, 0.1, 0.24, d.frontHalfTrack * 0.66],
          [front, 0.08, 0.21, d.frontHalfTrack * 0.86],
        ]}
      />
      <Hull
        color={color}
        bevel={0.025}
        sections={[
          [a - wb * 0.35, 0.17, 0.43, 0.13],
          [a + 0.05, 0.14, 0.24, 0.19],
        ]}
      />
      <Part position={[seat, 0.18, 0]} size={[0.32, 0.065, 0.33]} color="#252e37" />
      <Part
        position={[seat - 0.16, 0.34, 0]}
        size={[0.075, 0.36, 0.32]}
        rotation={[0, 0, -0.22]}
        color="#252e37"
      />
      {[-1, 1].map((side) => (
        <Part
          key={side}
          position={[seat, 0.245, side * 0.175]}
          size={[0.32, 0.13, 0.055]}
          color="#343e48"
        />
      ))}
      <Rod
        start={[a - wb * 0.34, 0.16, 0]}
        end={[a - wb * 0.42, 0.44, 0]}
        radius={0.016}
        color="#929da4"
      />
      <SteeringWheel
        position={[a - wb * 0.42, 0.44, 0]}
        radius={0.105}
        ratio={2.5}
        snapshot={snapshot}
      />
      {/* Visible engine, cooling fins, intake and exhaust alongside the seat. */}
      <Part position={[b + 0.1, 0.23, frameW * 1.05]} size={[0.24, 0.22, 0.2]} color="#6c777e" />
      {[0, 1, 2, 3, 4].map((i) => (
        <Part
          key={i}
          position={[b + 0.1, 0.27 + i * 0.025, frameW * 1.05]}
          size={[0.21, 0.012, 0.23]}
          color="#a8b1b5"
        />
      ))}
      <Part position={[b + 0.18, 0.34, frameW * 1.47]} size={[0.14, 0.12, 0.11]} color={TRIM} />
      <Rod
        start={[b + 0.03, 0.22, frameW * 1.35]}
        end={[rear + 0.04, 0.24, frameW * 1.35]}
        radius={0.045}
        color="#76757a"
      />
      <Part position={[a - wb * 0.46, 0.19, 0]} size={[0.2, 0.13, 0.16]} color="#d9d5c0" />
    </group>
  );
}

export function OpenWheeler({ d, snapshot }: { d: ModelDimensions; snapshot: SnapshotRef }) {
  const a = d.frontAxle,
    b = d.rearAxle,
    wb = a - b;
  const halfTrack = Math.min(d.frontHalfTrack, d.rearHalfTrack);
  const cockpitW = halfTrack * 0.4;
  const cockpitRear = b + wb * 0.36,
    cockpitFront = a - wb * 0.28;
  const front = a + d.frontRadius + 0.28,
    rear = b - d.rearRadius - 0.16;
  const color = "#e0e7ec",
    accent = "#249a94";
  const podRear = b + d.rearRadius + 0.15,
    podFront = a - d.frontRadius - 0.15;
  return (
    <group name="open-wheeler-body">
      <Hull
        color={TRIM}
        bevel={0.025}
        sections={[
          [b - 0.14, 0.055, 0.1, halfTrack * 0.57],
          [b + 0.5, 0.055, 0.1, halfTrack * 0.78],
          [a - 0.36, 0.055, 0.1, halfTrack * 0.68],
        ]}
      />
      <Hull
        color={color}
        sections={[
          [cockpitFront, 0.13, 0.5, cockpitW],
          [a - 0.12, 0.16, 0.38, cockpitW * 0.67],
          [front, 0.14, 0.235, 0.085],
        ]}
      />
      <Hull
        color={accent}
        sections={[
          [b - 0.13, 0.12, 0.32, cockpitW * 0.46],
          [cockpitRear - 0.15, 0.12, 0.68, cockpitW * 0.8],
          [cockpitRear, 0.12, 0.65, cockpitW * 0.86],
        ]}
      />
      <Part
        position={[(cockpitRear + cockpitFront) / 2, 0.145, 0]}
        size={[cockpitFront - cockpitRear, 0.07, cockpitW * 1.85]}
        color={TRIM}
      />
      <Part
        position={[cockpitRear + 0.19, 0.34, 0]}
        size={[0.1, 0.37, cockpitW * 1.24]}
        rotation={[0, 0, -0.24]}
        color="#353c45"
      />
      {[-1, 1].map((side) => (
        <group key={side}>
          <group position={[0, 0, side * cockpitW]}>
            <Hull
              color={color}
              bevel={0.03}
              sections={[
                [cockpitRear, 0.13, 0.53, 0.055],
                [cockpitFront, 0.13, 0.49, 0.055],
              ]}
            />
          </group>
          <group position={[0, 0, side * halfTrack * 0.63]}>
            <Hull
              color={accent}
              sections={[
                [podRear, 0.11, 0.23, halfTrack * 0.16],
                [podRear + (podFront - podRear) * 0.7, 0.11, 0.42, halfTrack * 0.21],
                [podFront, 0.13, 0.38, halfTrack * 0.19],
              ]}
            />
            <Part
              position={[podFront + 0.004, 0.265, 0]}
              size={[0.012, 0.16, halfTrack * 0.28]}
              color={TRIM}
            />
          </group>
          <Rod
            start={[cockpitRear, 0.48, side * cockpitW * 0.67]}
            end={[cockpitRear - 0.04, 0.86, side * cockpitW * 0.4]}
            radius={0.024}
            color="#c2cbd0"
          />
          <Rod
            start={[cockpitRear, 0.69, side * cockpitW]}
            end={[cockpitFront - 0.05, 0.65, 0]}
            radius={0.024}
          />
          <Rod
            start={[cockpitFront - 0.13, 0.45, side * cockpitW]}
            end={[cockpitFront - 0.1, 0.58, side * (cockpitW + 0.13)]}
            radius={0.013}
          />
          <Part
            position={[cockpitFront - 0.08, 0.59, side * (cockpitW + 0.15)]}
            size={[0.14, 0.07, 0.1]}
            color={accent}
          />
        </group>
      ))}
      <Rod
        start={[cockpitRear - 0.04, 0.86, -cockpitW * 0.4]}
        end={[cockpitRear - 0.04, 0.86, cockpitW * 0.4]}
        radius={0.024}
        color="#c2cbd0"
      />
      <Rod
        start={[cockpitFront - 0.05, 0.49, 0]}
        end={[cockpitFront - 0.05, 0.65, 0]}
        radius={0.023}
      />
      <SteeringWheel
        position={[cockpitFront - 0.16, 0.43, 0]}
        radius={0.105}
        ratio={10}
        snapshot={snapshot}
      />
      {/* Two-element wings, endplates, rear supports and diffuser strakes. */}
      <Part
        position={[front - 0.04, 0.125, 0]}
        size={[0.39, 0.045, d.frontHalfTrack * 2.12]}
        color={accent}
        rotation={[0, 0, 0.06]}
      />
      <Part
        position={[front - 0.2, 0.21, 0]}
        size={[0.16, 0.035, d.frontHalfTrack * 1.86]}
        color={color}
        rotation={[0, 0, 0.15]}
      />
      <Part
        position={[rear, 0.77, 0]}
        size={[0.36, 0.055, d.rearHalfTrack * 1.72]}
        color={accent}
        rotation={[0, 0, -0.12]}
      />
      <Part
        position={[rear + 0.17, 0.66, 0]}
        size={[0.15, 0.045, d.rearHalfTrack * 1.62]}
        color={color}
      />
      {[-1, 1].map((side) => (
        <group key={side}>
          <Part
            position={[front - 0.07, 0.225, side * d.frontHalfTrack * 1.07]}
            size={[0.47, 0.26, 0.025]}
            color={color}
          />
          <Part
            position={[rear + 0.015, 0.69, side * d.rearHalfTrack * 0.88]}
            size={[0.47, 0.32, 0.025]}
            color={color}
          />
          <Part
            position={[rear + 0.12, 0.46, side * 0.16]}
            size={[0.075, 0.55, 0.035]}
            color={TRIM}
          />
        </group>
      ))}
      {[-0.28, 0, 0.28].map((z) => (
        <Part
          key={z}
          position={[b - 0.11, 0.13, z]}
          size={[0.38, 0.1, 0.018]}
          rotation={[0, 0, -0.12]}
          color={TRIM}
        />
      ))}
      {[0, 1, 2, 3].flatMap((i) => {
        const frontWheel = i < 2;
        const side = i % 2 === 0 ? -1 : 1;
        const x = frontWheel ? a : b;
        const radius = frontWheel ? d.frontRadius : d.rearRadius;
        const track = frontWheel ? d.frontHalfTrack : d.rearHalfTrack;
        const width = WHEEL_STYLES.openWheeler.widths[frontWheel ? 0 : 1];
        return [-1, 1].flatMap((end) =>
          [0.15, 0.33].map((y) => (
            <SuspensionLink
              key={`${i}:${end}:${y}`}
              start={[x + end * 0.2, y, side * cockpitW * 0.7]}
              hub={[x, radius, side * (track - width / 2)]}
              wheel={i}
              snapshot={snapshot}
            />
          )),
        );
      })}
      <Part position={[rear + 0.26, 0.31, 0]} size={[0.025, 0.065, 0.09]} color="#ed3434" glow />
    </group>
  );
}
