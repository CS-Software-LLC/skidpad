/**
 * Skidpad's model of Project Chrono's BMW_E90, built from Chrono's published
 * constants (`chrono-e90.ts`) and its measured static state
 * (`reference/static.json`). Every value is taken or derived from Chrono
 * except the anti-roll bar rates, which are FITTED (see `fit.ts`): Chrono's
 * bars act through linkages Skidpad does not model, so their wheel rates
 * are identified from Chrono's roll gradient and front share of lateral
 * load transfer.
 *
 * What Skidpad cannot represent, and how each is handled, is listed in
 * `GAPS` and reported with the results.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PartialVehicleDefinition } from "@skidpad/core";
import * as c from "./chrono-e90.js";
import { doubleWishboneRollCentre, macphersonRollCentre } from "./geometry.js";
import { fitMagicFormula } from "./tire-fit.js";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

type Vec3 = [number, number, number];

export interface ChronoStatic {
  mass: number;
  wheelbase: number;
  track: [number, number];
  comLocal: [number, number, number];
  inertia: [Vec3, Vec3, Vec3];
  refHeight: number;
  loads: [number, number, number, number];
  spindleLocal: [Vec3, Vec3, Vec3, Vec3];
  toe: [number, number, number, number];
}

export function loadStatic(): ChronoStatic {
  return JSON.parse(readFileSync(join(ROOT, "reference", "static.json"), "utf8")) as ChronoStatic;
}

/** Anti-roll bar wheel rates, N/m: FITTED by `fit.ts` (`pnpm compare --fit`). */
export const FITTED_ANTI_ROLL = { front: 13000, rear: 6000 };

/** Tire relaxation length, m. TMsimple has none; this is under one substep at 20 m/s. */
const RELAXATION_LENGTH = 0.02;

/** Wheel travel between the static position and each Chrono spring stop, m. */
function stopTravel(
  s: (typeof c.SUSPENSION)["front"],
  spindleZ: number,
): { bump: number; droop: number } {
  const atWheel = s.stopSpringTravel * s.kinematicFactor;
  // Hardpoints are at the design position, spindle at z = 0; the car rests
  // below its design load, so the spindle sits below it (droop).
  return { bump: atWheel - spindleZ, droop: atWheel + spindleZ };
}

export interface Derived {
  frontLoad: number;
  rearLoad: number;
  cgHeight: number;
  wheelbase: number;
  cgToFrontAxle: number;
  trackWidth: number;
  rollCentre: { front: number; rear: number };
  loadedRadius: { front: number; rear: number };
  rollingRadius: number;
  springRate: { front: number; rear: number };
  stops: { front: { bump: number; droop: number }; rear: { bump: number; droop: number } };
  wheelInertia: { front: number; rear: number };
  engineBraking: { idle: number; redline: number };
  staticToeDeg: { front: number; rear: number };
}

const IDLE_RPM = 800;

/**
 * Least-squares line through Chrono's closed-throttle map over the speeds the
 * engine turns while braking and coasting in the reference manoeuvres
 * (third gear from 100 km/h down, 3000–5000 rpm). Skidpad's drag is linear
 * from idle to redline; Chrono's map is not, so the line is fitted where it
 * is used.
 */
function engineBrakingLine(): { idle: number; redline: number } {
  const pts = c.ENGINE_CLOSED_THROTTLE.filter(([rpm]) => rpm >= 3000 && rpm <= 5000);
  const xs = pts.map(([rpm]) => (rpm - IDLE_RPM) / (c.ENGINE_MAX_RPM - IDLE_RPM));
  const ys = pts.map(([, tq]) => -tq);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
  }
  const slope = sxy / sxx;
  const idle = my - slope * mx;
  if (idle >= 0) return { idle, redline: idle + slope };
  // Skidpad's drag cannot be negative at idle: the best line through zero there.
  const through = xs.reduce((a, x, i) => a + x * ys[i]!, 0) / xs.reduce((a, x) => a + x * x, 0);
  return { idle: 0, redline: through };
}

