import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import type { Group, Mesh } from "three";
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

  useFrame((state) => {
    sim.frame(state.clock.elapsedTime * 1000);
    const s = sim.snapshot(snap.current);
    const g = group.current;
    if (g) {
      g.position.set(s.x, 0, -s.y);
      g.rotation.set(0, s.yaw, 0);
    }
    if (wheelFL.current) wheelFL.current.rotation.y = s.steer;
    if (wheelFR.current) wheelFR.current.rotation.y = s.steer;
    const dt = state.clock.getDelta() || 1 / 60;
    for (const m of spinF.current) m.rotation.z -= s.wheelF * dt;
    for (const m of spinR.current) m.rotation.z -= s.wheelR * dt;
    // Chase camera.
    const cam = state.camera;
    const back = 9;
    const tx = s.x - Math.cos(s.yaw) * back;
    const tz = -s.y + Math.sin(s.yaw) * back;
    cam.position.lerp({ x: tx, y: 3.2, z: tz } as never, 0.08);
    cam.lookAt(s.x, 0.6, -s.y);
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
  );
}

function Ground() {
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[2000, 2000]} />
        <meshStandardMaterial color="#2d3340" />
      </mesh>
      <gridHelper args={[2000, 400, "#4a5368", "#3a4152"]} position={[0, 0.01, 0]} />
      {/* A 40 m skidpad circle, matching the understeer validation radius. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, -40]}>
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
      camera={{ position: [-8, 3, 0], fov: 60, near: 0.1, far: 3000 }}
      gl={{ preserveDrawingBuffer: true }}
      onCreated={({ gl }) => {
        canvasRef.current = gl.domElement;
      }}
    >
      <color attach="background" args={["#10131a"]} />
      <fog attach="fog" args={["#10131a", 80, 400]} />
      <hemisphereLight args={["#dde6ff", "#2a2e38", 0.9]} />
      <directionalLight
        position={[30, 50, 20]}
        intensity={1.4}
        castShadow
        shadow-mapSize={[2048, 2048]}
      />
      <Ground />
      <Car key={sim.presetId} sim={sim} />
    </Canvas>
  );
}
