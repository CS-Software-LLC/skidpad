/** Minimal road-car interior for the cockpit view, MIT OR Apache-2.0. */
import type { MutableRefObject } from "react";
import type { PresetId } from "@skidpad/presets";
import type { SimSnapshot } from "../sim.js";
import { cabinFrame, cabinPoint, cockpitLayout } from "./cabin.js";
import { Panel, Part, SteeringWheel, TRIM } from "./parts.js";
import type { ModelDimensions } from "./types.js";

const TRIM_INNER = "#2b3138";
const HEADLINER = "#8d9196";
const SEAT = "#22272d";

/**
 * Dash, pillars, door cards, seats and a steering wheel that follows the
 * core's steering wheel angle. Only drawn while the camera is in the
 * driver's seat; karts and single-seaters keep their own open cockpits.
 */
export function Cockpit({
  preset,
  d,
  snapshot,
}: {
  preset: PresetId;
  d: ModelDimensions;
  snapshot: MutableRefObject<SimSnapshot>;
}) {
  const f = cabinFrame(preset, d);
  const { wheel, eye } = cockpitLayout(preset, d);
  if (!f || !wheel) return null;
  const { belt, roof, frontBase: cowl, roofW, split } = f;
  // The pickup cab has no tub cut; its own cab floor sits about this far down.
  const floor = f.tub?.floor ?? belt - 0.44;
  const innerW = d.halfWidth - 0.06;
  const dashRear = Math.min(cowl, f.tub?.front ?? cowl) - 0.42;
  const seatX = eye[0] - 0.22;
  const strip = (u0: number, u1: number, v0: number, v1: number, side: number) => (
    <Panel
      key={`${u0}:${v0}:${side}`}
      color={TRIM_INNER}
      points={[
        cabinPoint(f, u0, v0, side, -0.004),
        cabinPoint(f, u1, v0, side, -0.004),
        cabinPoint(f, u1, v1, side, -0.004),
        cabinPoint(f, u0, v1, side, -0.004),
      ]}
    />
  );
  return (
    <group name="cockpit">
      {/* Pillars and roof rail on each side, matching the exterior glass openings. */}
      {[-1, 1].map((side) => [
        strip(0.93, 1, 0, 1, side),
        strip(split - 0.035, split + 0.035, 0, 1, side),
        strip(0, 0.07, 0, 1, side),
        strip(0, 1, 0.9, 1, side),
        strip(0, 1, 0, 0.12, side),
      ])}
      {/* Headliner just under the painted roof. */}
      <Panel
        color={HEADLINER}
        points={[
          [f.rearTop, roof - 0.01, -roofW],
          [f.frontTop, roof - 0.01, -roofW],
          [f.frontTop, roof - 0.01, roofW],
          [f.rearTop, roof - 0.01, roofW],
        ]}
      />
      {/* Dash top just under the belt, and a low instrument hood over the cluster. */}
      <Part
        position={[(dashRear + cowl) / 2, belt - 0.18, 0]}
        size={[cowl - dashRear, 0.3, innerW * 2]}
        color={TRIM}
      />
      <Part
        position={[wheel.center[0] + 0.2, belt - 0.015, wheel.center[2]]}
        size={[0.18, 0.04, 0.3]}
        color={TRIM}
      />
      {/* Steering column, square to the rim, running down into the dash. */}
      <Part
        position={[
          wheel.center[0] + 0.2 * Math.cos(wheel.tilt),
          wheel.center[1] - 0.2 * Math.sin(wheel.tilt),
          wheel.center[2],
        ]}
        size={[0.4, 0.07, 0.07]}
        rotation={[0, 0, -wheel.tilt]}
        color={TRIM}
      />
      <SteeringWheel
        position={wheel.center}
        radius={wheel.radius}
        tilt={wheel.tilt}
        snapshot={snapshot}
      />
      {/* Door cards from the floor to the belt, and a centre console. */}
      {[-1, 1].map((side) => (
        <Part
          key={side}
          position={[(f.rearBase + cowl) / 2, (floor + belt) / 2, side * innerW]}
          size={[cowl - f.rearBase, belt - floor, 0.05]}
          color={TRIM_INNER}
        />
      ))}
      <Part
        position={[(seatX + dashRear) / 2, floor + 0.14, 0]}
        size={[dashRear - seatX + 0.3, 0.28, 0.24]}
        color={TRIM}
      />
      {/* Front seats: cushion and backrest. */}
      {[-1, 1].map((side) => (
        <group key={side} position={[seatX, floor, side * Math.abs(eye[2])]}>
          <Part position={[0.05, 0.2, 0]} size={[0.5, 0.12, 0.5]} color={SEAT} />
          <Part
            position={[-0.22, (eye[1] - floor) * 0.55, 0]}
            size={[0.1, (eye[1] - floor) * 0.75, 0.48]}
            rotation={[0, 0, 0.2]}
            color={SEAT}
          />
        </group>
      ))}
    </group>
  );
}
