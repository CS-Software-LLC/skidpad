/**
 * Constants of Project Chrono's BMW_E90 model, version 9.0.1, as published in
 * its source (BSD-3-Clause) under `src/chrono_models/vehicle/bmw/` and
 * `src/chrono_vehicle/`. Numbers only: the Skidpad model built from them is
 * in `vehicle.ts`. Frames follow Chrono: x forward, y left, z up, metres,
 * relative to the chassis reference frame unless noted.
 *
 * Measured quantities (static loads, ride height, inertia about the centre
 * of mass) come from `reference/bmw_e90/static.json`, written by `chrono/bmw_e90.py`.
 */

/** TMsimple coefficients (`BMW_E90_TMsimpleTireFront.cpp`, `...Rear.cpp`). */
export interface TmSimpleTire {
  /** Nominal load `pn`, N. Coefficients are quoted at `pn` and `2·pn`. */
  pn: number;
  dfx0Pn: number;
  dfx0P2n: number;
  fxmPn: number;
  fxmP2n: number;
  fxsPn: number;
  fxsP2n: number;
  dfy0Pn: number;
  dfy0P2n: number;
  fymPn: number;
  fymP2n: number;
  fysPn: number;
  fysP2n: number;
  unloadedRadius: number;
  /** Linear vertical stiffness, N/m. */
  verticalStiffness: number;
  rollingResistance: number;
  /** Spin inertia of the tire, kg·m². */
  spinInertia: number;
}

export const TIRE_FRONT: TmSimpleTire = {
  pn: 3089.09475,
  dfx0Pn: 95453.800847,
  dfx0P2n: 187961.00121,
  fxmPn: 3804.20473,
  fxmP2n: 7320.7541,
  fxsPn: 2883.743455,
  fxsP2n: 5026.523713,
  dfy0Pn: 68872.790069,
  dfy0P2n: 125643.234662,
  fymPn: 3432.500362,
  fymP2n: 6112.00885,
  fysPn: 2412.660879,
  fysP2n: 3661.371397,
  unloadedRadius: 0.3186,
  verticalStiffness: 310526.319544,
  rollingResistance: 0.01,
  spinInertia: 0.897477,
};

export const TIRE_REAR: TmSimpleTire = {
  pn: 3285.22775,
  dfx0Pn: 95426.247934,
  dfx0P2n: 180428.660916,
  fxmPn: 4030.192524,
  fxmP2n: 7875.872679,
  fxsPn: 3118.106854,
  fxsP2n: 5544.347735,
  dfy0Pn: 73011.000908,
  dfy0P2n: 135869.397227,
  fymPn: 3647.834933,
  fymP2n: 6498.518198,
  fysPn: 2585.674242,
  fysP2n: 3810.706992,
  unloadedRadius: 0.3186,
  verticalStiffness: 357859.232809,
  rollingResistance: 0.01,
  spinInertia: 0.81545,
};

/** Spin inertia of the rims (`BMW_E90_FrontWheel.cpp`, `...RearWheel.cpp`), kg·m². */
export const RIM_INERTIA = { front: 1.383875, rear: 1.180307 };
/** Spindle spin inertia (`BMW_E90_MacPhersonStrut.cpp`, `BMW_E90_DoubleWishbone.cpp`), kg·m². */
export const SPINDLE_INERTIA = { front: 0.000496, rear: 0.07352 };
/** Axle shaft inertia per side (`m_axleInertia`, both suspensions), kg·m². */
export const AXLE_SHAFT_INERTIA = 0.4;

/**
 * Suspension rates at the wheel. Chrono quotes each spring and damper at the
 * wheel and multiplies by the square of a kinematic factor to place it on the
 * strut, so the wheel rates are the quoted numbers.
 */
export const SUSPENSION = {
  front: {
    /** `BMW_E90_MacPhersonStrut.cpp`: 29770 N/m at the wheel. */
    springRate: 29770,
    /** Degressive damper, 4352.5 N·s/m at the wheel below its knee. */
    damping: 4352.486957,
    /** Kinematic factor, strut travel per wheel travel inverse. */
    kinematicFactor: 1.528865979,
    /** Spring stops at ±0.05 m of spring length from the design length. */
    stopSpringTravel: 0.05,
  },
  rear: {
    /** `BMW_E90_DoubleWishbone.cpp`: 37130 N/m at the wheel. */
    springRate: 37130,
    /** Linear damper, 5810.4 N·s/m at the wheel. */
    damping: 5810.4,
    kinematicFactor: 2.109289617,
    stopSpringTravel: 0.05,
  },
};

