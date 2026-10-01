import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import type { DirectionalLight, Group, Mesh } from "three";
import type { TireDefinition } from "@contactpatch/core";
import type { Sim, SimSnapshot } from "./sim.js";

function tireRadius(tire: TireDefinition): number {
  const r = tire.model === "feel" ? tire.radius : tire.unloadedRadius;
  return typeof r === "number" ? r : 0.31;
}

/**
 * Coordinate mapping: the core is ISO (x forward, y left, z up). Three.js is
 * y up. We map core (x, y, z) → three (x, z, −y) so +y (left) becomes −z.
 */
function Car({ sim }: { sim: Sim }) {
  const group = useRef<Group>(null);
  const snap = useRef<SimSnapshot>({
    x: 0,
    y: 0,
    yaw: 0,
    steer: 0,
    speed: 0,
    wheelF: 0,
    wheelR: 0,
  });
  const wheelFL = useRef<Group>(null);
  const wheelFR = useRef<Group>(null);
  const light = useRef<DirectionalLight>(null);
  const spinF = useRef<Mesh[]>([]);
  const spinR = useRef<Mesh[]>([]);
  const def = sim.definition;
  const a = def.chassis.cgToFrontAxle;
  const b = def.chassis.wheelbase - a;
  const half = def.chassis.trackWidth / 2;
  const rF = tireRadius(def.axles[0]!.tire);
  const rR = tireRadius(def.axles[1]!.tire);
  const length = def.chassis.wheelbase * 1.5;
  const width = def.chassis.trackWidth * 1.05;

  useFrame((state, delta) => {
    sim.frame(state.clock.elapsedTime * 1000);
    const s = sim.snapshot(snap.current);
    const g = group.current;
    if (g) {
      g.position.set(s.x, 0, -s.y);
      g.rotation.set(0, s.yaw, 0);
    }
    if (wheelFL.current) wheelFL.current.rotation.y = s.steer;
    if (wheelFR.current) wheelFR.current.rotation.y = s.steer;
    // The cylinder's own axis is its local Y. With three.js' XYZ Euler order
    // the Y rotation is applied before the fixed X tilt, so spinning about Y
    // turns the wheel about its axle; spinning about Z would swing the axle.
    const dt = delta || 1 / 60;
    for (const m of spinF.current) m.rotation.y -= s.wheelF * dt;
    for (const m of spinR.current) m.rotation.y -= s.wheelR * dt;
    // Chase camera: frame-rate independent follow with a gain high enough
    // that the car stays framed at speed, looking a little ahead of it.
    const cam = state.camera;
    const back = 8;
    const tx = s.x - Math.cos(s.yaw) * back;
    const tz = -s.y + Math.sin(s.yaw) * back;
    const k = 1 - Math.exp(-10 * dt);
    cam.position.lerp({ x: tx, y: 3.0, z: tz } as never, k);
    const ahead = 3;
    cam.lookAt(s.x + Math.cos(s.yaw) * ahead, 0.5, -s.y - Math.sin(s.yaw) * ahead);
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

  const wheel = (radius: number, list: React.MutableRefObject<Mesh[]>, key: string) => (
    <mesh
      key={key}
      ref={(m) => {
        if (m && !list.current.includes(m)) list.current.push(m);
      }}
      rotation={[Math.PI / 2, 0, 0]}
      castShadow
    >
      <cylinderGeometry args={[radius, radius, 0.22, 24]} />
      <meshStandardMaterial color="#1c1f26" roughness={0.9} />
    </mesh>
  );

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
        <mesh position={[(a - b) / 2 + 0.1, rF + 0.35, 0]} castShadow>
          <boxGeometry args={[length, 0.6, width]} />
          <meshStandardMaterial color="#d84a3a" metalness={0.3} roughness={0.5} />
        </mesh>
        <mesh position={[(a - b) / 2 - 0.3, rF + 0.95, 0]} castShadow>
          <boxGeometry args={[length * 0.5, 0.5, width * 0.8]} />
          <meshStandardMaterial color="#3a3f4a" roughness={0.3} />
        </mesh>
        <group ref={wheelFL} position={[a, rF, -half]}>
          {wheel(rF, spinF, "fl")}
        </group>
        <group ref={wheelFR} position={[a, rF, half]}>
          {wheel(rF, spinF, "fr")}
        </group>
        <group position={[-b, rR, -half]}>{wheel(rR, spinR, "rl")}</group>
        <group position={[-b, rR, half]}>{wheel(rR, spinR, "rr")}</group>
      </group>
    </>
  );
}

/** Per-frame samples for the smoothness check, enabled with `?debug`. */
const debug: number[] | null =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).has("debug")
    ? ((window as unknown as { __cpFrames: number[] }).__cpFrames = [])
    : null;

const CAMERA = { position: [-8, 3, 0] as [number, number, number], fov: 60, near: 0.5, far: 3000 };
const GL = { preserveDrawingBuffer: true };

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
  canvasRef,
}: {
  sim: Sim;
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
      <Car key={sim.presetId} sim={sim} />
    </Canvas>
  );
}
