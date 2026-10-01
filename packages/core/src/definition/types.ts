/**
 * Vehicle definition types. These mirror `crates/skidpad-core/src/definition.rs`
 * and the JSON Schema in `schema/vehicle-definition.schema.json`. All units
 * are SI unless the field name says otherwise (`...Deg`).
 */

export const CURRENT_FORMAT_VERSION = 1;

/** The "feel" tire model (ADR-0008). All fields optional; defaults apply. */
export interface FeelTireParams {
  model: "feel";
  /** Unloaded radius, m. */
  radius?: number;
  /** Load at which the friction and stiffness parameters are quoted, N. */
  nominalLoad?: number;
  /** Peak friction coefficient at the nominal load. */
  peakFriction?: number;
  /** Fractional drop in peak friction per unit of (Fz − Fz0) / Fz0. */
  loadSensitivity?: number;
  /** Slip ratio at which longitudinal force peaks. */
  peakSlipRatio?: number;
  /** Slip angle at which lateral force peaks, degrees. */
  peakSlipAngleDeg?: number;
  /** Longitudinal stiffness at the nominal load, normalised by load. */
  longitudinalStiffness?: number;
  /** Cornering stiffness at the nominal load, normalised by load, 1/rad. */
  corneringStiffness?: number;
  /** Load at which stiffness is highest, N. */
  stiffnessPeakLoad?: number;
  /** Sliding friction as a fraction of peak (longitudinal). */
  falloffLong?: number;
  /** Sliding friction as a fraction of peak (lateral). */
  falloffLat?: number;
  /** Lateral force per radian of camber, normalised by load, 1/rad. */
  camberStiffness?: number;
  /** Pneumatic trail at zero slip, m. */
  pneumaticTrail?: number;
  /**
   * Equivalent slip angle at which the trail crosses zero, as a multiple of
   * `peakSlipAngleDeg` (ADR-0008). Default 1.
   */
  trailZeroCrossing?: number;
  /**
   * Depth of the negative trail lobe past the zero crossing, as a fraction
   * of `pneumaticTrail` (ADR-0008). Default 0.1.
   */
  trailReversal?: number;
  /**
   * Lateral offset of the longitudinal force per unit of `Fy / nominalLoad`,
   * m; adds `s · Fx` to the aligning moment (Magic Formula SSZ2). Default 0.
   */
  fxMomentArm?: number;
  /** Rolling resistance coefficient. */
  rollingResistance?: number;
  /** Longitudinal relaxation length, m. */
  relaxationLengthLong?: number;
  /** Lateral relaxation length, m. */
  relaxationLengthLat?: number;
  /**
   * Speed floor of the kinematic slip, m/s (ADR-0005): telemetry slips and
   * the standstill deflection bound. The deflection transient decays at the
   * true rolling speed (ADR-0010).
   */
  lowSpeedFloor?: number;
  /** Damping ratio of the contact-patch spring on the corner mass at standstill (ADR-0010). */
  lowSpeedDamping?: number;
  /** Rolling speed at which the low-speed damping has faded to zero, m/s (ADR-0010). */
  lowSpeedDampingFade?: number;
}

/**
 * Magic Formula 5.2 subset. Keys are the lower-cased `.tir` coefficient
 * names (`pky1`, `qbz1`, …) plus the structural fields below. Use
 * {@link Skidpad.importTir} to build one from a `.tir` file.
 */
export interface MagicFormulaParams {
  model: "magicFormula";
  unloadedRadius?: number;
  fz0?: number;
  longvl?: number;
  relaxationLengthLong?: number;
  relaxationLengthLat?: number;
  lowSpeedFloor?: number;
  lowSpeedDamping?: number;
  lowSpeedDampingFade?: number;
  [coefficient: string]: number | string | undefined;
}

export type TireDefinition = FeelTireParams | MagicFormulaParams;

export interface ChassisDefinition {
  /** Total mass, kg. */
  mass: number;
  /** Yaw inertia about the centre of mass, kg·m². */
  yawInertia: number;
  /** Roll inertia about the centre of mass, kg·m² (four-wheel model). */
  rollInertia: number;
  /** Pitch inertia about the centre of mass, kg·m² (four-wheel model). */
  pitchInertia: number;
  /** Wheelbase, m. */
  wheelbase: number;
  /** Distance from the front axle to the centre of mass, m. */
  cgToFrontAxle: number;
  /** Centre-of-mass height above ground, m. */
  cgHeight: number;
  /** Track width, m. */
  trackWidth: number;
}

