/**
 * The 1997 Jeep Cherokee Sport (XJ) that NHTSA's Vehicle Research and Test
 * Center drove for the NADS validation (SAE 2000-01-0700): 4.0 l I6,
 * four-speed automatic, solid axles front and rear, Goodyear Wrangler RT/S
 * P225/75R15 at 33 psi.
 *
 * Built from published specifications where they exist and class-typical
 * values where they do not. The measured parameter set is in SAE
 * 1999-01-0121, which this comparison does not have; every value below that
 * paper would replace is marked ESTIMATE, with the reasoning. Nothing here is
 * fitted to the measured behaviour: the fitted build (`fit.ts`) changes three
 * named values on top of this one and says so.
 *
 * Sources:
 *   [cars]   cars.com, 1997 Jeep Cherokee Sport specifications: wheelbase
 *            101 in, track 58.0 in front and rear, overall steering ratio
 *            14, 3 turns lock to lock, 36 ft turning circle.
 *   [a123]   auto123.com, 1997 Jeep Cherokee Sport 4x4 4-dr: curb mass 1519 kg.
 *   [catalog] automobile-catalog.com, 1997 Cherokee Sport 4x4 4.0L: 190 hp
 *            (142 kW).
 *   [wiki]   Wikipedia, Jeep Cherokee (XJ) and Aisin AW4: the 1996-on 4.0 l
 *            rated 190 hp at 4600 rpm and 225 lb·ft at 3000 rpm; AW4 ratios
 *            2.804 / 1.531 / 1.000 / 0.753, reverse 2.393.
 *   [forum]  naxja.org owners' threads and OEM-replacement spring listings:
 *            front coils near 180 lb/in, rear leaf packs 107–135 lb/in per
 *            side; 3.55 axles with the AW4. Not authoritative.
 *   [paper]  SAE 2000-01-0700: the vehicle, engine, transmission, tires and
 *            inflation.
 */
import type { PartialVehicleDefinition } from "@skidpad/core";

const IN = 0.0254;
const LBF_PER_IN = 175.127; // N/m

export const TRACK = 58.0 * IN; // [cars] 1.473 m
export const WHEELBASE = 101.4 * IN; // [cars] 101 in; 101.4 in is the factory figure, 2.576 m
export const STEERING_RATIO = 14; // [cars] overall ratio
/** Road-wheel lock: 1.5 turns of the hand wheel either way over the ratio. */
export const MAX_WHEEL_ANGLE_DEG = (1.5 * 360) / STEERING_RATIO; // [cars] 38.6°

/**
 * A solid axle's springs sit inboard of the wheels, under the frame rails;
 * Skidpad puts each corner's spring at the wheel (ADR-0016). In roll, a
 * spring at half-spacing s/2 resists as one at the wheel of rate k·(s/t)²,
 * so the springs are carried over at that rate: roll is what this comparison
 * measures. In heave they act at their full rate, so the model's ride is
 * softer than the car's, which the lateral manoeuvres here do not see.
 * ESTIMATE: spacings from the XJ's frame-rail spacing, about 0.95 m at the
 * front coils and 1.05 m at the rear leaf eyes.
 */
const FRONT_SPRING_SPACING = 0.95;
const REAR_SPRING_SPACING = 1.05;
const FRONT_COIL = 180 * LBF_PER_IN; // [forum] 31.5 kN/m
const REAR_LEAF = 120 * LBF_PER_IN; // [forum] mid-range of 107–135 lb/in, 21.0 kN/m
export const FRONT_SPRING_AT_WHEEL = FRONT_COIL * (FRONT_SPRING_SPACING / TRACK) ** 2;
export const REAR_SPRING_AT_WHEEL = REAR_LEAF * (REAR_SPRING_SPACING / TRACK) ** 2;

/** The values a fit may change, at their estimated settings. */
export interface Tunable {
  /** Front anti-roll bar at the wheel, N/m. ESTIMATE: the pickup preset's front bar. */
  frontAntiRoll: number;
  /**
   * Hand-wheel degrees per road-wheel degree as the car is driven: the
   * published 14 plus the steering's compliance, which Skidpad's kinematic
   * steering does not have.
   */
  steeringRatio: number;
  /** Tire peak friction at the nominal load. ESTIMATE: the pickup preset's all-terrain tire. */
  peakFriction: number;
}

export const ESTIMATED: Tunable = {
  frontAntiRoll: 20000,
  steeringRatio: STEERING_RATIO,
  peakFriction: 0.85,
};

/** Hand-wheel angle to Skidpad's steer input (fraction of road-wheel lock, + right). */
export function steerInput(handwheelDeg: number, t: Tunable): number {
  return handwheelDeg / t.steeringRatio / MAX_WHEEL_ANGLE_DEG;
}

