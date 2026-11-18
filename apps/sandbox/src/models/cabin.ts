/**
 * Cabin layout shared by the road-car artwork and the cockpit view.
 * Model coordinates: metres, +X forward, +Y up, +Z to the right (core −y);
 * the origin is the CG's ground projection at static ride height.
 */
import type { TireDefinition, VehicleDefinition } from "@skidpad/core";
import type { PresetId } from "@skidpad/presets";
import { WHEEL_STYLES, type ModelDimensions } from "./types.js";

export type Point = [number, number, number];

export function tireRadius(tire: TireDefinition): number {
  const r = tire.model === "feel" ? tire.radius : tire.unloadedRadius;
  return typeof r === "number" ? r : 0.31;
}

/** Wheel-centre layout and body half width the artwork is built around. */
export function modelDimensions(def: VehicleDefinition, preset: PresetId): ModelDimensions {
  const a = def.chassis.cgToFrontAxle;
  const b = def.chassis.wheelbase - a;
  // Each axle's own track, or the chassis track when it sets none.
  const halfTrack = (axle: number) => (def.axles[axle]!.trackWidth || def.chassis.trackWidth) / 2;
  const halfF = halfTrack(0);
  const halfR = halfTrack(1);
  const widths = WHEEL_STYLES[preset].widths;
  return {
    frontAxle: a,
    rearAxle: -b,
    frontHalfTrack: halfF,
    rearHalfTrack: halfR,
    halfWidth: Math.max(halfF + widths[0] / 2, halfR + widths[1] / 2) - 0.01,
    frontRadius: tireRadius(def.axles[0]!.tire),
    rearRadius: tireRadius(def.axles[1]!.tire),
  };
}

/** A greenhouse: base line at the belt, top line at the roof, and its pillars. */
export interface CabinFrame {
  /** Windshield base and top, rear glass top and base, along X. */
  frontBase: number;
  frontTop: number;
  rearTop: number;
  rearBase: number;
  belt: number;
  roof: number;
  /** Half widths of the greenhouse at the belt and at the roof. */
  width: number;
  roofW: number;
  /** Where the B pillar sits, as a fraction from rear (0) to front (1). */
  split: number;
  /** The body's sill-level cut for the cockpit view: floor height and X span. */
  tub: { floor: number; rear: number; front: number } | null;
}

/** Point on a cabin side: `u` from rear (0) to front (1), `v` from belt (0) to roof (1). */
export function cabinPoint(f: CabinFrame, u: number, v: number, side: number, offset = 0): Point {
  return [
    (f.rearBase + (f.frontBase - f.rearBase) * u) * (1 - v) +
      (f.rearTop + (f.frontTop - f.rearTop) * u) * v,
    f.belt + (f.roof - f.belt) * v,
    side * (f.width + (f.roofW - f.width) * v + offset),
  ];
}

/** The cut spans the cabin between the wheel arches, with clearance for the bevel. */
function tub(d: ModelDimensions, bottom: number, cowl: number): CabinFrame["tub"] {
  return {
    floor: bottom + 0.15,
    rear: d.rearAxle + d.rearRadius + 0.18,
    front: Math.min(cowl, d.frontAxle - d.frontRadius - 0.18),
  };
}