/**
 * One corner's spring, damper, travel limits and the axle's anti-roll bar
 * (ADR-0009). Values are per wheel.
 */
/** How the two wheels of an axle are held (ADR-0016). */
export type SuspensionKind = "independent" | "solid";

export interface SuspensionDefinition {
  /**
   * `"independent"` (default): each wheel on its own strut, leaning with
   * the body. `"solid"`: a beam axle that keeps both wheels upright to the
   * line through its two contacts (ADR-0016).
   */
  kind: SuspensionKind;
  /** Spring rate at the wheel, N/m. */
  springRate: number;
  /** Damping in compression, N·s/m. */
  bumpDamping: number;
  /** Damping in extension, N·s/m. */
  reboundDamping: number;
  /** Compression travel from the static ride height, m. */
  travelBump: number;
  /** Extension travel from the static ride height, m. */
  travelDroop: number;
  /** Anti-roll bar stiffness at the wheel, N/m of left-right travel difference. */
  antiRollStiffness: number;
  /** Bump-stop stiffness beyond the bump travel, N/m. */
  bumpStopStiffness: number;
  /**
   * Roll-centre height above the ground at ride height, m (ADR-0016). The
   * share `h_rc / h_cg` of this axle's lateral load transfer goes through
   * the links straight to the tires instead of rolling the body. Zero puts
   * the roll centre on the ground.
   */
  rollCenterHeight: number;
}

export interface AxleDefinition {
  tire: TireDefinition;
  /** Spin inertia of one wheel plus its share of the drivetrain, kg·m². */
  wheelInertia: number;
  driven: boolean;
  steered: boolean;
  /** Maximum service-brake torque for the whole axle, N·m. */
  maxBrakeTorque: number;
  /** Static camber, degrees; negative leans the top of each wheel inward. */
  staticCamberDeg: number;
  /**
   * Static toe per wheel, degrees; positive is toe-in (each wheel points
   * toward the centreline). Four-wheel model only.
   */
  staticToeDeg: number;
  /** Independent suspension at each wheel of this axle (four-wheel model). */
  suspension: SuspensionDefinition;
}

export interface SteeringDefinition {
  /** Maximum road-wheel angle, degrees. */
  maxWheelAngleDeg: number;
  /** Hand-wheel degrees per road-wheel degree. */
  ratio: number;
  /** Ackermann fraction: 0 parallel steer, 1 ideal Ackermann (four-wheel model). */
  ackermann: number;
  /** Mechanical (caster) trail on the ground, m (ADR-0012). */
  mechanicalTrail: number;
  /** Scrub radius, m, positive with the contact outboard of the kingpin axis. */
  scrubRadius: number;
  /** Knuckle arm the rack pulls on, m; `RackForce` is the kingpin torque over it. */
  steeringArm: number;
  /** Fraction of the rack torque the power assist removes at the hand wheel, 0 … 1. */
  powerAssist: number;
  /** Column friction for the force-feedback device, N·m (not simulated). */
  columnFriction: number;
  /** Column damping for the force-feedback device, N·m per rad/s. */
  columnDamping: number;
  /** Front contact travel along its ray per radian of steer, m/rad: inner down, outer up. */
  jackingRate: number;
}

export interface BrakesDefinition {
  /** Maximum handbrake torque at the rear axle, N·m. */
  handbrakeTorque: number;
}

/**
 * The interim drive of milestones 1 to 3, kept as the `direct` power unit:
 * a carrier torque law with no engine state.
 */
export interface DirectDriveDefinition {
  kind: "direct";
  /** Carrier torque at full throttle and rest, N·m, shared by the driven wheels. */
  maxWheelTorque?: number;
  /** Carrier speed at which the torque has faded to zero, rad/s. */
  maxWheelSpeed?: number;
}

