//! The vehicle definition format: plain data, versioned, composed of
//! components. Mirrors `packages/core/schema/vehicle-definition.schema.json`;
//! the TypeScript side owns migrations and friendly validation messages, this
//! side guards the simulation and gives the same messages for Rust callers.

use crate::tire::TireModel;
use cp_math as m;

/// Current `formatVersion`.
pub const FORMAT_VERSION: u32 = 1;

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct VehicleDefinition {
    pub format_version: u32,
    pub name: String,
    pub chassis: ChassisDef,
    /// Front axle first, rear axle second. Milestone 1 supports exactly two.
    pub axles: Vec<AxleDef>,
    pub steering: SteeringDef,
    pub brakes: BrakesDef,
    /// Interim drive model until the drivetrain graph lands (milestone 4).
    pub drive: SimpleDriveDef,
    pub aero: AeroDef,
    pub simulation: SimulationDef,
}

impl Default for VehicleDefinition {
    fn default() -> Self {
        Self {
            format_version: FORMAT_VERSION,
            name: String::from("Unnamed vehicle"),
            chassis: ChassisDef::default(),
            axles: vec![AxleDef::front_default(), AxleDef::rear_default()],
            steering: SteeringDef::default(),
            brakes: BrakesDef::default(),
            drive: SimpleDriveDef::default(),
            aero: AeroDef::default(),
            simulation: SimulationDef::default(),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct ChassisDef {
    /// Total mass, kg.
    pub mass: f64,
    /// Yaw inertia about the centre of mass, kg·m².
    pub yaw_inertia: f64,
    /// Wheelbase, m.
    pub wheelbase: f64,
    /// Distance from the front axle to the centre of mass, m.
    pub cg_to_front_axle: f64,
    /// Centre-of-mass height above ground, m. Drives longitudinal load transfer.
    pub cg_height: f64,
    /// Track width, m. Unused by the single-track model; kept for M2.
    pub track_width: f64,
}

impl Default for ChassisDef {
    fn default() -> Self {
        Self {
            mass: 1300.0,
            yaw_inertia: 2000.0,
            wheelbase: 2.6,
            cg_to_front_axle: 1.15,
            cg_height: 0.5,
            track_width: 1.55,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct AxleDef {
    pub tire: TireModel,
    /// Spin inertia of one wheel plus its share of the drivetrain, kg·m².
    pub wheel_inertia: f64,
    /// Whether this axle receives drive torque.
    pub driven: bool,
    /// Whether this axle steers.
    pub steered: bool,
    /// Maximum service-brake torque for the whole axle, N·m.
    pub max_brake_torque: f64,
    /// Static camber, degrees (positive leaning to +y).
    pub static_camber_deg: f64,
}

impl Default for AxleDef {
    fn default() -> Self {
        AxleDef::front_default()
    }
}

impl AxleDef {
    pub fn front_default() -> Self {
        Self {
            tire: TireModel::default(),
            wheel_inertia: 2.4,
            driven: true,
            steered: true,
            max_brake_torque: 3600.0,
            static_camber_deg: 0.0,
        }
    }

    pub fn rear_default() -> Self {
        Self {
            tire: TireModel::default(),
            wheel_inertia: 2.4,
            driven: false,
            steered: false,
            max_brake_torque: 2000.0,
            static_camber_deg: 0.0,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct SteeringDef {
    /// Maximum road-wheel angle, degrees.
    pub max_wheel_angle_deg: f64,
    /// Steering ratio (hand-wheel degrees per road-wheel degree).
    pub ratio: f64,
}

impl Default for SteeringDef {
    fn default() -> Self {
        Self {
            max_wheel_angle_deg: 35.0,
            ratio: 14.0,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct BrakesDef {
    /// Maximum handbrake torque at the rear axle, N·m.
    pub handbrake_torque: f64,
}

impl Default for BrakesDef {
    fn default() -> Self {
        Self {
            handbrake_torque: 1500.0,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct SimpleDriveDef {
    /// Total drive torque at the wheels at full throttle, N·m, split evenly
    /// across driven axles.
    pub max_wheel_torque: f64,
    /// Wheel speed above which drive torque fades to zero, rad/s. Stands in
    /// for a power limit until the drivetrain lands.
    pub max_wheel_speed: f64,
}

impl Default for SimpleDriveDef {
    fn default() -> Self {
        Self {
            max_wheel_torque: 2200.0,
            max_wheel_speed: 160.0,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct AeroDef {
    pub drag_coefficient: f64,
    /// Frontal area, m².
    pub frontal_area: f64,
    /// Air density, kg/m³.
    pub air_density: f64,
}

impl Default for AeroDef {
    fn default() -> Self {
        Self {
            drag_coefficient: 0.32,
            frontal_area: 2.2,
            air_density: crate::AIR_DENSITY,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct SimulationDef {
    /// Internal substep rate, Hz.
    pub substep_rate_hz: f64,
}

impl Default for SimulationDef {
    fn default() -> Self {
        Self {
            substep_rate_hz: 1000.0,
        }
    }
}

impl VehicleDefinition {
    /// Human-readable validation. Returns every problem found.
    pub fn validate(&self) -> Result<(), Vec<String>> {
        let mut e = Vec::new();
        if self.format_version != FORMAT_VERSION {
            e.push(format!(
                "formatVersion {} is not supported by this core (expected {}); run the migration in @contactpatch/core first",
                self.format_version, FORMAT_VERSION
            ));
        }
        let c = &self.chassis;
        if !(c.mass > 0.0) {
            e.push(format!("chassis.mass must be positive (got {})", c.mass));
        }
        if !(c.yaw_inertia > 0.0) {
            e.push(format!(
                "chassis.yawInertia must be positive (got {})",
                c.yaw_inertia
            ));
        }
        if !(c.wheelbase > 0.0) {
            e.push(format!(
                "chassis.wheelbase must be positive (got {})",
                c.wheelbase
            ));
        }
        if !(c.cg_to_front_axle > 0.0 && c.cg_to_front_axle < c.wheelbase) {
            e.push(format!(
                "chassis.cgToFrontAxle must lie between the axles, 0 < {} < wheelbase {}",
                c.cg_to_front_axle, c.wheelbase
            ));
        }
        if !(c.cg_height >= 0.0) {
            e.push(format!(
                "chassis.cgHeight must be zero or positive (got {})",
                c.cg_height
            ));
        }
        if self.axles.len() != 2 {
            e.push(format!(
                "axles must contain exactly two entries (front, rear) in this milestone; got {}",
                self.axles.len()
            ));
        }
        for (i, a) in self.axles.iter().enumerate() {
            let name = if i == 0 { "front" } else { "rear" };
            let prefix = format!("axles[{i}] ({name}).tire");
            a.tire.validate(&prefix, &mut e);
            if !(a.wheel_inertia > 0.0) {
                e.push(format!(
                    "axles[{i}] ({name}).wheelInertia must be positive (got {})",
                    a.wheel_inertia
                ));
            }
            if !(a.max_brake_torque >= 0.0) {
                e.push(format!(
                    "axles[{i}] ({name}).maxBrakeTorque must be zero or positive (got {})",
                    a.max_brake_torque
                ));
            }
        }
        if !self.axles.iter().any(|a| a.driven) {
            e.push(String::from("at least one axle must be driven"));
        }
        if !(self.steering.max_wheel_angle_deg > 0.0 && self.steering.max_wheel_angle_deg <= 90.0) {
            e.push(format!(
                "steering.maxWheelAngleDeg must be in (0, 90] (got {})",
                self.steering.max_wheel_angle_deg
            ));
        }
        if !(self.steering.ratio > 0.0) {
            e.push(format!(
                "steering.ratio must be positive (got {})",
                self.steering.ratio
            ));
        }
        if !(self.drive.max_wheel_torque >= 0.0) {
            e.push(format!(
                "drive.maxWheelTorque must be zero or positive (got {})",
                self.drive.max_wheel_torque
            ));
        }
        if !(self.drive.max_wheel_speed > 0.0) {
            e.push(format!(
                "drive.maxWheelSpeed must be positive (got {})",
                self.drive.max_wheel_speed
            ));
        }
        if !(self.aero.drag_coefficient >= 0.0
            && self.aero.frontal_area >= 0.0
            && self.aero.air_density >= 0.0)
        {
            e.push(String::from("aero.dragCoefficient, aero.frontalArea and aero.airDensity must be zero or positive"));
        }
        if !(self.simulation.substep_rate_hz >= 60.0 && self.simulation.substep_rate_hz <= 10000.0)
        {
            e.push(format!(
                "simulation.substepRateHz must be between 60 and 10000 (got {})",
                self.simulation.substep_rate_hz
            ));
        }
        // Finite check over everything that reaches the integrator.
        for v in [
            c.mass,
            c.yaw_inertia,
            c.wheelbase,
            c.cg_to_front_axle,
            c.cg_height,
        ] {
            if !v.is_finite() {
                e.push(String::from("chassis contains a non-finite number"));
                break;
            }
        }
        if e.is_empty() {
            Ok(())
        } else {
            Err(e)
        }
    }

    /// Distance from the centre of mass to the rear axle, m.
    #[inline]
    pub fn cg_to_rear_axle(&self) -> f64 {
        self.chassis.wheelbase - self.chassis.cg_to_front_axle
    }

    #[inline]
    pub fn max_wheel_angle(&self) -> f64 {
        m::deg_to_rad(self.steering.max_wheel_angle_deg)
    }
}
