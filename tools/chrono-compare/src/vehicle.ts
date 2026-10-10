/**
 * Skidpad's model of Project Chrono's BMW_E90, built from Chrono's published
 * constants (`chrono-e90.ts`) and its measured static state
 * (`reference/bmw_e90/static.json`). Every value is taken or derived from Chrono
 * except the anti-roll bar rates, which are FITTED (see `fit.ts`): Chrono's
 * bars act through linkages Skidpad does not model, so their wheel rates
 * are identified from Chrono's roll gradient and front share of lateral
 * load transfer.
 *
 * What Skidpad cannot represent, and how each is handled, is listed in
 * `GAPS` and reported with the results.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PartialVehicleDefinition } from "@skidpad/core";
import * as c from "./chrono-e90.js";
import { doubleWishboneRollCentre, macphersonRollCentre } from "./geometry.js";
import { travelCurves, type TravelCurves } from "./kinematics.js";
import { loadEquilibrium, loadReference, referenceDir, type CarName } from "./reference.js";
import { fitMagicFormula } from "./tire-fit.js";

export { ROOT } from "./reference.js";

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

export function loadStatic(car: CarName = "bmw_e90"): ChronoStatic {
  return JSON.parse(readFileSync(join(referenceDir(car), "static.json"), "utf8")) as ChronoStatic;
}

/**
 * The static state with each spindle at Chrono's equilibrium ride height
 * (`chrono/equilibrium.py`) instead of where the parked car's tires propped
 * it. Skidpad's travel is measured from its own equilibrium, so the travel
 * curves and the centre-of-mass height are taken there.
 */
export function atEquilibrium(s: ChronoStatic, car: CarName): ChronoStatic {
  const { travel } = loadEquilibrium(car);
  return {
    ...s,
    spindleLocal: s.spindleLocal.map(([x, y, z], i): Vec3 => [
      x,
      y,
      z + travel[i]!,
    ]) as ChronoStatic["spindleLocal"],
  };
}

/** Each axle's equilibrium ride height from the parked one, m (+ bump; mean of its wheels). */
export function equilibriumOffset(car: CarName): { front: number; rear: number } {
  const { travel } = loadEquilibrium(car);
  return { front: 0.5 * (travel[0] + travel[1]), rear: 0.5 * (travel[2] + travel[3]) };
}

/** The metrics the anti-roll bars are fitted to (`fit.ts`), so not predictions. */
export const E90_FITTED: ReadonlySet<string> = new Set([
  "rampSteer: roll gradient",
  "rampSteer: front share of lateral load transfer",
]);

/** Anti-roll bar wheel rates, N/m: FITTED by `fit.ts` (`pnpm compare --fit`). */
export const FITTED_ANTI_ROLL = { front: 14750, rear: 8250 };
/** The same fit for the car without travel curves (`--fixed-geometry`), before ADR-0026. */
export const FITTED_ANTI_ROLL_FIXED_GEOMETRY = { front: 12750, rear: 6000 };

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
  /** Track width of each axle between the spindles, m. */
  axleTrack: { front: number; rear: number };
  /**
   * Anti-pitch fractions from the side-view instant centres (ADR-0018).
   * Chrono reacts its brake torque on the chassis and drives the rear
   * through half-shafts, so both use the line from the wheel centre.
   */
  anti: { frontBrake: number; rearBrake: number; rearDrive: number };
  /** Toe-in per wheel at rest, degrees. */
  restToeDeg: { front: number; rear: number };
  /**
   * Toe-in per wheel while driving straight before the steering starts,
   * degrees: what the comparison car is given (see `drivingToe`).
   */
  staticToeDeg: { front: number; rear: number };
  /**
   * Travel curves of each axle (ADR-0026): toe and camber from Chrono's
   * heave sweep, roll-centre height and anti fraction from the hardpoints,
   * as offsets from Chrono's rest position.
   */
  curves: { front: TravelCurves; rear: TravelCurves };
}

/** Travels the curves are sampled at, m (+ bump): inside Chrono's heave sweep on both axles. */
const CURVE_TRAVELS = [
  -0.04, -0.03, -0.02, -0.01, 0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08,
];