export function derive(s: ChronoStatic = loadStatic()): Derived {
  const [fl, fr, rl, rr] = s.loads;
  const frontLoad = 0.5 * (fl + fr);
  const rearLoad = 0.5 * (rl + rr);
  const [sf, , sr] = s.spindleLocal;
  const wheelbase =
    0.5 * (s.spindleLocal[0][0] + s.spindleLocal[1][0]) -
    0.5 * (s.spindleLocal[2][0] + s.spindleLocal[3][0]);
  const cgToFrontAxle = 0.5 * (s.spindleLocal[0][0] + s.spindleLocal[1][0]) - s.comLocal[0];
  // The car rests slightly pitched; the centre-of-mass height is taken from
  // the loaded tire radius and spindle height at the centre of mass's
  // fore-aft position, i.e. the chassis-frame height above the axle line.
  const loadedFront = c.TIRE_FRONT.unloadedRadius - frontLoad / c.TIRE_FRONT.verticalStiffness;
  const loadedRear = c.TIRE_REAR.unloadedRadius - rearLoad / c.TIRE_REAR.verticalStiffness;
  const frac = cgToFrontAxle / wheelbase;
  const axleLineZ = sf[2] + frac * (sr[2] - sf[2]);
  const groundBelow = axleLineZ - (loadedFront + frac * (loadedRear - loadedFront));
  const cgHeight = s.comLocal[2] - groundBelow;
  const trackWidth = 0.5 * (2 * sf[1] + 2 * sr[1]);
  const front = macphersonRollCentre(sf[2], loadedFront);
  const rear = doubleWishboneRollCentre(sr[2], loadedRear);
  // Skidpad's wheel is rigid, so the tire's vertical compliance goes in
  // series with the spring.
  const series = (k: number, kt: number) => (k * kt) / (k + kt);
  return {
    frontLoad,
    rearLoad,
    cgHeight,
    wheelbase,
    cgToFrontAxle,
    trackWidth,
    rollCentre: { front: front.height, rear: rear.height },
    loadedRadius: { front: loadedFront, rear: loadedRear },
    // TMsimple's effective rolling radius `(2·R0 + r_loaded) / 3`.
    rollingRadius: (2 * c.TIRE_FRONT.unloadedRadius + loadedFront) / 3,
    springRate: {
      front: series(c.SUSPENSION.front.springRate, c.TIRE_FRONT.verticalStiffness),
      rear: series(c.SUSPENSION.rear.springRate, c.TIRE_REAR.verticalStiffness),
    },
    stops: {
      front: stopTravel(c.SUSPENSION.front, sf[2]),
      rear: stopTravel(c.SUSPENSION.rear, sr[2]),
    },
    wheelInertia: {
      front:
        c.RIM_INERTIA.front +
        c.TIRE_FRONT.spinInertia +
        c.SPINDLE_INERTIA.front +
        c.AXLE_SHAFT_INERTIA,
      rear:
        c.RIM_INERTIA.rear +
        c.TIRE_REAR.spinInertia +
        c.SPINDLE_INERTIA.rear +
        c.AXLE_SHAFT_INERTIA,
    },
    engineBraking: engineBrakingLine(),
    staticToeDeg: {
      front: (((s.toe[1] - s.toe[0]) / 2) * 180) / Math.PI,
      rear: (((s.toe[3] - s.toe[2]) / 2) * 180) / Math.PI,
    },
  };
}

/** Largest road-wheel angle, degrees; the harness steers in fractions of it. */
export const MAX_WHEEL_ANGLE_DEG = 45;

