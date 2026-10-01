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
  /** Rolling resistance coefficient. */
  rollingResistance?: number;
  /** Longitudinal relaxation length, m. */
  relaxationLengthLong?: number;
  /** Lateral relaxation length, m. */
  relaxationLengthLat?: number;
  /** Speed floor for slip computation, m/s (ADR-0005). */
  lowSpeedFloor?: number;
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
  [coefficient: string]: number | string | undefined;
}

export type TireDefinition = FeelTireParams | MagicFormulaParams;

export interface ChassisDefinition {
  /** Total mass, kg. */
  mass: number;
  /** Yaw inertia about the centre of mass, kg·m². */
  yawInertia: number;
  /** Wheelbase, m. */
  wheelbase: number;
  /** Distance from the front axle to the centre of mass, m. */
  cgToFrontAxle: number;
  /** Centre-of-mass height above ground, m. */
  cgHeight: number;
  /** Track width, m. */
  trackWidth: number;
}

export interface AxleDefinition {
  tire: TireDefinition;
  /** Spin inertia of one wheel plus its share of the drivetrain, kg·m². */
  wheelInertia: number;
  driven: boolean;
  steered: boolean;
  /** Maximum service-brake torque for the whole axle, N·m. */
  maxBrakeTorque: number;
  /** Static camber, degrees. */
  staticCamberDeg: number;
}

export interface SteeringDefinition {
  /** Maximum road-wheel angle, degrees. */
  maxWheelAngleDeg: number;
  /** Hand-wheel degrees per road-wheel degree. */
  ratio: number;
}

export interface BrakesDefinition {
  /** Maximum handbrake torque at the rear axle, N·m. */
  handbrakeTorque: number;
}

export interface SimpleDriveDefinition {
  /** Total drive torque at the wheels at full throttle, N·m. */
  maxWheelTorque: number;
  /** Wheel speed above which drive torque fades to zero, rad/s. */
  maxWheelSpeed: number;
}

export interface AeroDefinition {
  dragCoefficient: number;
  /** Frontal area, m². */
  frontalArea: number;
  /** Air density, kg/m³. */
  airDensity: number;
}

export interface SimulationDefinition {
  /** Internal substep rate, Hz. */
  substepRateHz: number;
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
  drive: SimpleDriveDefinition;
  aero: AeroDefinition;
  simulation: SimulationDefinition;
  dataSheet?: DataSheet;
}

/** A definition where every component may be partially specified. */
export type PartialVehicleDefinition = {
  formatVersion?: number;
  name?: string;
  chassis?: Partial<ChassisDefinition>;
  axles?: Array<Partial<AxleDefinition>>;
  steering?: Partial<SteeringDefinition>;
  brakes?: Partial<BrakesDefinition>;
  drive?: Partial<SimpleDriveDefinition>;
  aero?: Partial<AeroDefinition>;
  simulation?: Partial<SimulationDefinition>;
  dataSheet?: DataSheet;
};