const IDLE_RPM = 800;

/**
 * Chrono's closed-throttle map as drag (`ENGINE_CLOSED_THROTTLE` negated),
 * for `engineBrakingCurve` (ADR-0011 amendment). Below its first point the
 * map falls to zero at about 100 rpm; Skidpad's idle governor holds the
 * engine above idle there anyway.
 */
function engineBrakingCurve(): [number, number][] {
  return [[100, 0], ...c.ENGINE_CLOSED_THROTTLE.map(([rpm, tq]): [number, number] => [rpm, -tq])];
}

/**
 * Chrono's toe-in per wheel while driving straight, degrees: the mean
 * half-difference of the left and right road-wheel angles over the first
 * 2 s of the step steer, at 80 km/h before the steering moves. Chrono's
 * linkage runs more toe-in at speed than at rest (1.43° against 1.27° at
 * the front) and less as the body rolls (about 0.9° at 0.8 g). Skidpad's
 * toe is fixed, so it takes the straight-running value the transient
 * manoeuvres start from; every manoeuvre's straight section agrees with it
 * within 0.03°.
 */
function drivingToe(): { front: number; rear: number } {
  const rows = loadReference("stepSteer").filter((r) => r.t < 2);
  const mean = (f: (r: (typeof rows)[number]) => number) =>
    rows.reduce((a, r) => a + f(r), 0) / rows.length;
  const half = (left?: number, right?: number) =>
    (((right ?? NaN) - (left ?? NaN)) / 2) * (180 / Math.PI);
  return {
    front: mean((r) => half(r.delta0, r.delta1)),
    rear: mean((r) => half(r.delta2, r.delta3)),
  };
}

export function derive(s: ChronoStatic = atEquilibrium(loadStatic(), "bmw_e90")): Derived {
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
    axleTrack: { front: 2 * sf[1], rear: 2 * sr[1] },
    anti: {
      // Front: anti-dive needs the instant centre behind and above.
      frontBrake: (front.sideView[1] / -front.sideView[0]) * (wheelbase / cgHeight),
      // Rear: anti-lift and anti-squat need it ahead and above.
      rearBrake: (rear.sideView[1] / rear.sideView[0]) * (wheelbase / cgHeight),
      rearDrive: (rear.sideView[1] / rear.sideView[0]) * (wheelbase / cgHeight),
    },
    restToeDeg: {
      front: (((s.toe[1] - s.toe[0]) / 2) * 180) / Math.PI,
      rear: (((s.toe[3] - s.toe[2]) / 2) * 180) / Math.PI,
    },
    staticToeDeg: drivingToe(),
    curves: {
      front: travelCurves(
        "front",
        sf[2],
        CURVE_TRAVELS,
        loadedFront,
        wheelbase,
        cgHeight,
        equilibriumOffset("bmw_e90").front,
      ),
      rear: travelCurves(
        "rear",
        sr[2],
        CURVE_TRAVELS,
        loadedRear,
        wheelbase,
        cgHeight,
        equilibriumOffset("bmw_e90").rear,
      ),
    },
  };
}

/** Largest road-wheel angle, degrees; the harness steers in fractions of it. */
export const MAX_WHEEL_ANGLE_DEG = 45;

export interface BuildOptions {
  /**
   * Carry the travel curves for camber, roll-centre height and the anti
   * fractions (ADR-0026), default true. Without them the geometry is fixed
   * at ride height and the camber at zero, as before ADR-0026.
   */
  travelCurves?: boolean;
  /**
   * Also carry the toe curves, default false. Chrono's driving wheel angles
   * do not follow its own toe-against-travel kinematics (its toe moves with
   * lateral force instead; docs/validation/chrono-bmw-e90.md), so the
   * comparison car keeps its toe fixed at the straight-running value. With
   * this set the toe is Chrono's at rest and the curve moves it.
   */
  toeCurve?: boolean;
}