export function bmwE90(
  antiRoll: { front: number; rear: number } = FITTED_ANTI_ROLL,
  d: Derived = derive(),
): PartialVehicleDefinition {
  const tire = (t: c.TmSimpleTire, fz0: number) => ({
    model: "magicFormula" as const,
    ...fitMagicFormula(t, fz0),
    unloadedRadius: d.rollingRadius,
    relaxationLengthLong: RELAXATION_LENGTH,
    relaxationLengthLat: RELAXATION_LENGTH,
  });
  // Chrono's spring stops: 2x the spring rate, at the wheel.
  const suspension = (
    k: number,
    damping: number,
    arb: number,
    stops: { bump: number; droop: number },
    stopRate: number,
    rollCenterHeight: number,
  ) => ({
    kind: "independent" as const,
    springRate: k,
    bumpDamping: damping,
    reboundDamping: damping,
    travelBump: stops.bump,
    // Skidpad's droop limit lets the wheel hang free rather than meeting a
    // stop spring, so it is set beyond Chrono's rebound stop (see GAPS).
    travelDroop: 0.15,
    antiRollStiffness: arb,
    bumpStopStiffness: stopRate,
    rollCenterHeight,
  });
  return {
    name: "BMW E90 (Project Chrono 9.0.1 reference)",
    chassis: {
      mass: loadStaticCached().mass,
      yawInertia: loadStaticCached().inertia[2][2],
      rollInertia: loadStaticCached().inertia[0][0],
      pitchInertia: loadStaticCached().inertia[1][1],
      wheelbase: d.wheelbase,
      cgToFrontAxle: d.cgToFrontAxle,
      cgHeight: d.cgHeight,
      trackWidth: d.trackWidth,
    },
    axles: [
      {
        tire: tire(c.TIRE_FRONT, d.frontLoad),
        wheelInertia: d.wheelInertia.front,
        driven: false,
        steered: true,
        maxBrakeTorque: 2 * c.BRAKE_TORQUE_PER_WHEEL,
        staticCamberDeg: 0,
        suspension: suspension(
          d.springRate.front,
          c.SUSPENSION.front.damping,
          antiRoll.front,
          d.stops.front,
          2 * c.SUSPENSION.front.springRate,
          d.rollCentre.front,
        ),
      },
      {
        tire: tire(c.TIRE_REAR, d.rearLoad),
        wheelInertia: d.wheelInertia.rear,
        driven: true,
        steered: false,
        maxBrakeTorque: 2 * c.BRAKE_TORQUE_PER_WHEEL,
        staticCamberDeg: 0,
        suspension: suspension(
          d.springRate.rear,
          c.SUSPENSION.rear.damping,
          antiRoll.rear,
          d.stops.rear,
          2 * c.SUSPENSION.rear.springRate,
          d.rollCentre.rear,
        ),
      },
    ],
    steering: {
      maxWheelAngleDeg: MAX_WHEEL_ANGLE_DEG,
      ratio: 16,
      ackermann: 0,
      mechanicalTrail: 0,
      scrubRadius: 0,
      jackingRate: 0,
    },
    brakes: { handbrakeTorque: 0 },
    aero: {
      dragCoefficient: c.AERO.dragCoefficient,
      frontalArea: c.AERO.frontalArea,
      airDensity: c.AERO.airDensity,
      liftCoefficientFront: 0,
      liftCoefficientRear: 0,
      dragHeightAboveCg: 0,
    },
    simulation: { substepRateHz: 1000, model: "fourWheel" },
    drivetrain: {
      powerUnit: {
        kind: "combustion",
        idleRpm: IDLE_RPM,
        redlineRpm: c.ENGINE_MAX_RPM,
        // Chrono's simple-map engine has no inertia of its own.
        inertia: 0.02,
        torqueCurve: [...c.ENGINE_FULL_THROTTLE, [c.ENGINE_MAX_RPM, 240]],
        engineBrakingIdle: d.engineBraking.idle,
        engineBrakingRedline: d.engineBraking.redline,
        idleTorqueMax: 40,
      },
      transmission: {
        gears: c.GEARS,
        reverse: c.REVERSE,
        finalDrive: c.FINAL_DRIVE,
        mode: "automatic",
        // Chrono's simple-map gearbox shifts instantly and has no clutch.
        shiftTime: 0.02,
        shiftHold: 0.2,
        shiftUpAt: c.UPSHIFT_RPM / c.ENGINE_MAX_RPM,
        shiftDownAt: 1500 / c.ENGINE_MAX_RPM,
        clutchMaxTorque: 1500,
        clutchEngageTime: 0.1,
        clutchBiteRpm: 1000,
        inputInertia: 0.01,
        // Driveshaft, plus the differential box reflected through the final drive.
        outputInertia: c.DRIVESHAFT_INERTIA + c.DIFFERENTIAL_BOX_INERTIA / c.FINAL_DRIVE ** 2,
      },
      front: { kind: "open" },
      rear: { kind: "open" },
    },
  } as PartialVehicleDefinition;
}

let cached: ChronoStatic | null = null;
function loadStaticCached(): ChronoStatic {
  cached ??= loadStatic();
  return cached;
}

/** Structural differences between the two models, reported with the results. */
export const GAPS = [
  "Static toe: Chrono's linkage gives toe-in at rest (front and rear, see the derived values); Skidpad has no toe, so the harness steers with Chrono's mean front road-wheel angle.",
  "Roll and bump steer: Chrono's road-wheel angles change with suspension travel. Feeding the measured mean angle carries the front axle's net effect across; the rear's is not represented.",
  "Unsprung mass: Chrono's wheels, uprights and arms are separate bodies; Skidpad carries the whole mass on the chassis proxy.",
  "Roll centres: fixed at their static heights in Skidpad; Chrono's migrate with travel and roll.",
  "Anti-dive and anti-squat: Chrono's linkages react part of the brake and drive forces; Skidpad sends all longitudinal load transfer through the springs.",
  "Rebound stops: Chrono has a stop spring 2.4 cm (front) and 6.6 cm (rear) below static; Skidpad's droop limit lets the wheel hang instead.",
  "Damper: Chrono's front damper is degressive; Skidpad's is linear at the low-speed rate.",
  "Tire: TMsimple carried into a Magic Formula fit (`tire-fit.ts`); combined slip follows Skidpad's MF weighting, not TMsimple's; no relaxation in either.",
  "Tire radius: Chrono rolls on (2·R0 + r)/3 and pushes at the loaded radius r; Skidpad uses one radius for both.",
  "Drivetrain: Chrono's simple-map gearbox has no clutch and shifts instantly; its closed-throttle drag map is fitted with a line.",
];
