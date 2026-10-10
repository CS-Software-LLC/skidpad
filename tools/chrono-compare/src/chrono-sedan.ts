/**
 * Constants of Project Chrono's generic Sedan model, version 9.0.1, as
 * published in its source (BSD-3-Clause) under
 * `src/chrono_models/vehicle/sedan/`. Numbers only: the Skidpad model built
 * from them is in `sedan.ts`. Frames follow Chrono: x forward, y left,
 * z up, metres.
 *
 * Measured quantities (static loads, ride height, inertia about the centre
 * of mass, the suspension's travel kinematics) come from
 * `reference/sedan/static.json` and `reference/sedan/kc.csv`, written by
 * `chrono/sedan.py` and `chrono/kc.py sedan`. The tire is the PAC2002 file
 * `Sedan_Pac02Tire.tir`, copied into `reference/sedan/` (`pac02.ts`).
 */

/**
 * Springs and dampers, quoted at the element: unlike the E90's, Chrono's
 * Sedan places them between the chassis and a link, so their rates at the
 * wheel follow from the motion ratios the kinematics sweep measures
 * (`sedan-kc.ts`).
 */
export const SUSPENSION = {
  front: {
    /** `Sedan_DoubleWishbone.cpp`: spring between the chassis and the lower arm, N/m. */
    springRate: 73574.10163,
    /** Linear damper on the same points, N·s/m. */
    damping: 15054.53731,
    /** Free length and preload, m and N: the spring carries the preload at its free length. */
    springRestLength: 0.511468474,
    /** Spring stops at ±0.04 m of length from the free length, at twice the spring rate. */
    stopSpringTravel: 0.04,
  },
  rear: {
    /** `Sedan_MultiLink.cpp`: spring between the chassis and the trailing link, N/m, no stops. */
    springRate: 167062,
    /** Linear damper (`m_dampingCoefficient`), N·s/m, on its own points on the trailing link. */
    damping: 15000,
  },
};

/** `Sedan_Wheel.cpp`: rim spin inertia, kg·m². */
export const RIM_INERTIA = 0.42;
/** `Sedan_Pac02Tire.cpp`: tire spin inertia, kg·m². */
export const TIRE_INERTIA = 0.679;
/** Spindle spin inertia (`Sedan_DoubleWishbone.cpp`, `Sedan_MultiLink.cpp`), kg·m². */
export const SPINDLE_INERTIA = { front: 0.000496, rear: 0.000496 };
/** Axle shaft inertia per side (`m_axleInertia`), kg·m². */
export const AXLE_SHAFT_INERTIA = { front: 0.4, rear: 0.166 };
/** `Sedan_Pac02Tire.tir`: linear vertical stiffness (`VERTICAL_STIFFNESS`), N/m. */
export const TIRE_VERTICAL_STIFFNESS = 280835.2941;

/** `Sedan_BrakeShafts.cpp`: maximum torque per wheel at full pedal, N·m. */
export const BRAKE_TORQUE_PER_WHEEL = 2000;

/** `Sedan_EngineSimpleMap.cpp`: full-throttle torque, [rpm, N·m]. */
export const ENGINE_FULL_THROTTLE: [number, number][] = [
  [0, 0.6 * 174.4],
  [1000, 236.8],
  [1200, 296.0],
  [1400, 338.3],
  [1500, 355.2],
  [1600, 370.0],
  [4500, 370.0],
  [4600, 369.3],
  [4800, 364.0],
  [5000, 353.3],
  [5200, 339.7],
  [5500, 321.2],
  [5700, 309.9],
  [6000, 294.4],
  [6200, 280.4],
  [6500, 244.6],
];
/** `Sedan_EngineSimpleMap.cpp`: closed-throttle torque, [rpm, N·m] (negative is drag). */
export const ENGINE_CLOSED_THROTTLE: [number, number][] = [
  [1000, -10],
  [1500, -10],
  [2000, -15],
  [2500, -15],
  [3000, -15],
  [3500, -20],
  [4000, -20],
  [4500, -30],
  [5000, -50],
  [6000, -70],
  [6500, -100],
];
/** Fuel cut-off (`GetMaxEngineSpeed`), rpm. */
export const ENGINE_MAX_RPM = 6500;

/** `Sedan_AutomaticTransmissionSimpleMap.cpp`: gearbox reductions (Chrono stores 1/ratio). */
export const GEARS = [3.778, 2.045, 1.276, 0.941, 0.784, 0.667];
export const REVERSE = 3.333;
/** Upshift engine speed of every gear but first (4000 rpm), rpm. */
export const UPSHIFT_RPM = 4500;
/** `Sedan_Driveline2WD.cpp`: final drive (conical gear ratio 0.2) and shaft inertias, kg·m². */
export const FINAL_DRIVE = 5.0;
export const DRIVESHAFT_INERTIA = 0.5;
export const DIFFERENTIAL_BOX_INERTIA = 0.6;

/** Aerodynamic drag set by the reference script (`SetAerodynamicDrag`), as for the E90. */
export const AERO = { dragCoefficient: 0.3, frontalArea: 2.2, airDensity: 1.2 };

/** Friction of the rigid terrain patch: `ChPac02Tire`'s reference `m_mu0`, so the file applies unscaled. */
export const TERRAIN_MU = 0.8;
