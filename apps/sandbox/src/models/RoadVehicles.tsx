/** Original road-vehicle models, MIT OR Apache-2.0. */
import { useMemo } from "react";
import { Shape } from "three";
import { Panel, Part, TRIM, type Point } from "./parts.js";
import type { ModelDimensions } from "./types.js";

type Profile = Array<[number, number]>;

/** A side silhouette with true open arches. Pickup sides leave the bed hollow. */
function Body({
  d,
  top,
  bottom,
  color,
  sidesOnly = false,
}: {
  d: ModelDimensions;
  top: Profile;
  bottom: number;
  color: string;
  sidesOnly?: boolean;
}) {
  const shape = useMemo(() => {
    const s = new Shape();
    s.moveTo(top[0]![0], bottom);
    for (const [x, y] of top) s.lineTo(x, y);
    s.lineTo(top[top.length - 1]![0], bottom);
    for (const [x, radius] of [
      [d.frontAxle, d.frontRadius],
      [d.rearAxle, d.rearRadius],
    ] as const) {
      const r = radius + 0.12;
      const angle = Math.asin(Math.max(-0.98, Math.min(0.98, (bottom - radius) / r)));
      s.lineTo(x + Math.cos(angle) * r, bottom);
      s.absarc(x, radius, r, angle, Math.PI - angle, false);
    }
    s.closePath();
    return s;
  }, [top, bottom, d.frontAxle, d.frontRadius, d.rearAxle, d.rearRadius]);
  const depth = sidesOnly ? 0.105 : d.halfWidth * 2 - 0.05;
  const offsets = sidesOnly
    ? [-d.halfWidth + 0.025, d.halfWidth - depth - 0.025]
    : [-d.halfWidth + 0.025];
  return (
    <group name="arched-body">
      {offsets.map((z) => (
        <mesh key={z} position={[0, 0, z]} castShadow receiveShadow>
          <extrudeGeometry
            args={[
              shape,
              {
                depth,
                bevelEnabled: true,
                bevelSize: 0.025,
                bevelThickness: 0.025,
                bevelSegments: 2,
                curveSegments: 16,
                steps: 1,
              },
            ]}
          />
          <meshStandardMaterial color={color} metalness={0.33} roughness={0.33} />
        </mesh>
      ))}
    </group>
  );
}

/** Glass panels are inset on the cabin's trapezoidal faces, leaving real pillars. */
function Cabin({
  frontBase,
  frontTop,
  rearTop,
  rearBase,
  belt,
  roof,
  width,
  color,
  split = 0.45,
  darkRoof = false,
}: {
  frontBase: number;
  frontTop: number;
  rearTop: number;
  rearBase: number;
  belt: number;
  roof: number;
  width: number;
  color: string;
  split?: number;
  darkRoof?: boolean;
}) {
  const roofW = width * 0.79;
  const point = (u: number, v: number, side: number, offset = 0): Point => [
    (rearBase + (frontBase - rearBase) * u) * (1 - v) + (rearTop + (frontTop - rearTop) * u) * v,
    belt + (roof - belt) * v,
    side * (width + (roofW - width) * v + offset),
  ];
  return (
    <group name="cabin">
      <Panel
        color={darkRoof ? TRIM : color}
        points={[
          [rearTop, roof, -roofW],
          [frontTop, roof, -roofW],
          [frontTop, roof, roofW],
          [rearTop, roof, roofW],
        ]}
      />
      <Panel
        glass
        points={[
          [frontTop, roof, -roofW],
          [frontBase, belt, -width],
          [frontBase, belt, width],
          [frontTop, roof, roofW],
        ]}
      />
      <Panel
        glass
        points={[
          [rearBase, belt, width],
          [rearBase, belt, -width],
          [rearTop, roof, -roofW],
          [rearTop, roof, roofW],
        ]}
      />
      {[-1, 1].map((side) => (
        <group key={side}>
          <Panel
            color={color}
            points={[point(0, 0, side), point(1, 0, side), point(1, 1, side), point(0, 1, side)]}
          />
          {[
            [0.07, split - 0.035],
            [split + 0.035, 0.93],
          ].map(([start, end], i) => (
            <Panel
              key={i}
              glass
              points={[
                point(start!, 0.12, side, 0.006),
                point(end!, 0.12, side, 0.006),
                point(end!, 0.9, side, 0.006),
                point(start!, 0.9, side, 0.006),
              ]}
            />
          ))}
          <Part
            position={[frontBase - 0.12, belt + 0.1, side * (width + 0.08)]}
            size={[0.13, 0.04, 0.24]}
            color={TRIM}
          />
          <Part
            position={[frontBase - 0.12, belt + 0.14, side * (width + 0.19)]}
            size={[0.22, 0.13, 0.16]}
            color={color}
          />
          <Part
            position={[frontBase - 0.235, belt + 0.14, side * (width + 0.19)]}
            size={[0.01, 0.095, 0.115]}
            color="#9daeb7"
          />
        </group>
      ))}
    </group>
  );
}

