/**
 * Skidpad's model of Project Chrono's generic Sedan, built from Chrono's
 * published constants (`chrono-sedan.ts`), its tire file (`pac02.ts`) and
 * its measured static state and kinematics (`reference/sedan/`).
 *
 * Nothing is fitted to Chrono's behaviour. The E90 needs its anti-roll bars
 * identified from Chrono's roll gradient and load transfer; the Sedan has
 * none, so its roll stiffness, roll centres and load transfer are all
 * predictions. Its tire is fitted, but to Chrono's tire curves, not to the
 * car's behaviour.
 *
 * What Skidpad cannot represent, and how each is handled, is listed in
 * `SEDAN_GAPS` and reported with the results.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PartialVehicleDefinition, Skidpad } from "@skidpad/core";
import * as c from "./chrono-sedan.js";
import { fitError, fitPac02, fz0Prime, loadSedanTir, offsetToe } from "./pac02.js";
import { loadReference, referenceDir } from "./reference.js";
import { axleGeometry, heaveSamples, restSpringLength, type Axle } from "./sedan-kc.js";
import {
  atEquilibrium,
  equilibriumOffset,
  loadStatic,
  MAX_WHEEL_ANGLE_DEG,
  type ChronoStatic,
} from "./vehicle.js";

/** Tire relaxation length, m. Chrono's Pac02 is steady-state; as for the E90. */
const RELAXATION_LENGTH = 0.02;

/**
 * Travels the curves are sampled at, m (+ bump), per axle: inside Chrono's heave sweep once shifted
 * to the equilibrium ride height, which sits 24 mm into bump from the parked car at the front and
 * at it at the rear.
 */
const CURVE_TRAVELS: Record<Axle, number[]> = {
  front: [-0.06, -0.05, -0.04, -0.03, -0.02, -0.01, 0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06],
  rear: [-0.04, -0.03, -0.02, -0.01, 0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08],
};

const IDLE_RPM = 800;

export interface SedanDerived {
  frontLoad: number;
  rearLoad: number;
  cgHeight: number;
  wheelbase: number;
  cgToFrontAxle: number;
  trackWidth: number;
  axleTrack: { front: number; rear: number };
  loadedRadius: { front: number; rear: number };
  rollingRadius: number;
  /** Spring and damper motion ratios at rest (`sedan-kc.ts`). */
  motionRatio: {
    front: { spring: number; shock: number };
    rear: { spring: number; shock: number };
  };
  /** Spring rate at the wheel in series with the tire, N/m; damping at the wheel, N·s/m. */
  springRate: { front: number; rear: number };
  damping: { front: number; rear: number };
  /** Front spring stops, m of wheel travel from rest. The rear has none. */
  frontStops: { bump: number; droop: number };
  wheelInertia: { front: number; rear: number };
  rollCentre: { front: number; rear: number };
  /** Anti fractions at rest (ADR-0018): the front both brakes and drives, through the wheel centre. */
  anti: { front: number; rear: number };
  /** Toe-in per wheel at the equilibrium ride height, degrees (Chrono's linkage). */
  restToeDeg: { front: number; rear: number };
  /** Toe-in per wheel while driving straight, degrees (see `drivingToe`). */
  drivingToeDeg: { front: number; rear: number };
  /** The tire offsets' equivalent toe-in at each axle's static load, degrees (`offsetToe`). */
  offsetToeDeg: { front: number; rear: number };
  /** Travel curves as offsets from rest (ADR-0026). */
  curves: Record<
    Axle,
    { rollCenterHeight: [number, number][]; anti: [number, number][]; toeDeg: [number, number][] }
  >;
}

/** Chrono's toe-in per wheel while driving straight, the first 2 s of the step steer, as for the E90. */
function drivingToe(): { front: number; rear: number } {
  const rows = loadReference("stepSteer", "sedan").filter((r) => r.t < 2);
  const mean = (f: (r: (typeof rows)[number]) => number) =>
    rows.reduce((a, r) => a + f(r), 0) / rows.length;
  const half = (left?: number, right?: number) =>
    (((right ?? NaN) - (left ?? NaN)) / 2) * (180 / Math.PI);
  return {
    front: mean((r) => half(r.delta0, r.delta1)),
    rear: mean((r) => half(r.delta2, r.delta3)),
  };
}