/**
 * Hardpoints in each suspension's frame (left side; the suspension frame
 * sits at the chassis reference for the front axle and 2.75717 m behind it
 * for the rear). `BMW_E90_MacPhersonStrut.cpp`, `BMW_E90_DoubleWishbone.cpp`.
 */
export type Point3 = [number, number, number];
export const MACPHERSON = {
  spindle: [0, 0.750062, 0] as Point3,
  lcaFront: [0.27051, 0.34544, -0.05969] as Point3,
  lcaBack: [-0.04318, 0.37338, -0.12573] as Point3,
  lcaUpright: [0.02794, 0.66294, -0.10414] as Point3,
  strutChassis: [-0.08382, 0.54102, 0.46863] as Point3,
  strutUpright: [-0.00508, 0.61976, -0.00127] as Point3,
  /** Tie rod at the steering rack (`TIEROD_C`), fixed while the steering is centred. */
  tierodChassis: [-0.05588, 0.3429, -0.09017] as Point3,
  /** Tie rod at the upright (`TIEROD_U`). */
  tierodUpright: [-0.13716, 0.68072, -0.09779] as Point3,
};
export const DOUBLE_WISHBONE = {
  spindle: [0, 0.7493, 0] as Point3,
  ucaFront: [0.14986, 0.4572, 0.0635] as Point3,
  ucaBack: [-0.0508, 0.40132, 0.11684] as Point3,
  ucaUpright: [0.01397, 0.65024, 0.08636] as Point3,
  lcaFront: [0.22352, 0.41148, -0.07874] as Point3,
  lcaBack: [-0.1778, 0.25908, -0.12446] as Point3,
  lcaUpright: [-0.01778, 0.64389, -0.127] as Point3,
  /** Toe link at the chassis (`TIEROD_C`). */
  tierodChassis: [-0.2235, 0.25781, -0.04064] as Point3,
  /** Toe link at the upright (`TIEROD_U`). */
  tierodUpright: [-0.1524, 0.65786, -0.04572] as Point3,
};

/**
 * Spindle angles at the design position, degrees, per wheel (negative
 * camber is top-in, positive toe is toe-in): `getCamberAngle()` and
 * `getToeAngle()` in `BMW_E90_MacPhersonStrut.h` (front, −2° camber) and
 * `BMW_E90_DoubleWishbone.h` (rear, zero).
 */
export const DESIGN_ANGLES = {
  front: { camberDeg: -2, toeDeg: 0 },
  rear: { camberDeg: 0, toeDeg: 0 },
};

/** `BMW_E90_BrakeShafts.cpp`: maximum torque per wheel at full pedal, N·m. */
export const BRAKE_TORQUE_PER_WHEEL = 2000;

/** `BMW_E90_EngineSimpleMap.cpp`: full-throttle torque, [rpm, N·m]. */
export const ENGINE_FULL_THROTTLE: [number, number][] = [
  [0, 0.6 * 174.4],
  [992, 269],
  [1433, 359.9],
  [5028, 359.9],
  [5649, 336.8],
  [6000, 318.3],
  [6400, 295.2],
  [7000, 251.2],
];
/** `BMW_E90_EngineSimpleMap.cpp`: closed-throttle torque, [rpm, N·m] (negative is drag). */
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
  [7200, -100],
];
/** Fuel cut-off (`GetMaxEngineSpeed`), rpm. */
export const ENGINE_MAX_RPM = 7200;

/** `BMW_E90_AutomaticTransmissionSimpleMap.cpp`: gearbox reductions (Chrono stores 1/ratio). */
export const GEARS = [4.71, 2.34, 1.52, 1.14, 0.87, 0.69];
export const REVERSE = 3.4;
/** Upshift speed of every gear but first (5000 rpm), rpm. */
export const UPSHIFT_RPM = 5500;
/** `BMW_E90_Driveline.cpp`: final drive and shaft inertias, kg·m². */
export const FINAL_DRIVE = 3.64;
export const DRIVESHAFT_INERTIA = 0.5;
export const DIFFERENTIAL_BOX_INERTIA = 0.6;

/** `BMW_E90_Steering.cpp`: maximum road-wheel angle, rad. */
export const MAX_STEER_ANGLE = (28 * Math.PI) / 180;

/** Aerodynamic drag set by the reference script (`SetAerodynamicDrag`). */
export const AERO = { dragCoefficient: 0.3, frontalArea: 2.2, airDensity: 1.2 };

/** Friction of the rigid terrain patch in the reference script; equals TMsimple `mu_0`. */
export const TERRAIN_MU = 0.85;