function Exhaust({ x, y, z }: { x: number; y: number; z: number }) {
  return (
    <mesh position={[x, y, z]} rotation={[0, Math.PI / 2, 0]} castShadow>
      <torusGeometry args={[0.052, 0.013, 8, 16]} />
      <meshStandardMaterial color="#b0b9bf" metalness={0.8} roughness={0.24} />
    </mesh>
  );
}

export function SportsCoupe({ d }: { d: ModelDimensions }) {
  const a = d.frontAxle,
    b = d.rearAxle,
    wb = a - b,
    w = d.halfWidth;
  const front = a + wb * 0.29,
    rear = b - wb * 0.29;
  const belt = Math.max(d.frontRadius, d.rearRadius) * 2 + 0.19;
  const roof = belt + 0.36;
  const cowl = a - wb * 0.23;
  const rearGlass = b - wb * 0.035;
  const color = "#2f78b6";
  return (
    <group name="sports-coupe-body">
      <Body
        d={d}
        bottom={0.16}
        color={color}
        top={[
          [rear, belt - 0.2],
          [rear + 0.16, belt],
          [b + 0.25, belt + 0.025],
          [cowl, belt],
          [front - 0.15, belt - 0.11],
          [front, belt - 0.26],
        ]}
      />
      <Cabin
        frontBase={cowl}
        frontTop={cowl - wb * 0.2}
        rearTop={b + wb * 0.2}
        rearBase={rearGlass}
        belt={belt}
        roof={roof}
        width={w * 0.87}
        color={color}
        split={0.18}
      />
      <Part position={[front - 0.08, 0.16, 0]} size={[0.35, 0.055, w * 2.06]} color={TRIM} />
      <Part position={[front + 0.013, 0.37, 0]} size={[0.04, 0.14, w * 0.95]} color={TRIM} />
      <Part position={[rear - 0.015, 0.26, 0]} size={[0.07, 0.17, w * 1.78]} color={TRIM} />
      <Part
        position={[rear + 0.11, belt + 0.04, 0]}
        size={[0.22, 0.055, w * 1.94]}
        color={color}
        rotation={[0, 0, -0.1]}
      />
      {[-1, 1].map((side) => (
        <group key={side}>
          <Part
            position={[front - 0.04, belt - 0.21, side * w * 0.73]}
            size={[0.1, 0.07, w * 0.39]}
            color="#e6f4ff"
            glow
          />
          <Part
            position={[rear - 0.025, belt - 0.13, side * w * 0.66]}
            size={[0.045, 0.075, w * 0.48]}
            color="#f03437"
            glow
          />
          <Part
            position={[(a + b) / 2, 0.19, side * w]}
            size={[Math.max(0.15, wb - d.frontRadius - d.rearRadius - 0.28), 0.1, 0.075]}
            color={TRIM}
          />
          <Part
            position={[b + wb * 0.38, belt - 0.09, side * (w + 0.028)]}
            size={[0.17, 0.028, 0.018]}
            color="#bfd6e5"
          />
          <Part
            position={[a - d.frontRadius - 0.22, belt - 0.14, side * (w + 0.028)]}
            size={[0.22, 0.08, 0.025]}
            color={TRIM}
          />
          <Exhaust x={rear - 0.056} y={0.245} z={side * w * 0.67} />
          {/* Two bonnet stripes follow its slope. */}
          <Part
            position={[(cowl + front - 0.15) / 2, belt - 0.022, side * 0.1]}
            size={[front - 0.15 - cowl, 0.01, 0.055]}
            rotation={[0, 0, -Math.atan2(0.11, front - 0.15 - cowl)]}
            color="#d9e7eb"
          />
        </group>
      ))}
    </group>
  );
}