export function deriveSedan(
  s: ChronoStatic = atEquilibrium(loadStatic("sedan"), "sedan"),
): SedanDerived {
  const [fl, fr, rl, rr] = s.loads;
  const frontLoad = 0.5 * (fl + fr);
  const rearLoad = 0.5 * (rl + rr);
  const [sf, , sr] = s.spindleLocal;
  const wheelbase =
    0.5 * (s.spindleLocal[0][0] + s.spindleLocal[1][0]) -
    0.5 * (s.spindleLocal[2][0] + s.spindleLocal[3][0]);
  const cgToFrontAxle = 0.5 * (s.spindleLocal[0][0] + s.spindleLocal[1][0]) - s.comLocal[0];
  const r0 = loadSedanTir().UNLOADED_RADIUS!;
  const loadedFront = r0 - frontLoad / c.TIRE_VERTICAL_STIFFNESS;
  const loadedRear = r0 - rearLoad / c.TIRE_VERTICAL_STIFFNESS;
  // The centre-of-mass height above the ground under it, as for the E90.
  const frac = cgToFrontAxle / wheelbase;
  const axleLineZ = sf[2] + frac * (sr[2] - sf[2]);
  const groundBelow = axleLineZ - (loadedFront + frac * (loadedRear - loadedFront));
  const cgHeight = s.comLocal[2] - groundBelow;

  const samples = heaveSamples();
  // The sweep's travel is measured from the parked car; the curves from the equilibrium.
  const offset = equilibriumOffset("sedan");
  const geo = (axle: Axle, t: number) =>
    axleGeometry(axle, t + offset[axle], axle === "front" ? loadedFront : loadedRear, samples);
  const front = geo("front", 0);
  const rear = geo("rear", 0);
  // Anti fraction from the wheel centre's path (ADR-0018, `sedan-kc.ts`).
  const anti = (axle: Axle, dxdz: number) =>
    ((axle === "front" ? dxdz : -dxdz) * wheelbase) / cgHeight;
  const round = (v: number, k: number) => Math.round(v * 10 ** k) / 10 ** k;
  const curve = (axle: Axle, f: (g: ReturnType<typeof geo>) => number, k: number) => {
    const at0 = f(geo(axle, 0));
    return CURVE_TRAVELS[axle].map((t): [number, number] => [
      t,
      t === 0 ? 0 : round(f(geo(axle, t)) - at0, k),
    ]);
  };
  const curves = (axle: Axle) => ({
    rollCenterHeight: curve(axle, (g) => g.rollCentre, 5),
    anti: curve(axle, (g) => anti(axle, g.dxdz), 4),
    toeDeg: curve(axle, (g) => g.toeDeg, 4),
  });

  // Skidpad's wheel is rigid, so the tire's vertical compliance goes in series with the spring.
  const series = (k: number) => (k * c.TIRE_VERTICAL_STIFFNESS) / (k + c.TIRE_VERTICAL_STIFFNESS);
  const tir = loadSedanTir();
  const restSpring = restSpringLength("front");
  const stop = c.SUSPENSION.front;
  return {
    frontLoad,
    rearLoad,
    cgHeight,
    wheelbase,
    cgToFrontAxle,
    trackWidth: sf[1] + sr[1],
    axleTrack: { front: 2 * sf[1], rear: 2 * sr[1] },
    loadedRadius: { front: loadedFront, rear: loadedRear },
    // Chrono's effective rolling radius `(2·R0 + r_loaded) / 3`.
    rollingRadius: (2 * r0 + loadedFront) / 3,
    motionRatio: {
      front: { spring: front.springRatio, shock: front.shockRatio },
      rear: { spring: rear.springRatio, shock: rear.shockRatio },
    },
    springRate: {
      front: series(c.SUSPENSION.front.springRate * front.springRatio ** 2),
      rear: series(c.SUSPENSION.rear.springRate * rear.springRatio ** 2),
    },
    damping: {
      front: c.SUSPENSION.front.damping * front.shockRatio ** 2,
      rear: c.SUSPENSION.rear.damping * rear.shockRatio ** 2,
    },
    frontStops: {
      // The spring shortens in bump: the bump stop is at free length − 0.04 m.
      bump: (restSpring - (stop.springRestLength - stop.stopSpringTravel)) / front.springRatio,
      droop: (stop.springRestLength + stop.stopSpringTravel - restSpring) / front.springRatio,
    },
    wheelInertia: {
      front: c.RIM_INERTIA + c.TIRE_INERTIA + c.SPINDLE_INERTIA.front + c.AXLE_SHAFT_INERTIA.front,
      rear: c.RIM_INERTIA + c.TIRE_INERTIA + c.SPINDLE_INERTIA.rear + c.AXLE_SHAFT_INERTIA.rear,
    },
    rollCentre: { front: front.rollCentre, rear: rear.rollCentre },
    anti: { front: anti("front", front.dxdz), rear: anti("rear", rear.dxdz) },
    // Toe-in at the equilibrium ride height, from the sweep, where the toe curves start.
    restToeDeg: { front: front.toeDeg, rear: rear.toeDeg },
    drivingToeDeg: drivingToe(),
    offsetToeDeg: { front: offsetToe(tir, frontLoad), rear: offsetToe(tir, rearLoad) },
    curves: { front: curves("front"), rear: curves("rear") },
  };
}