/** Internal combustion engine (ADR-0011). */
export interface CombustionEngineDefinition {
  kind: "combustion";
  /** Idle speed, rpm. */
  idleRpm?: number;
  /** Rev limiter, rpm; the torque is cut smoothly over the last 2 %. */
  redlineRpm?: number;
  /** Crank, flywheel and clutch cover inertia, kg·m². */
  inertia?: number;
  /** Full-throttle torque curve as `[rpm, N·m]` points in increasing rpm. */
  torqueCurve?: [number, number][];
  /** Closed-throttle drag torque at idle, N·m. */
  engineBrakingIdle?: number;
  /** Closed-throttle drag torque at redline, N·m. */
  engineBrakingRedline?: number;
  /** Most torque the idle governor adds below idle, N·m. */
  idleTorqueMax?: number;
}

/** Electric motor (ADR-0011): constant torque, then constant power. */
export interface ElectricMotorDefinition {
  kind: "electric";
  /** Peak motor torque, N·m. */
  maxTorque?: number;
  /** Peak power, W. */
  maxPower?: number;
  /** Speed at which the torque has faded to zero, rpm. */
  maxRpm?: number;
  /** Rotor inertia, kg·m². */
  inertia?: number;
  /** Regenerative braking torque on a closed throttle, N·m. */
  regenTorque?: number;
}

export type PowerUnitDefinition =
  DirectDriveDefinition | CombustionEngineDefinition | ElectricMotorDefinition;

export type TransmissionMode = "automatic" | "manual";

export interface TransmissionDefinition {
  /** Forward ratios, first gear first. One entry is a single speed. */
  gears: number[];
  /** Reverse ratio magnitude; zero means no reverse. */
  reverse: number;
  finalDrive: number;
  /** `"automatic"` shifts by itself and treats a `gear` input of 0 as drive. */
  mode: TransmissionMode;
  /** Torque interruption while changing gear, s. */
  shiftTime: number;
  /** Time after a shift before the automatic shifts again, s. */
  shiftHold: number;
  /** Automatic upshift point as a fraction of redline (gearbox input speed). */
  shiftUpAt: number;
  /** Automatic downshift point as a fraction of redline. */
  shiftDownAt: number;
  /** Largest torque the clutch transmits when fully engaged, N·m. */
  clutchMaxTorque: number;
  /** Clutch re-engagement time after a shift, s. */
  clutchEngageTime: number;
  /** The automatic clutch bites from idle to this many rpm above idle; 0 disables it. */
  clutchBiteRpm: number;
  /** Gearbox input and clutch disc inertia, kg·m². */
  inputInertia: number;
  /** Gearbox output and propshaft inertia, kg·m². */
  outputInertia: number;
}

export type DifferentialKind = "open" | "locked" | "lsd";

export interface DifferentialDefinition {
  kind: DifferentialKind;
  /** Locking torque at zero carrier torque, N·m (LSD). */
  preload: number;
  /** Torque bias ratio under drive, ≥ 1 (LSD). */
  biasDrive: number;
  /** Torque bias ratio on the overrun, ≥ 1 (LSD). */
  biasCoast: number;
}

export interface CenterDifferentialDefinition extends DifferentialDefinition {
  /** Share of the carrier torque sent to the front axle when open, 0 … 1. */
  frontTorqueFraction: number;
}

/** Driving assists (ADR-0013), all off by default; stateless, inside the core. */
export interface AssistsDefinition {
  abs: {
    enabled: boolean;
    /** Braking slip ratio where the modulation starts. */
    slipTarget: number;
    /** Braking slip ratio where the brake is at its floor. */
    slipRelease: number;
    /** Smallest fraction of the brake capacity left to the wheel. */
    floor: number;
    /** Below this speed, m/s, wheels may lock. */
    minSpeed: number;
  };
  tractionControl: {
    enabled: boolean;
    slipTarget: number;
    slipRelease: number;
  };
  stabilityControl: {
    enabled: boolean;
    /** Brake torque per rad/s of yaw-rate error, N·m/(rad/s). */
    gain: number;
    /** Yaw-rate error ignored, rad/s. */
    deadBand: number;
    /** Throttle cut per rad/s of error. */
    throttleCut: number;
    minSpeed: number;
  };
  steeringAssist: {
    enabled: boolean;
    /** Lateral acceleration the steering limit aims for, m/s². */
    latAccelLimit: number;
  };
}

