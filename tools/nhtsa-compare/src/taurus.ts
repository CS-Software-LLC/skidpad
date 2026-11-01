/**
 * The 1994 Ford Taurus GL that NHTSA's Vehicle Research and Test Center
 * drove for the NADS validation (Chrstos and Grygier, SAE 970563): 3.8 l V6,
 * four-speed automatic, front-wheel drive, MacPherson struts front and rear,
 * speed-sensitive power rack and pinion, General Ameri-tech 205/65R15 tires
 * at 35 psi.
 *
 * An estimated build. Unlike the Jeep there is no measured inertia record
 * for this car that this comparison can use, and few published
 * specifications, so most values are class-typical for a 1990s mid-size
 * front-drive sedan and marked ESTIMATE with the reasoning. Only the
 * steering ratio is fitted (`taurusRun.ts`), on the J-turn's steady lateral
 * acceleration; the frequency response is then a prediction.
 *
 * Sources:
 *   [paper] SAE 970563: the vehicle, engine, transmission, steering type,
 *           tires and inflation. Its mass varied over the programme by
 *           "more than 70 kilograms, which is approximately 4 percent of the
 *           total mass", so the instrumented car with its driver was about
 *           1750 kg.
 *   [wiki]  Wikipedia, Ford Taurus (second generation): wheelbase 106.0 in
 *           (2.692 m), the 3.8 l Essex V6 and the AXOD-E four-speed.
 */
import type { PartialVehicleDefinition } from "@skidpad/core";

export const WHEELBASE = 2.692; // [wiki] 106.0 in
/** ESTIMATE: a ratio near 16 is typical of the class; the fit replaces it. */
export const STEERING_RATIO = 16;
/** ESTIMATE: road-wheel lock of a mid-size front-drive sedan. */
export const MAX_WHEEL_ANGLE_DEG = 35;
export const TRACK_FRONT = 1.56; // ESTIMATE
export const TRACK_REAR = 1.53; // ESTIMATE

export interface TaurusTunable {
  /** Hand-wheel degrees per road-wheel degree as driven, compliance included. */
  steeringRatio: number;
}

export const TAURUS_ESTIMATED: TaurusTunable = { steeringRatio: STEERING_RATIO };

/** Hand-wheel angle (deg, + right) to Skidpad's steer input (fraction of lock, + right). */
export function taurusSteerInput(handwheelDeg: number, t: TaurusTunable): number {
  return handwheelDeg / t.steeringRatio / MAX_WHEEL_ANGLE_DEG;
}

// ESTIMATE: about 62 % of the weight on the front axle, as a V6 front-drive
// sedan of the period carries with a driver and the data system aboard.
const MASS = 1750; // [paper]
const FRONT_SHARE = 0.62;
const CG_TO_FRONT = (1 - FRONT_SHARE) * WHEELBASE;