export interface SedanOptions {
  /** Carry the roll-centre and anti curves (ADR-0026), default true. */
  travelCurves?: boolean;
  /**
   * Also carry the toe curves from the kinematics sweep, default false.
   * As for the E90, the comparison car keeps its toe fixed at the
   * straight-running value (docs/validation/chrono-sedan.md).
   */
  toeCurve?: boolean;
}

/** Skidpad's `.tir` import of Chrono's file, with the overrides of `pac02.ts`. */
export function sedanTire(sp: Skidpad) {
  const text = readFileSync(join(referenceDir("sedan"), "Sedan_Pac02Tire.tir"), "utf8");
  const imported = sp.importTir(text);
  return { ...imported.params, ...fitPac02(loadSedanTir()) };
}

/** How closely the fitted tire follows Chrono's, over 0.5–1.75 times the nominal load. */
export function sedanTireFitError() {
  const tir = loadSedanTir();
  const fz0 = fz0Prime(tir);
  return fitError(
    tir,
    fitPac02(tir),
    [0.5, 0.75, 1, 1.25, 1.5, 1.75].map((k) => k * fz0),
  );
}

export function sedan(
  sp: Skidpad,
  d: SedanDerived = deriveSedan(),
  opts: SedanOptions = {},
): PartialVehicleDefinition {
  const curves = opts.travelCurves ?? true;
  const toeCurve = curves && (opts.toeCurve ?? false);
  const s = loadStatic("sedan");
  const tire = {
    ...sedanTire(sp),
    unloadedRadius: d.rollingRadius,
    relaxationLengthLong: RELAXATION_LENGTH,
    relaxationLengthLat: RELAXATION_LENGTH,
  };
  const toe = (axle: Axle) =>
    (toeCurve ? d.restToeDeg[axle] : d.drivingToeDeg[axle]) + d.offsetToeDeg[axle];
  const suspension = (axle: Axle) => {
    const front = axle === "front";
    const k = d.curves[axle];
    return {
      kind: "independent" as const,
      springRate: d.springRate[axle],
      bumpDamping: d.damping[axle],
      reboundDamping: d.damping[axle],
      // The rear spring has no stops in Chrono.
      travelBump: front ? d.frontStops.bump : 0.15,
      // Skidpad's droop limit lets the wheel hang free rather than meeting a
      // stop spring, so it is set beyond Chrono's rebound stop, as for the E90.
      travelDroop: 0.15,
      antiRollStiffness: 0,
      bumpStopStiffness: front
        ? 2 * c.SUSPENSION.front.springRate * d.motionRatio.front.spring ** 2
        : 2 * d.springRate.rear,
      rollCenterHeight: d.rollCentre[axle],
      antiBrake: d.anti[axle],
      antiDrive: d.anti[axle],
      ...(curves
        ? {
            kinematics: {
              ...(toeCurve ? { toeDeg: k.toeDeg } : {}),
              rollCenterHeight: k.rollCenterHeight,
              antiBrake: k.anti,
              antiDrive: k.anti,
            },
          }
        : {}),
    };
  };
  return {
    name: "Sedan (Project Chrono 9.0.1 reference)",
    chassis: {
      mass: s.mass,
      yawInertia: s.inertia[2][2],
      rollInertia: s.inertia[0][0],
      pitchInertia: s.inertia[1][1],
      wheelbase: d.wheelbase,
      cgToFrontAxle: d.cgToFrontAxle,
      cgHeight: d.cgHeight,
      trackWidth: d.trackWidth,
    },
    axles: [
      {
        tire,
        wheelInertia: d.wheelInertia.front,
        driven: true,
        steered: true,
        maxBrakeTorque: 2 * c.BRAKE_TORQUE_PER_WHEEL,
        // Chrono's Pac02 produces no force from camber (`pac02.ts`).
        staticCamberDeg: 0,
        staticToeDeg: toe("front"),
        trackWidth: d.axleTrack.front,
        suspension: suspension("front"),
      },
      {
        tire,
        wheelInertia: d.wheelInertia.rear,
        driven: false,
        steered: false,
        maxBrakeTorque: 2 * c.BRAKE_TORQUE_PER_WHEEL,
        staticCamberDeg: 0,
        staticToeDeg: toe("rear"),
        trackWidth: d.axleTrack.rear,
        suspension: suspension("rear"),
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
        torqueCurve: c.ENGINE_FULL_THROTTLE,
        engineBrakingCurve: [
          [100, 0],
          ...c.ENGINE_CLOSED_THROTTLE.map(([rpm, tq]): [number, number] => [rpm, -tq]),
        ],
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
        shiftLightFactor: 1,
        clutchMaxTorque: 1500,
        clutchEngageTime: 0.1,
        clutchBiteRpm: 1000,
        inputInertia: 0.01,
        outputInertia: c.DRIVESHAFT_INERTIA + c.DIFFERENTIAL_BOX_INERTIA / c.FINAL_DRIVE ** 2,
      },
      front: { kind: "open" },
      rear: { kind: "open" },
    },
  } as PartialVehicleDefinition;
}