export function bmwE90(
  antiRoll: { front: number; rear: number } = FITTED_ANTI_ROLL,
  d: Derived = derive(),
  opts: BuildOptions = {},
): PartialVehicleDefinition {
  const curves = opts.travelCurves ?? true;
  const toeCurve = curves && (opts.toeCurve ?? false);
  const { front: cf, rear: cr } = d.curves;
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
    antiBrake: number,
    antiDrive: number,
    kinematics?: Record<string, [number, number][]>,
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
    antiBrake,
    antiDrive,
    ...(kinematics ? { kinematics } : {}),
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
        staticCamberDeg: curves ? cf.atRest.camberDeg : 0,
        staticToeDeg: toeCurve ? cf.atRest.toeDeg : d.staticToeDeg.front,
        trackWidth: d.axleTrack.front,
        suspension: suspension(
          d.springRate.front,
          c.SUSPENSION.front.damping,
          antiRoll.front,
          d.stops.front,
          2 * c.SUSPENSION.front.springRate,
          d.rollCentre.front,
          d.anti.frontBrake,
          0,
          curves
            ? {
                ...(toeCurve ? { toeDeg: cf.toeDeg } : {}),
                camberDeg: cf.camberDeg,
                rollCenterHeight: cf.rollCenterHeight,
                antiBrake: cf.anti,
              }
            : undefined,
        ),
      },
      {
        tire: tire(c.TIRE_REAR, d.rearLoad),
        wheelInertia: d.wheelInertia.rear,
        driven: true,
        steered: false,
        maxBrakeTorque: 2 * c.BRAKE_TORQUE_PER_WHEEL,
        staticCamberDeg: curves ? cr.atRest.camberDeg : 0,
        staticToeDeg: toeCurve ? cr.atRest.toeDeg : d.staticToeDeg.rear,
        trackWidth: d.axleTrack.rear,
        suspension: suspension(
          d.springRate.rear,
          c.SUSPENSION.rear.damping,
          antiRoll.rear,
          d.stops.rear,
          2 * c.SUSPENSION.rear.springRate,
          d.rollCentre.rear,
          d.anti.rearBrake,
          d.anti.rearDrive,
          curves
            ? {
                ...(toeCurve ? { toeDeg: cr.toeDeg } : {}),
                camberDeg: cr.camberDeg,
                rollCenterHeight: cr.rollCenterHeight,
                antiBrake: cr.anti,
                antiDrive: cr.anti,
              }
            : undefined,
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
        engineBrakingCurve: engineBrakingCurve(),
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
        // Chrono's simple-map gearbox shifts at the same speeds whatever the throttle.
        shiftLightFactor: 1,
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
  "Toe: fixed at Chrono's straight-running value (1.43° front, 0.67° rear). Chrono's toe follows travel through its bump steer (docs/validation/chrono-sedan.md, finding 3), but with the toe curves Skidpad's toe-in forces jack the front further than Chrono's and the bump steer runs away (finding 6). The harness steers with Chrono's mean front road-wheel angle, which carries the front's net roll steer across.",
  "Unsprung mass: Chrono's wheels, uprights and arms are separate bodies; Skidpad carries the whole mass on the chassis proxy.",
  "Roll centres and pitch geometry: travel curves derived from the hardpoints (ADR-0026), so each wheel's roll centre migrates and its links jack the body. Chrono's linkages do the same in full; Skidpad's curves are per wheel, from a level-body heave construction.",
  "Rebound stops: Chrono has a stop spring 2.4 cm (front) and 6.6 cm (rear) below static; Skidpad's droop limit lets the wheel hang instead.",
  "Damper: Chrono's front damper is degressive; Skidpad's is linear at the low-speed rate.",
  "Tire: TMsimple carried into a Magic Formula fit (`tire-fit.ts`); combined slip follows Skidpad's MF weighting, not TMsimple's; no relaxation in either.",
  "Tire radius: Chrono rolls on (2·R0 + r)/3 and pushes at the loaded radius r; Skidpad uses one radius for both.",
  "Drivetrain: Chrono's simple-map gearbox has no clutch and shifts instantly; its closed-throttle map is carried over as Skidpad's engineBrakingCurve.",
];