export function fordTaurus(t: TaurusTunable = TAURUS_ESTIMATED): PartialVehicleDefinition {
  // ESTIMATE: a 1990s all-season passenger tire. 205/65R15 is a 190.5 mm
  // rim radius plus a 133.3 mm sidewall (0.324 m). Force and moment data
  // for the test tires exist (the paper's reference 6, a thesis) but are
  // not public, so the feel parameters are the class's.
  const tire = {
    model: "feel" as const,
    radius: 0.324,
    nominalLoad: 4500,
    peakFriction: 0.85,
    longitudinalFrictionRatio: 1.1,
    loadSensitivity: 0.12,
    peakSlipAngleDeg: 7.5,
    corneringStiffness: 15,
    longitudinalStiffness: 18,
    stiffnessPeakLoad: 5500,
    relaxationLengthLat: 0.45,
    lateralRelaxationFollowsLoad: true,
    rollingResistance: 0.011,
    verticalStiffness: 200000,
    verticalDamping: 500,
  };
  return {
    formatVersion: 1,
    name: "1994 Ford Taurus GL (NHTSA VRTC test vehicle, estimated build)",
    chassis: {
      mass: MASS,
      // ESTIMATE: yaw inertia m·a·b, which the Jeep's measured value matches
      // within 1 %; pitch close to it, roll for a sedan body of this size.
      yawInertia: Math.round(MASS * CG_TO_FRONT * (WHEELBASE - CG_TO_FRONT)),
      pitchInertia: 2900,
      rollInertia: 580,
      wheelbase: WHEELBASE,
      cgToFrontAxle: CG_TO_FRONT,
      // ESTIMATE: a mid-size sedan's 0.53 to 0.57 m.
      cgHeight: 0.55,
      trackWidth: TRACK_FRONT,
    },
    axles: [
      {
        tire,
        wheelInertia: 1.6, // ESTIMATE: 15 in steel wheel and tire
        driven: true,
        steered: true,
        maxBrakeTorque: 3000, // ESTIMATE; braking is not compared
        staticCamberDeg: -0.5,
        staticToeDeg: 0,
        trackWidth: TRACK_FRONT,
        suspension: {
          kind: "independent",
          // ESTIMATE: about 1.2 Hz on a 500 kg corner, a soft period ride.
          springRate: 28000,
          // ESTIMATE: about 0.3 of critical.
          bumpDamping: 1800,
          reboundDamping: 2800,
          travelBump: 0.09,
          travelDroop: 0.11,
          antiRollStiffness: 18000, // ESTIMATE
          bumpStopStiffness: 300000,
          // ESTIMATE: a MacPherson front (Milliken & Milliken, ch. 17).
          rollCenterHeight: 0.08,
          antiBrake: 0,
          antiDrive: 0,
          unsprungMass: 40, // ESTIMATE
        },
      },
      {
        tire,
        wheelInertia: 1.3, // ESTIMATE
        driven: false,
        steered: false,
        maxBrakeTorque: 1300, // ESTIMATE
        staticCamberDeg: -0.5,
        staticToeDeg: 0,
        trackWidth: TRACK_REAR,
        suspension: {
          kind: "independent",
          // ESTIMATE: about 1.35 Hz on a 300 kg corner.
          springRate: 21000,
          bumpDamping: 1300,
          reboundDamping: 2000,
          travelBump: 0.1,
          travelDroop: 0.12,
          antiRollStiffness: 4000, // ESTIMATE
          bumpStopStiffness: 300000,
          // ESTIMATE: rear struts with lateral links.
          rollCenterHeight: 0.12,
          antiBrake: 0,
          antiDrive: 0,
          unsprungMass: 35, // ESTIMATE
        },
      },
    ],
    steering: {
      maxWheelAngleDeg: MAX_WHEEL_ANGLE_DEG,
      ratio: t.steeringRatio,
      ackermann: 1.0,
      // ESTIMATE: a front-drive MacPherson front's few degrees of caster.
      mechanicalTrail: 0.02,
      scrubRadius: 0.01,
      steeringArm: 0.13,
      powerAssist: 0.7,
      columnFriction: 0.3,
      columnDamping: 0.05,
      jackingRate: 0,
    },
    brakes: { handbrakeTorque: 1200 },
    // ESTIMATE: the second-generation Taurus's drag was about 0.32.
    aero: {
      dragCoefficient: 0.32,
      frontalArea: 2.1,
      airDensity: 1.225,
      liftCoefficientFront: 0.08,
      liftCoefficientRear: 0.05,
      dragHeightAboveCg: 0.1,
    },
    simulation: { substepRateHz: 1000, model: "fourWheel" },
    drivetrain: {
      powerUnit: {
        kind: "combustion",
        idleRpm: 700,
        redlineRpm: 5000,
        inertia: 0.2,
        // ESTIMATE: a 3.8 l pushrod V6 of about 104 kW and 290 N·m.
        torqueCurve: [
          [1000, 230],
          [2000, 285],
          [2500, 290],
          [3500, 275],
          [4000, 255],
          [5000, 200],
        ],
        engineBrakingIdle: 20,
        engineBrakingRedline: 70,
        idleTorqueMax: 80,
      },
      transmission: {
        // ESTIMATE: AXOD-E ratios and a 3.37 final drive as commonly listed.
        gears: [2.77, 1.54, 1.0, 0.69],
        reverse: 2.26,
        finalDrive: 3.37,
        mode: "automatic",
        shiftTime: 0.4,
        shiftHold: 0.8,
        shiftUpAt: 0.85,
        shiftDownAt: 0.4,
        shiftLightFactor: 0.55,
        clutchMaxTorque: 700,
        clutchEngageTime: 0.3,
        clutchBiteRpm: 1000,
        inputInertia: 0.06,
        outputInertia: 0.06,
      },
      front: { kind: "open" },
      rear: { kind: "open" },
      center: { kind: "open", frontTorqueFraction: 0.5 }, // unused: only the front is driven
    },
  };
}