/** Structural differences between the two models, reported with the results. */
export const SEDAN_GAPS = [
  "Tire: Chrono's Pac02 clamps B·κ and B·α below π/2, so its forces stay near their peaks past it; Skidpad's Magic Formula shape is fitted to those curves (`pac02.ts`), within 4 % of the peak.",
  "Tire combined slip: Chrono combines with a friction ellipse; Skidpad uses its Magic Formula weighting functions with their defaults (the file has no combined-slip coefficients).",
  "Tire offsets: Chrono mirrors the lateral offsets on the right tires, so they push inward as a pair; Skidpad carries them as an equivalent static toe at each axle's static load.",
  "Toe: fixed at Chrono's straight-running value. Chrono's toe follows travel through its steep front bump steer (about 4.5° over 10 cm), but with the toe curves (`--toe-curve`) Skidpad's toe-in forces jack the front further than Chrono's and the bump steer runs away (docs/validation/chrono-sedan.md, finding 6). The harness steers with Chrono's mean front road-wheel angle, which carries the front's net roll steer across.",
  "Ride height: the travel curves are read from Chrono's equilibrium (`chrono/equilibrium.py`), not the parked car, whose tires prop its front 24 mm high.",
  "Unsprung mass: Chrono's wheels, uprights and links are separate bodies; Skidpad carries the whole mass on the chassis proxy.",
  "Roll centres and pitch geometry: measured from Chrono's heave sweep as each wheel's travel curves (ADR-0026), from a level-body heave construction.",
  "Springs: Chrono's rear spring rate at the wheel rises in droop and falls in bump as its motion ratio moves (0.65 to 0.59 over 10 cm); Skidpad's is linear at the rest value.",
  "Rebound stops: Chrono's front has a stop spring a few centimetres below static; Skidpad's droop limit lets the wheel hang instead.",
  "Drivetrain: Chrono's simple-map gearbox has no clutch, shifts instantly and leaves first gear at 4000 rpm and the others at 4500 rpm; Skidpad shifts every gear at 4500 rpm.",
  "Tire radius: Chrono rolls on (2·R0 + r)/3 and pushes at the loaded radius r; Skidpad uses one radius for both.",
];
