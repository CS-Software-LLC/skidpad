/** Original lightweight scenery; visual markers only, with no new colliders. */
import { useEffect, useMemo } from "react";
import { CanvasTexture, Shape, SRGBColorSpace } from "three";
import { OBSTACLES, obstacleQuaternion } from "./track.js";

function Cone({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0.015, z]}>
      <mesh position={[0, 0.035, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.38, 0.07, 0.38]} />
        <meshStandardMaterial color="#20272d" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.31, 0]} castShadow>
        <cylinderGeometry args={[0.035, 0.15, 0.5, 12]} />
        <meshStandardMaterial color="#f27836" roughness={0.65} />
      </mesh>
      <mesh position={[0, 0.36, 0]} castShadow>
        <cylinderGeometry args={[0.069, 0.093, 0.1, 12]} />
        <meshStandardMaterial color="#f4efe0" roughness={0.65} />
      </mesh>
    </group>
  );
}

function Barrier({ x, z }: { x: number; z: number }) {
  const profile = useMemo(() => {
    const shape = new Shape();
    shape.moveTo(-0.3, 0);
    shape.lineTo(0.3, 0);
    shape.lineTo(0.3, 0.14);
    shape.lineTo(0.13, 0.48);
    shape.lineTo(0.1, 0.8);
    shape.lineTo(-0.1, 0.8);
    shape.lineTo(-0.13, 0.48);
    shape.lineTo(-0.3, 0.14);
    shape.closePath();
    return shape;
  }, []);
  return (
    <group position={[x, 0.015, z]}>
      <mesh position={[-1.5, 0, 0]} rotation={[0, Math.PI / 2, 0]} castShadow receiveShadow>
        <extrudeGeometry args={[profile, { depth: 3, bevelEnabled: false }]} />
        <meshStandardMaterial color="#9fa8ab" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.64, z < 0 ? 0.12 : -0.12]}>
        <boxGeometry args={[0.36, 0.12, 0.035]} />
        <meshStandardMaterial color="#e4a144" roughness={0.6} />
      </mesh>
    </group>
  );
}

function DistanceBoard({ x, label, caption }: { x: number; label: string; caption: string }) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#e8e7dd";
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = "#e05b32";
    ctx.fillRect(0, 0, 256, 15);
    ctx.fillStyle = "#18242e";
    ctx.textAlign = "center";
    ctx.font = "bold 100px sans-serif";
    ctx.fillText(label, 128, 147);
    ctx.font = "bold 28px sans-serif";
    ctx.fillText(caption, 128, 211);
    const result = new CanvasTexture(canvas);
    result.colorSpace = SRGBColorSpace;
    return result;
  }, [label, caption]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <group position={[x, 0, 6]}>
      <mesh position={[0, 0.63, 0]} castShadow>
        <boxGeometry args={[0.075, 1.26, 0.075]} />
        <meshStandardMaterial color="#77818a" metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[0, 1.25, 0]} rotation={[0, -Math.PI / 2, 0]} castShadow>
        <boxGeometry args={[0.95, 0.95, 0.05]} />
        <meshStandardMaterial color="#e8e7dd" />
      </mesh>
      <mesh position={[-0.027, 1.25, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[0.95, 0.95]} />
        <meshStandardMaterial map={texture} roughness={0.9} />
      </mesh>
    </group>
  );
}

export function ProvingGround({ active }: { active: boolean }) {
  return (
    <group name="proving-ground-markers">
      {[-12, -8, -4].map((x) => (
        <Barrier key={x} x={x} z={-7} />
      ))}
      {[82, 86, 90].map((x) => (
        <Barrier key={x} x={x} z={7} />
      ))}
      {[-10, 10, 26, 34, 46, 62, 76, 90].flatMap((x) =>
        [-1, 1].map((side) => <Cone key={`${x}:${side}`} x={x} z={side * 5.4} />),
      )}
      <DistanceBoard x={6} label="30" caption="TO BUMPS" />
      <DistanceBoard x={16} label="20" caption="TO BUMPS" />
      <DistanceBoard x={26} label="10" caption="TO BUMPS" />
      {/* Paint stays on the same transformed faces as the actual obstacles. */}
      {OBSTACLES.map((o, index) => {
        const q = obstacleQuaternion(o);
        return (
          <group key={index} position={o.position} quaternion={[q.x, q.y, q.z, q.w]}>
            {o.label === "ramp"
              ? [-1, 1].map((side) => (
                  <mesh
                    key={side}
                    position={[0, o.size[1] / 2 + 0.003, side * (o.size[2] / 2 - 0.15)]}
                    rotation={[-Math.PI / 2, 0, 0]}
                  >
                    <planeGeometry args={[o.size[0] - 0.12, 0.12]} />
                    <meshStandardMaterial
                      color="#e9e1c6"
                      transparent={!active}
                      opacity={active ? 1 : 0.25}
                    />
                  </mesh>
                ))
              : o.label === "bump"
                ? [-4, -2, 0, 2, 4].map((z) => (
                    <mesh
                      key={z}
                      position={[0, o.size[1] / 2 + 0.003, z]}
                      rotation={[-Math.PI / 2, 0, 0]}
                    >
                      <planeGeometry args={[o.size[0], 0.8]} />
                      <meshStandardMaterial
                        color="#242c33"
                        transparent={!active}
                        opacity={active ? 1 : 0.25}
                      />
                    </mesh>
                  ))
                : Array.from({ length: 15 }, (_, i) => (
                    <mesh
                      key={i}
                      position={[-14 + i * 2, o.size[1] / 2 + 0.003, 0]}
                      rotation={[-Math.PI / 2, 0, 0]}
                    >
                      <planeGeometry args={[1, o.size[2]]} />
                      <meshStandardMaterial
                        color="#e8e5dc"
                        transparent={!active}
                        opacity={active ? 1 : 0.25}
                      />
                    </mesh>
                  ))}
          </group>
        );
      })}
    </group>
  );
}