export type PartialAssistsDefinition = {
  abs?: Partial<AssistsDefinition["abs"]>;
  tractionControl?: Partial<AssistsDefinition["tractionControl"]>;
  stabilityControl?: Partial<AssistsDefinition["stabilityControl"]>;
  steeringAssist?: Partial<AssistsDefinition["steeringAssist"]>;
};

/** Power unit, transmission and differentials (ADR-0011). */
export interface DrivetrainDefinition {
  powerUnit: PowerUnitDefinition;
  transmission: TransmissionDefinition;
  /** Front axle differential (four-wheel model). */
  front: DifferentialDefinition;
  /** Rear axle differential (four-wheel model). */
  rear: DifferentialDefinition;
  /** Centre differential, used when both axles are driven. */
  center: CenterDifferentialDefinition;
}

export interface AeroDefinition {
  dragCoefficient: number;
  /** Frontal area, m²; the reference area of every coefficient here. */
  frontalArea: number;
  /** Air density, kg/m³. */
  airDensity: number;
  /** Lift coefficient at the front axle on `frontalArea`; negative is downforce (ADR-0015). */
  liftCoefficientFront: number;
  /** Lift coefficient at the rear axle on `frontalArea`; negative is downforce. */
  liftCoefficientRear: number;
  /** Height of the drag's line of action above the centre of mass, m; drag up high lifts the nose. */
  dragHeightAboveCg: number;
}

/**
 * One entry of a world's surface table (ADR-0014): what the ground under a
 * wheel does to its tire. Wheel contacts carry a surface id that indexes
 * the table set with {@link World.setSurfaces}.
 */
export interface SurfaceDefinition {
  /** Scale on the tire's peak and sliding friction; 1 is the surface the tire was tuned on. */
  grip: number;
  /** Scale on the tire's rolling resistance. */
  rollingResistance: number;
  /** Ploughing drag, N per N of load, opposing the contact-patch motion (gravel, sand, snow). */
  drag: number;
}

/** The vehicle models. Both read the same definition. */
export type VehicleModelKind = "singleTrack" | "fourWheel";

export interface SimulationDefinition {
  /** Internal substep rate, Hz. */
  substepRateHz: number;
  /**
   * `"fourWheel"` (default): independent suspension on a 6-DOF chassis
   * proxy, host-drivable. `"singleTrack"`: the planar bicycle model, the
   * level-of-detail model for traffic.
   */
  model: VehicleModelKind;
}

/** Sources and notes for a reference vehicle. */
export interface DataSheet {
  description?: string;
  sources?: string[];
  notes?: string;
}

export interface VehicleDefinition {
  formatVersion: number;
  name: string;
  chassis: ChassisDefinition;
  /** Front axle first, rear axle second. */
  axles: AxleDefinition[];
  steering: SteeringDefinition;
  brakes: BrakesDefinition;
  drivetrain: DrivetrainDefinition;
  assists: AssistsDefinition;
  aero: AeroDefinition;
  simulation: SimulationDefinition;
  dataSheet?: DataSheet;
}

export type PartialDrivetrainDefinition = {
  powerUnit?: PowerUnitDefinition;
  transmission?: Partial<TransmissionDefinition>;
  front?: Partial<DifferentialDefinition>;
  rear?: Partial<DifferentialDefinition>;
  center?: Partial<CenterDifferentialDefinition>;
};

/** A definition where every component may be partially specified. */
export type PartialVehicleDefinition = {
  formatVersion?: number;
  name?: string;
  chassis?: Partial<ChassisDefinition>;
  axles?: Array<
    Partial<Omit<AxleDefinition, "suspension">> & { suspension?: Partial<SuspensionDefinition> }
  >;
  steering?: Partial<SteeringDefinition>;
  brakes?: Partial<BrakesDefinition>;
  drivetrain?: PartialDrivetrainDefinition;
  assists?: PartialAssistsDefinition;
  aero?: Partial<AeroDefinition>;
  simulation?: Partial<SimulationDefinition>;
  dataSheet?: DataSheet;
};