export function Crossover({ d }: { d: ModelDimensions }) {
  const a = d.frontAxle,
    b = d.rearAxle,
    wb = a - b,
    w = d.halfWidth;
  const front = a + wb * 0.27,
    rear = b - wb * 0.28;
  const belt = Math.max(d.frontRadius, d.rearRadius) + 0.62;
  const roof = belt + 0.64;
  const cowl = a - wb * 0.1,
    topFront = a - wb * 0.36,
    topRear = b + wb * 0.12;
  const color = "#b9d5d5";
  return (
    <group name="crossover-body">
      <Body
        d={d}
        bottom={0.23}
        color={color}
        top={[
          [rear, belt - 0.18],
          [rear + 0.14, belt],
          [cowl, belt],
          [front - 0.18, belt - 0.17],
          [front, belt - 0.31],
        ]}
      />
      <Cabin
        frontBase={cowl}
        frontTop={topFront}
        rearTop={topRear}
        rearBase={rear + 0.12}
        belt={belt}
        roof={roof}
        width={w * 0.96}
        color={color}
        darkRoof
      />
      <Part
        position={[front + 0.01, belt - 0.28, 0]}
        size={[0.045, 0.045, w * 1.79]}
        color="#e9fcff"
        glow
      />
      <Part position={[front + 0.028, 0.38, 0]} size={[0.065, 0.16, w * 1.7]} color={TRIM} />
      <Part
        position={[rear - 0.026, belt - 0.11, 0]}
        size={[0.045, 0.055, w * 1.76]}
        color="#f03a39"
        glow
      />
      <Part position={[rear - 0.015, 0.35, 0]} size={[0.065, 0.19, w * 1.87]} color={TRIM} />
      <Part position={[rear - 0.05, belt - 0.37, 0]} size={[0.01, 0.12, 0.42]} color="#e8e5dc" />
      <Part
        position={[topRear - 0.04, roof + 0.025, 0]}
        size={[0.26, 0.045, w * 1.57]}
        color={TRIM}
      />
      {[-1, 1].map((side) => (
        <group key={side}>
          <Part
            position={[(a + b) / 2, 0.255, side * w]}
            size={[Math.max(0.15, wb - d.frontRadius - d.rearRadius - 0.28), 0.16, 0.065]}
            color={TRIM}
          />
          {[0.23, 0.57].map((t) => (
            <Part
              key={t}
              position={[b + wb * t, belt - 0.115, side * (w + 0.028)]}
              size={[0.18, 0.027, 0.015]}
              color={TRIM}
            />
          ))}
          <Part
            position={[(topRear + topFront) / 2, roof + 0.045, side * w * 0.66]}
            size={[topFront - topRear, 0.05, 0.045]}
            color="#657983"
          />
          <Part
            position={[front - 0.08, belt - 0.43, side * w * 0.74]}
            size={[0.06, 0.06, 0.16]}
            color="#daeaf0"
            glow
          />
        </group>
      ))}
      <Part
        position={[b + 0.2, belt - 0.19, w + 0.027]}
        size={[0.16, 0.14, 0.016]}
        color="#95b9bf"
      />
    </group>
  );
}

