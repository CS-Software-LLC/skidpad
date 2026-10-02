import { DoubleSide } from "three";
import { Part } from "./parts.js";
import type { WheelStyle } from "./types.js";

/** The complete wheel rotates around local Z, inside the steering group. */
export function VehicleWheel({
  radius,
  width,
  side,
  style,
}: {
  radius: number;
  width: number;
  side: number;
  style: WheelStyle;
}) {
  const rimRatio = { alloy: 0.67, sport: 0.73, offroad: 0.56, aero: 0.75, kart: 0.55, slick: 0.58 }[
    style
  ];
  const rim = radius * rimRatio;
  const spokes = style === "kart" ? 3 : style === "slick" || style === "offroad" ? 6 : 5;
  const wheelColor = style === "sport" || style === "slick" ? "#8d959d" : "#c5ced5";
  return (
    <group name="detailed-wheel" userData={{ style, radius, width }}>
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[radius, radius, width, 32]} />
        <meshStandardMaterial color="#20242a" roughness={0.94} />
      </mesh>
      {/* Raised shoulder ribs stay inside the nominal rolling radius. */}
      {style === "offroad" &&
        Array.from({ length: 20 }, (_, i) => (
          <group key={i} rotation={[0, 0, (i * Math.PI) / 10]}>
            {[-1, 1].map((s) => (
              <Part
                key={s}
                position={[0, radius - 0.008, s * width * 0.3]}
                size={[radius * 0.13, 0.016, width * 0.36]}
                color="#383b3c"
              />
            ))}
          </group>
        ))}
      <group position={[0, 0, side * (width / 2 + 0.004)]}>
        <mesh>
          <circleGeometry args={[rim, 32]} />
          <meshStandardMaterial
            color={style === "aero" ? "#414b54" : "#171d22"}
            side={DoubleSide}
          />
        </mesh>
        <mesh>
          <torusGeometry args={[rim, radius * 0.045, 6, 32]} />
          <meshStandardMaterial color={wheelColor} metalness={0.7} roughness={0.26} />
        </mesh>
        {Array.from({ length: spokes }, (_, i) => (
          <group key={i} rotation={[0, 0, (i * Math.PI * 2) / spokes]}>
            <Part
              position={[rim * 0.5, 0, side * 0.006]}
              size={[rim * 0.96, rim * (style === "aero" ? 0.44 : 0.16), radius * 0.075]}
              color={wheelColor}
            />
          </group>
        ))}
        <mesh scale={[1, 1, 0.65]}>
          <sphereGeometry args={[rim * 0.24, 12, 8]} />
          <meshStandardMaterial
            color={style === "slick" ? "#e5b858" : "#8b99a4"}
            metalness={0.7}
            roughness={0.3}
          />
        </mesh>
        {style === "slick" && (
          <mesh>
            <torusGeometry args={[radius * 0.84, radius * 0.012, 4, 40]} />
            <meshStandardMaterial color="#e8c66a" />
          </mesh>
        )}
        <Part
          position={[0, radius * 0.88, 0]}
          size={[radius * 0.15, radius * 0.06, 0.006]}
          color="#b1b2a5"
        />
      </group>
    </group>
  );
}
