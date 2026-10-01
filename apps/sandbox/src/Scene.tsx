import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  BufferAttribute,
  BufferGeometry,
  type DirectionalLight,
  type Group,
  type Mesh,
} from "three";
import type { TireDefinition } from "@skidpad/core";
import { emptySnapshot, type Sim, type SimSnapshot } from "./sim.js";
import { OBSTACLES, obstacleQuaternion, trackRibbon } from "./track.js";

function tireRadius(tire: TireDefinition): number {
  const r = tire.model === "feel" ? tire.radius : tire.unloadedRadius;
  return typeof r === "number" ? r : 0.31;
}

/**
 * Coordinate mapping: the core is ISO (x forward, y left, z up). Three.js is
 * y up. We map core (x, y, z) → three (x, z, −y) so +y (left) becomes −z.
 * The car's meshes are laid out in core body coordinates mapped the same
 * way, and the group takes the body quaternion converted in `sim.ts`.
 */
function Car({ sim }: { sim: Sim }) {
  const group = useRef<Group>(null);
  const snap = useRef<SimSnapshot>(emptySnapshot());
  const wheelGroups = useRef<(Group | null)[]>([null, null, null, null]);
  const spinMeshes = useRef<(Mesh | null)[]>([null, null, null, null]);
  const light = useRef<DirectionalLight>(null);
  const def = sim.definition;
  const a = def.chassis.cgToFrontAxle;
  const b = def.chassis.wheelbase - a;
  const half = def.chassis.trackWidth / 2;
  const h = def.chassis.cgHeight;
  const rF = tireRadius(def.axles[0]!.tire);
  const rR = tireRadius(def.axles[1]!.tire);
  const length = def.chassis.wheelbase * 1.5;
  const width = def.chassis.trackWidth * 1.05;
  // Wheel hub positions in core body coordinates at static ride height.
  const hubs: Array<[number, number, number, number]> = [
    [a, half, rF - h, rF],
    [a, -half, rF - h, rF],
    [-b, half, rR - h, rR],
    [-b, -half, rR - h, rR],
  ];

  useFrame((state, delta) => {
    sim.frame(state.clock.elapsedTime * 1000);
    const s = sim.snapshot(snap.current);
    const g = group.current;
    if (g) {
      g.position.set(s.x, s.z, -s.y);
      g.quaternion.set(s.quat[0], s.quat[1], s.quat[2], s.quat[3]);
    }
    for (let i = 0; i < 4; i++) {
      const wg = wheelGroups.current[i];
      const hub = hubs[i]!;
      if (wg) {
        // Suspension travel moves the hub up the body's z (three y) axis.
        wg.position.set(hub[0], hub[2] + s.wheelTravel[i]!, -hub[1]);
        wg.rotation.y = s.wheelSteer[i]!;
      }
      const m = spinMeshes.current[i];
      // The cylinder's own axis is its local Y. With three.js' XYZ Euler
      // order the Y rotation is applied before the fixed X tilt, so spinning
      // about Y turns the wheel about its axle.
      if (m) m.rotation.y = -s.wheelSpin[i]!;
    }
    // Chase camera: frame-rate independent follow with a gain high enough
    // that the car stays framed at speed, looking a little ahead of it.
    const cam = state.camera;
    const dt = delta || 1 / 60;
    const back = 8;
    const tx = s.x - Math.cos(s.yaw) * back;
    const tz = -s.y + Math.sin(s.yaw) * back;
    const k = 1 - Math.exp(-10 * dt);
    cam.position.lerp({ x: tx, y: s.z + 2.6, z: tz } as never, k);
    const ahead = 3;
    cam.lookAt(s.x + Math.cos(s.yaw) * ahead, s.z, -s.y - Math.sin(s.yaw) * ahead);
    // The shadow-casting light follows the car so its shadow frustum never
    // runs out; a fixed light would pop shadows a few metres from the origin.
    const l = light.current;
    if (l) {
      l.position.set(s.x + 30, 50, -s.y + 20);
      l.target.position.set(s.x, 0, -s.y);
      l.target.updateMatrixWorld();
    }
    if (debug) {
      debug.push(performance.now(), s.x, s.y, cam.position.x, cam.position.z);
    }
  });

  return (
    <>
      <directionalLight
        ref={light}
        position={[30, 50, 20]}
        intensity={2.0}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-25}
        shadow-camera-right={25}
        shadow-camera-top={25}
        shadow-camera-bottom={-25}
        shadow-camera-near={1}
        shadow-camera-far={150}
        shadow-bias={-0.0005}
      />
      <group ref={group}>
        {/* Body and cabin, in core body coordinates mapped to three. */}
        <mesh position={[(a - b) / 2 + 0.1, rF + 0.35 - h, 0]} castShadow>
          <boxGeometry args={[length, 0.6, width]} />
          <meshStandardMaterial color="#d84a3a" metalness={0.3} roughness={0.5} />
        </mesh>
        <mesh position={[(a - b) / 2 - 0.3, rF + 0.95 - h, 0]} castShadow>
          <boxGeometry args={[length * 0.5, 0.5, width * 0.8]} />
          <meshStandardMaterial color="#3a3f4a" roughness={0.3} />
        </mesh>
        {hubs.map((hub, i) => (
          <group
            key={i}
            ref={(el) => {
              wheelGroups.current[i] = el;
            }}
            position={[hub[0], hub[2], -hub[1]]}
          >
            <mesh
              ref={(el) => {
                spinMeshes.current[i] = el;
              }}
              rotation={[Math.PI / 2, 0, 0]}
              castShadow
            >
              <cylinderGeometry args={[hub[3], hub[3], 0.22, 24]} />
              <meshStandardMaterial color="#1c1f26" roughness={0.9} />
            </mesh>
            {/* A spoke so the spin is visible. */}
            <mesh
              ref={(el) => {
                if (el) el.rotation.set(Math.PI / 2, 0, 0);
              }}
              position={[0, 0, i % 2 === 0 ? -0.12 : 0.12]}
            >
              <boxGeometry args={[hub[3] * 1.4, 0.02, 0.06]} />
              <meshStandardMaterial color="#9aa4b5" />
            </mesh>
          </group>
        ))}
      </group>
    </>
  );
}