export function Pickup({ d }: { d: ModelDimensions }) {
  const a = d.frontAxle,
    b = d.rearAxle,
    wb = a - b,
    w = d.halfWidth;
  const front = a + wb * 0.25,
    rear = b - wb * 0.26;
  const belt = Math.max(d.frontRadius, d.rearRadius) + 0.74;
  const roof = belt + 0.73;
  const cowl = a - wb * 0.12,
    cabRear = b + wb * 0.39;
  const topFront = cowl - wb * 0.13,
    topRear = cabRear + 0.08;
  const color = "#bfa375";
  const bedLength = cabRear - rear - 0.15;
  return (
    <group name="pickup-body">
      <Body
        d={d}
        bottom={0.3}
        color={color}
        sidesOnly
        top={[
          [rear, belt - 0.04],
          [cabRear, belt - 0.04],
          [cabRear + 0.07, belt],
          [cowl, belt],
          [front - 0.11, belt - 0.05],
          [front, belt - 0.19],
        ]}
      />
      <Cabin
        frontBase={cowl}
        frontTop={topFront}
        rearTop={topRear}
        rearBase={cabRear}
        belt={belt}
        roof={roof}
        width={w * 0.97}
        color={color}
        split={0.4}
      />
      {/* Hood and cab are closed; the separate bed has a recessed floor and wheel tubs. */}
      <Panel
        color={color}
        points={[
          [cowl, belt, -w],
          [front - 0.11, belt - 0.05, -w],
          [front - 0.11, belt - 0.05, w],
          [cowl, belt, w],
        ]}
      />
      <Panel
        color={color}
        points={[
          [front - 0.11, belt - 0.05, -w],
          [front, belt - 0.19, -w],
          [front, belt - 0.19, w],
          [front - 0.11, belt - 0.05, w],
        ]}
      />
      <Part
        position={[(cabRear + cowl) / 2, 0.59, 0]}
        size={[cowl - cabRear, 0.22, w * 1.8]}
        color={color}
      />
      <Part position={[cabRear, 0.83, 0]} size={[0.12, 0.61, w * 1.8]} color={color} />
      <Part
        position={[(rear + cabRear - 0.12) / 2, 0.7, 0]}
        size={[bedLength, 0.09, w * 1.79]}
        color="#424a4b"
      />
      {[-0.62, -0.31, 0, 0.31, 0.62].map((t) => (
        <Part
          key={t}
          position={[(rear + cabRear - 0.12) / 2, 0.75, t * w]}
          size={[bedLength - 0.09, 0.022, 0.035]}
          color="#596162"
        />
      ))}
      <Part position={[rear + 0.025, 0.91, 0]} size={[0.1, 0.42, w * 1.93]} color={color} />
      <Part position={[rear - 0.031, 1.025, 0]} size={[0.025, 0.055, 0.27]} color={TRIM} />
      <Part
        position={[front - 0.035, (belt + 0.21) / 2, 0]}
        size={[0.09, belt - 0.59, w * 1.94]}
        color={color}
      />
      <Part position={[front + 0.026, belt - 0.32, 0]} size={[0.09, 0.28, w * 1.12]} color={TRIM} />
      {[0, 1, 2].map((i) => (
        <Part
          key={i}
          position={[front + 0.077, belt - 0.22 - i * 0.075, 0]}
          size={[0.025, 0.022, w * 1.04]}
          color="#a7b1b6"
        />
      ))}
      <Part position={[front + 0.035, 0.42, 0]} size={[0.16, 0.17, w * 2.04]} color="#748086" />
      <Part position={[rear - 0.04, 0.44, 0]} size={[0.19, 0.16, w * 2.04]} color="#748086" />
      {[-1, 1].map((side) => (
        <group key={side}>
          <Part
            position={[(rear + cabRear) / 2, belt - 0.018, side * (w - 0.04)]}
            size={[cabRear - rear, 0.06, 0.13]}
            color={TRIM}
          />
          <Part
            position={[b, 0.78, side * w * 0.7]}
            size={[d.rearRadius * 2.35, 0.21, w * 0.37]}
            color="#424a4b"
          />
          <Part
            position={[front + 0.02, belt - 0.22, side * w * 0.78]}
            size={[0.1, 0.19, w * 0.3]}
            color="#f7f5dd"
            glow
          />
          <Part
            position={[rear - 0.035, belt - 0.21, side * w * 0.83]}
            size={[0.045, 0.26, 0.12]}
            color="#ef3330"
            glow
          />
          <Part
            position={[(cabRear + cowl) / 2, 0.27, side * (w + 0.075)]}
            size={[Math.max(0.15, wb - d.frontRadius - d.rearRadius - 0.35), 0.065, 0.2]}
            color={TRIM}
          />
          {[0.2, 0.58].map((t) => (
            <Part
              key={t}
              position={[cabRear + (cowl - cabRear) * t, belt - 0.14, side * (w + 0.03)]}
              size={[0.2, 0.035, 0.025]}
              color={TRIM}
            />
          ))}
        </group>
      ))}
      <Part position={[rear - 0.14, 0.31, 0]} size={[0.32, 0.075, 0.09]} color={TRIM} />
    </group>
  );
}