/** The four enclosed road cars; karts and single-seaters have no greenhouse. */
export function cabinFrame(preset: PresetId, d: ModelDimensions): CabinFrame | null {
  const a = d.frontAxle,
    b = d.rearAxle,
    wb = a - b,
    w = d.halfWidth,
    r = Math.max(d.frontRadius, d.rearRadius);
  switch (preset) {
    case "hatchbackFwd": {
      const belt = r + 0.52;
      const cowl = a - wb * 0.12;
      const rear = b - wb * 0.25;
      return {
        frontBase: cowl,
        frontTop: cowl - wb * 0.24,
        rearTop: b + wb * 0.06,
        rearBase: rear + 0.13,
        belt,
        roof: belt + 0.57,
        width: w,
        roofW: w * 0.79,
        split: 0.45,
        tub: tub(d, 0.19, cowl),
      };
    }
    case "sportsRwd": {
      const belt = r * 2 + 0.19;
      const cowl = a - wb * 0.23;
      const width = w * 0.87;
      return {
        frontBase: cowl,
        frontTop: cowl - wb * 0.2,
        rearTop: b + wb * 0.2,
        rearBase: b - wb * 0.035,
        belt,
        roof: belt + 0.36,
        width,
        roofW: width * 0.79,
        split: 0.18,
        tub: tub(d, 0.16, cowl),
      };
    }
    case "crossoverEv": {
      const belt = r + 0.62;
      const cowl = a - wb * 0.1;
      const width = w * 0.96;
      return {
        frontBase: cowl,
        frontTop: a - wb * 0.36,
        rearTop: b + wb * 0.12,
        rearBase: b - wb * 0.28 + 0.12,
        belt,
        roof: belt + 0.64,
        width,
        roofW: width * 0.79,
        split: 0.45,
        tub: tub(d, 0.23, cowl),
      };
    }
    case "pickup4x4": {
      const belt = r + 0.74;
      const cowl = a - wb * 0.12;
      const cabRear = b + wb * 0.39;
      const width = w * 0.97;
      return {
        frontBase: cowl,
        frontTop: cowl - wb * 0.13,
        rearTop: cabRear + 0.08,
        rearBase: cabRear,
        belt,
        roof: belt + 0.73,
        width,
        roofW: width * 0.79,
        split: 0.4,
        // The cab is already open between its side panels down to the cab floor.
        tub: null,
      };
    }
    default:
      return null;
  }
}

/**
 * Cut a rectangular tub into a side profile (points in increasing X) between
 * `rear` and `front`, down to `floor`, so the camera sees a cabin instead of
 * the top of a solid body.
 */
export function notchProfile(
  top: ReadonlyArray<readonly [number, number]>,
  cut: { floor: number; rear: number; front: number },
): Array<[number, number]> {
  const yAt = (x: number) => {
    for (let i = 0; i + 1 < top.length; i++) {
      const [x0, y0] = top[i]!;
      const [x1, y1] = top[i + 1]!;
      if (x >= x0 && x <= x1) return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
    return top[top.length - 1]![1];
  };
  const out: Array<[number, number]> = [];
  for (const [x, y] of top) if (x < cut.rear) out.push([x, y]);
  out.push([cut.rear, yAt(cut.rear)], [cut.rear, cut.floor]);
  out.push([cut.front, cut.floor], [cut.front, yAt(cut.front)]);
  for (const [x, y] of top) if (x > cut.front) out.push([x, y]);
  return out;
}

/** Where the driver's eyes and steering wheel are, in model coordinates. */
export interface CockpitLayout {
  eye: Point;
  /** Camera pitch below the horizon, rad. */
  pitch: number;
  /** Steering wheel rim centre, radius and forward lean of its top (rad); null when the model has its own. */
  wheel: { center: Point; radius: number; tilt: number } | null;
}

/**
 * Driver eye point for each preset. Road cars are left-hand drive: the driver
 * sits on the left, which is −Z here. Road-car eyes sit a little forward of
 * the greenhouse's middle and 0.13 to 0.24 m under the roof; the steering
 * wheel is half a metre ahead of and about a third of a metre below the eyes.
 */
export function cockpitLayout(preset: PresetId, d: ModelDimensions): CockpitLayout {
  const a = d.frontAxle,
    b = d.rearAxle,
    wb = a - b;
  const f = cabinFrame(preset, d);
  if (f) {
    const headroom = Math.min(0.24, Math.max(0.13, (f.roof - f.belt) * 0.42));
    const eyeY = f.roof - headroom;
    const eyeX = f.frontTop - (f.frontTop - f.rearTop) * 0.38;
    const eyeZ = -f.width * 0.45;
    return {
      eye: [eyeX, eyeY, eyeZ],
      pitch: 0.07,
      wheel: { center: [eyeX + 0.5, eyeY - 0.32, eyeZ], radius: 0.185, tilt: 0.42 },
    };
  }
  if (preset === "kart") {
    // Sitting up over the seat and looking down past the wheel at the track.
    return { eye: [b + wb * 0.32 - 0.12, 0.78, 0], pitch: 0.22, wheel: null };
  }
  // Single-seater: a reclined driver, eyes just above the cockpit rim.
  return { eye: [a - wb * 0.28 - 0.68, 0.72, 0], pitch: 0.06, wheel: null };
}