/** Per-frame samples for the smoothness check, enabled with `?debug`. */
const debug: number[] | null =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).has("debug")
    ? ((window as unknown as { __skidpadFrames: number[] }).__skidpadFrames = [])
    : null;

const CAMERA = { position: [-8, 3, 0] as [number, number, number], fov: 60, near: 0.5, far: 3000 };
const GL = { preserveDrawingBuffer: true };

function Track() {
  const { ribbon, left, right } = useMemo(() => {
    const r = trackRibbon();
    const ribbon = new BufferGeometry();
    ribbon.setAttribute("position", new BufferAttribute(r.positions, 3));
    ribbon.setIndex(new BufferAttribute(r.index, 1));
    ribbon.computeVertexNormals();
    const left = new BufferGeometry();
    left.setAttribute("position", new BufferAttribute(r.left, 3));
    const right = new BufferGeometry();
    right.setAttribute("position", new BufferAttribute(r.right, 3));
    return { ribbon, left, right };
  }, []);
  return (
    <>
      <mesh geometry={ribbon} receiveShadow>
        <meshStandardMaterial color="#2b303b" roughness={0.95} />
      </mesh>
      <lineLoop geometry={left}>
        <lineBasicMaterial color="#e8ecf1" />
      </lineLoop>
      <lineLoop geometry={right}>
        <lineBasicMaterial color="#e8ecf1" />
      </lineLoop>
    </>
  );
}

function Obstacles({ active }: { active: boolean }) {
  return (
    <>
      {OBSTACLES.map((o, i) => {
        const q = obstacleQuaternion(o);
        return (
          <mesh
            key={i}
            position={o.position}
            quaternion={[q.x, q.y, q.z, q.w]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={o.size} />
            <meshStandardMaterial
              color={o.color}
              transparent={!active}
              opacity={active ? 1 : 0.25}
              roughness={0.8}
            />
          </mesh>
        );
      })}
    </>
  );
}

function Ground() {
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[2000, 2000]} />
        <meshStandardMaterial
          color="#454c5c"
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>
      <gridHelper args={[2000, 400, "#8f9ab3", "#5e6778"]} position={[0, 0.02, 0]} />
      {/* A 40 m skidpad circle, matching the understeer validation radius. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, -40]}>
        <ringGeometry args={[39.5, 40.5, 128]} />
        <meshBasicMaterial color="#7c8aa5" />
      </mesh>
    </>
  );
}

export function Scene({
  sim,
  hostKind,
  canvasRef,
}: {
  sim: Sim;
  hostKind: string;
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
}) {
  return (
    <Canvas
      shadows
      camera={CAMERA}
      gl={GL}
      onCreated={({ gl }) => {
        canvasRef.current = gl.domElement;
      }}
    >
      <color attach="background" args={["#10131a"]} />
      <fog attach="fog" args={["#10131a", 80, 400]} />
      <hemisphereLight args={["#dde6ff", "#3a3f4c", 1.4]} />
      <Ground />
      <Track />
      <Obstacles active={hostKind === "rapier"} />
      <Car key={sim.presetId} sim={sim} />
    </Canvas>
  );
}