export function jeepCherokee(t: Tunable = ESTIMATED): PartialVehicleDefinition {
  // The light-truck all-terrain tire of the pickup preset, unchanged but for
  // its size (P225/75R15: a 190.5 mm rim radius plus a 168.8 mm sidewall,
  // 0.359 m) and, in a fit, its peak friction. ESTIMATE: no force
  // and moment data for the Wrangler RT/S is public.
  const tire = {
    model: "feel" as const,
    radius: 0.359,
    nominalLoad: 6500,
    peakFriction: t.peakFriction,
    loadSensitivity: 0.1,
    peakSlipAngleDeg: 8.0,
    peakSlipRatio: 0.13,
    corneringStiffness: 15,
    longitudinalStiffness: 18,
    stiffnessPeakLoad: 8000,
    relaxationLengthLat: 0.45,
    relaxationLengthLong: 0.3,
    rollingResistance: 0.013,
  };
  return {
    formatVersion: 1,
    name: "1997 Jeep Cherokee Sport (NHTSA VRTC test vehicle, estimated build)",
    chassis: {
      // ESTIMATE: [a123] curb mass 1519 kg plus driver and instrumentation
      // (steering stop, brake ram, data system), about 180 kg.
      mass: 1700,
      // ESTIMATE: radii of gyration typical of a compact SUV of this size
      // (yaw 1.26 m, pitch 1.24 m, roll 0.59 m about the centre of mass);
      // NHTSA measured this car's (SAE 1999-01-1336) but the listing is not
      // reachable from here.
      yawInertia: 2700,
      pitchInertia: 2600,
      rollInertia: 600,
      wheelbase: WHEELBASE,
      // ESTIMATE: 55 % on the front axle, typical of the 4.0 l XJ.
      cgToFrontAxle: 0.45 * WHEELBASE,
      // ESTIMATE: 0.69 m, a static stability factor near 1.07, typical of
      // the XJ 4x4 four-door.
      cgHeight: 0.69,
      trackWidth: TRACK,
    },
    axles: [
      {
        tire,
        wheelInertia: 1.8, // ESTIMATE: 15 in steel wheel and tire
        // The test is on a part-time 4x4 or a 2WD car; either drives the rear on pavement.
        driven: false,
        steered: true,
        maxBrakeTorque: 3600, // ESTIMATE; braking is not compared yet
        staticCamberDeg: 0,
        staticToeDeg: 0,
        trackWidth: TRACK,
        suspension: {
          kind: "solid",
          springRate: FRONT_SPRING_AT_WHEEL,
          // ESTIMATE: about 0.25 of critical on the roll-equivalent corner.
          bumpDamping: 1500,
          reboundDamping: 2500,
          travelBump: 0.09,
          travelDroop: 0.11,
          antiRollStiffness: t.frontAntiRoll,
          bumpStopStiffness: 300000,
          // ESTIMATE: the track bar's height at the axle, about the hub height.
          rollCenterHeight: 0.4,
          antiBrake: 0,
          antiDrive: 0,
        },
      },
      {
        tire,
        wheelInertia: 2.0, // ESTIMATE: wheel, tire and half-shaft
        driven: true,
        steered: false,
        maxBrakeTorque: 1800, // ESTIMATE; braking is not compared yet
        staticCamberDeg: 0,
        staticToeDeg: 0,
        trackWidth: TRACK,
        suspension: {
          kind: "solid",
          springRate: REAR_SPRING_AT_WHEEL,
          bumpDamping: 1300,
          reboundDamping: 2100,
          travelBump: 0.1,
          travelDroop: 0.12,
          // ESTIMATE: the Sport had no rear bar.
          antiRollStiffness: 0,
          bumpStopStiffness: 300000,
          // ESTIMATE: leaf springs under the axle, roll centre near the
          // spring seats (Milliken & Milliken, ch. 17; the pickup preset's 0.4 m).
          rollCenterHeight: 0.4,
          antiBrake: 0,
          antiDrive: 0,
        },
      },
    ],
    steering: {
      maxWheelAngleDeg: MAX_WHEEL_ANGLE_DEG,
      ratio: t.steeringRatio,
      ackermann: 1.0,
      // ESTIMATE: about 7° of caster on the solid front axle.
      mechanicalTrail: 0.035,
      scrubRadius: 0.03,
      steeringArm: 0.15,
      powerAssist: 0.75,
      columnFriction: 0.4,
      columnDamping: 0.06,
      jackingRate: 0,
    },
    brakes: { handbrakeTorque: 1500 },
    // ESTIMATE: a tall, square body (Hucho, ch. 4); immaterial at these speeds.
    aero: {
      dragCoefficient: 0.52,
      frontalArea: 2.5,
      airDensity: 1.225,
      liftCoefficientFront: 0.1,
      liftCoefficientRear: 0.1,
      dragHeightAboveCg: 0.1,
    },
    simulation: { substepRateHz: 1000, model: "fourWheel" },
    drivetrain: {
      powerUnit: {
        kind: "combustion",
        idleRpm: 700,
        redlineRpm: 5300,
        inertia: 0.25,
        // [wiki] 305 N·m (225 lb·ft) at 3000 rpm, 142 kW at 4600 rpm (295 N·m);
        // the rest of the curve's shape is an ESTIMATE.
        torqueCurve: [
          [1000, 245],
          [2000, 285],
          [3000, 305],
          [4000, 300],
          [4600, 295],
          [5300, 255],
        ],
        engineBrakingIdle: 25,
        engineBrakingRedline: 90,
        idleTorqueMax: 100,
      },
      transmission: {
        gears: [2.804, 1.531, 1.0, 0.753], // [wiki] AW4
        reverse: 2.393,
        finalDrive: 3.55, // [forum] standard with the AW4
        mode: "automatic",
        shiftTime: 0.4,
        shiftHold: 0.8,
        shiftUpAt: 0.85,
        shiftDownAt: 0.4,
        shiftLightFactor: 0.55,
        clutchMaxTorque: 900,
        clutchEngageTime: 0.3,
        clutchBiteRpm: 1000,
        inputInertia: 0.08,
        outputInertia: 0.1,
      },
      front: { kind: "open" },
      rear: { kind: "open" },
      center: { kind: "open", frontTorqueFraction: 0.4 }, // unused: only the rear is driven
    },
  };
}
