//! The vehicle definition format: plain data, versioned, composed of
//! components. Mirrors `packages/core/schema/vehicle-definition.schema.json`;
//! the TypeScript side owns migrations and friendly validation messages, this
//! side guards the simulation and gives the same messages for Rust callers.

use crate::assists::AssistsDef;
use crate::drivetrain::DrivetrainDef;
use crate::geom::Vec3;
use crate::kinematics::KinematicsDef;
use crate::tire::TireModel;
use skidpad_math as m;

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
    /// Power unit, transmission and differentials (ADR-0011). Which axles
    /// it drives comes from `axles[].driven`.
    pub drivetrain: DrivetrainDef,
    /// Driving assists (ADR-0013), all off by default.
    pub assists: AssistsDef,
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
            drivetrain: DrivetrainDef::default(),
            assists: AssistsDef::default(),
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
    /// Roll inertia about the centre of mass (x axis), kg·m². Four-wheel
    /// model only.
    pub roll_inertia: f64,
    /// Pitch inertia about the centre of mass (y axis), kg·m². Four-wheel
    /// model only.
    pub pitch_inertia: f64,
    /// Wheelbase, m.
    pub wheelbase: f64,
    /// Distance from the front axle to the centre of mass, m.
    pub cg_to_front_axle: f64,
    /// Centre-of-mass height above ground, m. Drives longitudinal load transfer.
    pub cg_height: f64,
    /// Track width, m. An axle may set its own (`axles[].trackWidth`).
    pub track_width: f64,
}

impl Default for ChassisDef {
    fn default() -> Self {
        Self {
            mass: 1300.0,
            yaw_inertia: 2000.0,
            roll_inertia: 500.0,
            pitch_inertia: 1800.0,
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
    /// Static camber, degrees. Negative leans the top of each wheel toward
    /// the centreline (the usual road-car setting); the single-track model
    /// ignores it because the mirrored thrust cancels.
    pub static_camber_deg: f64,
    /// Static toe per wheel, degrees. Positive is toe-in: each wheel of the
    /// axle points toward the centreline ahead of it. It adds to the
    /// steering angle on both models' wheel axes, so a toed-in axle runs
    /// each tire at a small slip angle when driving straight, with the
    /// lateral forces cancelling and a little drag left over. The
    /// single-track model ignores it because the mirrored forces cancel.
    pub static_toe_deg: f64,
    /// Lateral-force compliance steer (ADR-0027): each wheel's steer per kN
    /// of its own lateral force, degrees, positive understeer on either
    /// axle. Ahead of the centre of mass positive steers the wheel away
    /// from its lateral force, behind it toward it. Default 0. Four-wheel
    /// and single-track models.
    pub lateral_compliance_steer_deg: f64,
    /// Track width of this axle, m, between the contact patches. Zero (the
    /// default) uses `chassis.trackWidth`. Four-wheel model only.
    pub track_width: f64,
    /// Independent suspension at each wheel of this axle. Four-wheel model
    /// only.
    pub suspension: SuspensionDef,
}

/// One corner's spring, damper, travel limits and the axle's anti-roll bar.
/// Modelled as a raycast strut on the chassis proxy (ADR-0009): no unsprung
/// mass, so there is no wheel-hop mode to destabilise low substep rates.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct SuspensionDef {
    /// Independent (each wheel on its own strut) or a solid beam axle that
    /// keeps both wheels upright to the road (ADR-0016). Four-wheel model
    /// only.
    pub kind: SuspensionKind,
    /// Spring rate at the wheel, N/m, per wheel.
    pub spring_rate: f64,
    /// Damping in bump (compression), N·s/m, per wheel.
    pub bump_damping: f64,
    /// Damping in rebound (extension), N·s/m, per wheel.
    pub rebound_damping: f64,
    /// Compression travel available from the static ride height, m.
    pub travel_bump: f64,
    /// Extension travel available from the static ride height, m.
    pub travel_droop: f64,
    /// Anti-roll bar stiffness at the wheel, N/m: force on each wheel per
    /// metre of left-right travel difference.
    pub anti_roll_stiffness: f64,
    /// Bump-stop stiffness beyond the bump travel, N/m.
    pub bump_stop_stiffness: f64,
    /// Roll-centre height above the ground at ride height, m (ADR-0016).
    /// The share `h_rc / h_cg` of this axle's lateral load transfer goes
    /// through the links straight to the tires (geometric transfer) instead
    /// of rolling the body on its springs. Zero puts the roll centre on the
    /// ground, which is what the raycast strut gives by itself. Four-wheel
    /// model only.
    pub roll_center_height: f64,
    /// Anti-pitch geometry under braking, as a fraction (ADR-0018): the
    /// share of the longitudinal load transfer caused by this axle's
    /// braking force that its links carry straight to the tires instead of
    /// pitching the body on its springs. On the front axle it is anti-dive,
    /// on the rear anti-lift; 1 is 100 %, negative is pro-dive or pro-lift.
    /// It is `tan θ · L / h_cg`, with `θ` the side-view angle from the
    /// contact patch (outboard brakes) or the wheel centre (inboard brakes)
    /// to the side-view instant centre. Four-wheel model only.
    pub anti_brake: f64,
    /// Anti-pitch geometry under drive, as a fraction (ADR-0018): the same
    /// share for this axle's driving force. On a driven rear axle it is
    /// anti-squat, on a driven front axle anti-lift. Four-wheel model only.
    pub anti_drive: f64,
    /// How toe, camber, roll-centre height and the anti-pitch fractions
    /// change with each wheel's travel (ADR-0025), as offsets from the
    /// static values. Absent or empty leaves the geometry fixed at ride
    /// height. Four-wheel model only.
    #[cfg_attr(feature = "serde", serde(skip_serializing_if = "Option::is_none"))]
    pub kinematics: Option<KinematicsDef>,
    /// Unsprung mass per wheel, kg: the wheel, tire, brake, hub and the
    /// share of the links that move with them (ADR-0028). Zero (the default)
    /// keeps the massless raycast strut of ADR-0009. Above zero the wheel
    /// gets its own vertical motion on the tire's vertical spring, so it can
    /// hop. On a solid axle the beam carries both wheels' mass. Part of
    /// `chassis.mass`, not added to it. Four-wheel model only.
    pub unsprung_mass: f64,
    /// Roll inertia of a solid axle's beam with its wheels, kg·m², about
    /// its own centre (ADR-0028). Zero (the default) puts the axle's whole
    /// unsprung mass at the wheels, `2 m_u (t/2)²`; a housing and
    /// differential near the middle make it smaller, which raises the
    /// beam's roll (tramp) frequency above its hop. Solid axles with
    /// unsprung mass only.
    pub beam_roll_inertia: f64,
}

/// How the two wheels of an axle are held (ADR-0016).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub enum SuspensionKind {
    /// Each wheel on its own strut; the wheels lean with the body.
    #[default]
    Independent,
    /// A rigid beam between the wheels; the wheels stay upright to the
    /// line through the two contacts whatever the body does.
    Solid,
}

/// Largest anti-dive or anti-squat fraction a definition may set. Road cars
/// run 0 to about 0.5; beyond 1 the body moves against the load transfer,
/// and beyond 2 the links' jacking would dominate the springs.
pub const MAX_ANTI_PITCH: f64 = 2.0;

impl Default for SuspensionDef {
    fn default() -> Self {
        SuspensionDef::front_default()
    }
}

impl SuspensionDef {
    pub fn front_default() -> Self {
        Self {
            kind: SuspensionKind::Independent,
            spring_rate: 28000.0,
            bump_damping: 2500.0,
            rebound_damping: 3500.0,
            travel_bump: 0.08,
            travel_droop: 0.10,
            anti_roll_stiffness: 15000.0,
            bump_stop_stiffness: 300000.0,
            roll_center_height: 0.0,
            anti_brake: 0.0,
            anti_drive: 0.0,
            kinematics: None,
            unsprung_mass: 0.0,
            beam_roll_inertia: 0.0,
        }
    }

    pub fn rear_default() -> Self {
        Self {
            kind: SuspensionKind::Independent,
            spring_rate: 24000.0,
            bump_damping: 2200.0,
            rebound_damping: 3000.0,
            travel_bump: 0.09,
            travel_droop: 0.11,
            anti_roll_stiffness: 8000.0,
            bump_stop_stiffness: 300000.0,
            roll_center_height: 0.0,
            anti_brake: 0.0,
            anti_drive: 0.0,
            kinematics: None,
            unsprung_mass: 0.0,
            beam_roll_inertia: 0.0,
        }
    }

    pub fn validate(&self, prefix: &str, errors: &mut Vec<String>) {
        for (name, v) in [
            ("springRate", self.spring_rate),
            ("travelBump", self.travel_bump),
            ("travelDroop", self.travel_droop),
        ] {
            if !(v > 0.0) || !v.is_finite() {
                errors.push(format!(
                    "{prefix}.{name} must be a positive number (got {v})"
                ));
            }
        }
        for (name, v) in [
            ("bumpDamping", self.bump_damping),
            ("reboundDamping", self.rebound_damping),
            ("antiRollStiffness", self.anti_roll_stiffness),
            ("bumpStopStiffness", self.bump_stop_stiffness),
            ("unsprungMass", self.unsprung_mass),
            ("beamRollInertia", self.beam_roll_inertia),
        ] {
            if !(v >= 0.0) || !v.is_finite() {
                errors.push(format!(
                    "{prefix}.{name} must be zero or positive (got {v})"
                ));
            }
        }
        if self.beam_roll_inertia > 0.0
            && !(self.kind == SuspensionKind::Solid && self.unsprung_mass > 0.0)
        {
            errors.push(format!(
                "{prefix}.beamRollInertia applies only to a solid axle with unsprungMass (got {}); use 0",
                self.beam_roll_inertia
            ));
        }
        if !self.roll_center_height.is_finite()
            || m::abs(self.roll_center_height) > MAX_ROLL_CENTER_HEIGHT
        {
            errors.push(format!(
                "{prefix}.rollCenterHeight must be within ±1 m (got {})",
                self.roll_center_height
            ));
        }
        for (name, v) in [
            ("antiBrake", self.anti_brake),
            ("antiDrive", self.anti_drive),
        ] {
            if !v.is_finite() || m::abs(v) > MAX_ANTI_PITCH {
                errors.push(format!(
                    "{prefix}.{name} must be within ±{MAX_ANTI_PITCH} (got {v})"
                ));
            }
        }
    }
}

/// Largest static toe per wheel a definition may set, degrees. Road cars
/// run a few tenths of a degree; a few degrees is already an extreme
/// setting, and beyond ten the tire is scrubbing rather than rolling.
pub const MAX_STATIC_TOE_DEG: f64 = 10.0;

/// Largest static camber magnitude a definition may set, degrees.
pub const MAX_STATIC_CAMBER_DEG: f64 = 45.0;

/// Largest roll-centre height magnitude a definition may set, m.
pub const MAX_ROLL_CENTER_HEIGHT: f64 = 1.0;
/// Bound on `lateralComplianceSteerDeg`, deg/kN: a soft rubber-bushed axle
/// is a few tenths (ADR-0027).
pub const MAX_LATERAL_COMPLIANCE_STEER_DEG: f64 = 2.0;
/// Bound on `alignTorqueComplianceDeg`, deg/kN·m: a compliant
/// recirculating-ball system is near 10 (ADR-0027).
pub const MAX_ALIGN_TORQUE_COMPLIANCE_DEG: f64 = 30.0;
/// Bound on `powerAssistOnset`, N·m at the hand wheel: a heavy truck's
/// manual torque at the limit is about this (ADR-0029).
pub const MAX_POWER_ASSIST_ONSET: f64 = 20.0;

/// Largest `steering.columnDampingSpeed`, m/s.
pub const MAX_COLUMN_DAMPING_SPEED: f64 = 100.0;
/// Bounds on the steering axis angles, degrees (ADR-0030). Road cars run
/// about 10 to 15 of inclination and 3 to 8 of caster; a kart runs more.
pub const MAX_KINGPIN_INCLINATION_DEG: f64 = 25.0;
pub const MIN_CASTER_DEG: f64 = -10.0;
pub const MAX_CASTER_DEG: f64 = 20.0;

impl Default for AxleDef {
    fn default() -> Self {
        AxleDef::front_default()
    }
}

impl AxleDef {
    /// Check the travel curves (ADR-0025) against this axle's static values
    /// and suspension kind.
    pub fn validate_kinematics(&self, prefix: &str, errors: &mut Vec<String>) {
        let Some(k) = &self.suspension.kinematics else {
            return;
        };
        let s = &self.suspension;
        let solid = s.kind == SuspensionKind::Solid;
        for (name, curve, static_value, bound, angle) in [
            (
                "toeDeg",
                &k.toe_deg,
                self.static_toe_deg,
                MAX_STATIC_TOE_DEG,
                true,
            ),
            (
                "camberDeg",
                &k.camber_deg,
                self.static_camber_deg,
                MAX_STATIC_CAMBER_DEG,
                true,
            ),
            (
                "rollCenterHeight",
                &k.roll_center_height,
                s.roll_center_height,
                MAX_ROLL_CENTER_HEIGHT,
                false,
            ),
            (
                "antiBrake",
                &k.anti_brake,
                s.anti_brake,
                MAX_ANTI_PITCH,
                false,
            ),
            (
                "antiDrive",
                &k.anti_drive,
                s.anti_drive,
                MAX_ANTI_PITCH,
                false,
            ),
        ] {
            let Some(c) = curve else { continue };
            let path = format!("{prefix}.{name}");
            if angle && solid {
                errors.push(format!(
                    "{path} is not allowed on a solid axle; the beam sets the wheel angles (ADR-0016)"
                ));
                continue;
            }
            c.validate(&path, static_value, bound, errors);
        }
    }

    pub fn front_default() -> Self {
        Self {
            tire: TireModel::default(),
            wheel_inertia: 2.4,
            driven: true,
            steered: true,
            max_brake_torque: 3600.0,
            static_camber_deg: 0.0,
            static_toe_deg: 0.0,
            lateral_compliance_steer_deg: 0.0,
            track_width: 0.0,
            suspension: SuspensionDef::front_default(),
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
            static_toe_deg: 0.0,
            lateral_compliance_steer_deg: 0.0,
            track_width: 0.0,
            suspension: SuspensionDef::rear_default(),
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
    /// Ackermann fraction, 0 (parallel steer) to 1 (ideal Ackermann: the
    /// inner wheel steers more so both roll about the same centre). Four-wheel
    /// model only.
    pub ackermann: f64,
    /// Mechanical (caster) trail on the ground, m (ADR-0012). Acts on the
    /// lateral force like the pneumatic trail.
    pub mechanical_trail: f64,
    /// Scrub radius, m, positive with the contact outboard of the kingpin
    /// axis: a left to right difference in longitudinal force steers.
    pub scrub_radius: f64,
    /// Knuckle arm the rack pulls on, m; `RackForce` is the kingpin torque
    /// over this arm.
    pub steering_arm: f64,
    /// Fraction of the rack torque the power assist removes at the hand
    /// wheel, 0 (manual) … 1; with `power_assist_onset` set, the fraction it
    /// tends to at large torque.
    pub power_assist: f64,
    /// Boost curve (ADR-0029): the manual hand-wheel torque, N·m, around
    /// which the assist comes in. Well below it the wheel carries the full
    /// manual torque, as a real assist valve gives almost no help on centre;
    /// well above it the hand torque is `(1 − powerAssist)` of the manual
    /// torque plus `powerAssist × powerAssistOnset`. Zero (the default) is
    /// the constant fraction. 0 … 20.
    pub power_assist_onset: f64,
    /// Column friction, N·m at the hand wheel, for the force-feedback device
    /// (not simulated: the hand wheel is the input).
    pub column_friction: f64,
    /// Column damping, N·m per rad/s of hand-wheel rate, for the device.
    /// With `column_damping_speed` set, the damping at standstill.
    pub column_damping: f64,
    /// Speed-sensitive damping (ADR-0033): the column damping reached at
    /// `column_damping_speed` and held above it, N·m per rad/s, as an
    /// electric assist's active damping rises with speed so a released
    /// wheel settles at speed while parking stays light. Zero or positive.
    pub column_damping_at_speed: f64,
    /// The road speed at which `column_damping_at_speed` is reached, m/s;
    /// the damping is linear in speed below it. Zero (the default) keeps
    /// the damping constant at `column_damping`. 0 … 100.
    pub column_damping_speed: f64,
    /// Jacking: how far each front contact moves along its ray per radian of
    /// road-wheel steer, m/rad (inner wheel down, outer up). Zero for a car
    /// with suspension; a kart lifts its inner rear with it. Four-wheel
    /// model only.
    pub jacking_rate: f64,
    /// Aligning-torque compliance steer (ADR-0027): the steering system's
    /// compliance with the hand wheel held, degrees of road-wheel steer per
    /// kN·m of the steered axle's total kingpin torque. Both steered wheels
    /// turn by it in the direction the kingpin torque pushes them. Zero or
    /// positive; default 0.
    pub align_torque_compliance_deg: f64,
    /// Kingpin inclination, degrees, top of the axis inboard (ADR-0030).
    /// With `caster_deg` it sets how far the corner rises as the wheel steers,
    /// and the wheel's load pushes back toward centre through that lift: the
    /// self-centring that returns a parked car's wheel. Both zero (the
    /// default) leave the kingpin torque as it was. 0 … 25.
    pub kingpin_inclination_deg: f64,
    /// Caster angle, degrees, top of the axis rearward (ADR-0030). Sets the
    /// axis tilt for the steering lift only; the caster trail on the ground
    /// stays `mechanical_trail`. −10 … 20.
    pub caster_deg: f64,
}

impl Default for SteeringDef {
    fn default() -> Self {
        Self {
            max_wheel_angle_deg: 35.0,
            ratio: 14.0,
            ackermann: 1.0,
            mechanical_trail: 0.02,
            scrub_radius: 0.01,
            steering_arm: 0.12,
            power_assist: 0.0,
            power_assist_onset: 0.0,
            column_friction: 0.3,
            column_damping: 0.05,
            column_damping_at_speed: 0.0,
            column_damping_speed: 0.0,
            jacking_rate: 0.0,
            align_torque_compliance_deg: 0.0,
            kingpin_inclination_deg: 0.0,
            caster_deg: 0.0,
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
pub struct AeroDef {
    pub drag_coefficient: f64,
    /// Frontal area, m². The reference area of every coefficient here.
    pub frontal_area: f64,
    /// Air density, kg/m³.
    pub air_density: f64,
    /// Lift coefficient at the front axle, referenced to `frontalArea`
    /// (ADR-0015). Negative is downforce; a road car has a little lift, a
    /// winged car a lot of downforce.
    pub lift_coefficient_front: f64,
    /// Lift coefficient at the rear axle, referenced to `frontalArea`.
    pub lift_coefficient_rear: f64,
    /// Height of the drag's line of action above the centre of mass, m
    /// (ADR-0015). Drag acting above the centre of mass lifts the nose and
    /// moves load rearward at speed; zero puts it through the centre of
    /// mass.
    pub drag_height_above_cg: f64,
}

impl Default for AeroDef {
    fn default() -> Self {
        Self {
            drag_coefficient: 0.32,
            frontal_area: 2.2,
            air_density: crate::AIR_DENSITY,
            lift_coefficient_front: 0.0,
            lift_coefficient_rear: 0.0,
            drag_height_above_cg: 0.0,
        }
    }
}

impl AeroDef {
    /// Largest lift coefficient magnitude accepted, per axle.
    pub const MAX_LIFT_COEFFICIENT: f64 = 10.0;

    /// Dynamic pressure times the reference area, N per (m/s)²: the aero
    /// forces are this times the squared airspeed and a coefficient.
    #[inline]
    pub fn q_area(&self) -> f64 {
        0.5 * self.air_density * self.frontal_area
    }
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct SimulationDef {
    /// Internal substep rate, Hz.
    pub substep_rate_hz: f64,
    /// Which vehicle model runs this definition.
    pub model: VehicleModelKind,
}

impl Default for SimulationDef {
    fn default() -> Self {
        Self {
            substep_rate_hz: 1000.0,
            model: VehicleModelKind::FourWheel,
        }
    }
}

/// The vehicle models, selectable per definition. Both read the same
/// definition; the single-track model ignores suspension, inertia and
/// Ackermann fields.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub enum VehicleModelKind {
    /// Planar bicycle model on flat ground: cheap, analytic, no load
    /// transfer across the track. The level-of-detail model for traffic.
    SingleTrack,
    /// Four wheels on independent raycast suspension over a six-degree-of-
    /// freedom chassis proxy. The player-car model and the one hosts drive.
    #[default]
    FourWheel,
}

impl VehicleDefinition {
    /// Human-readable validation. Returns every problem found.
    pub fn validate(&self) -> Result<(), Vec<String>> {
        let mut e = Vec::new();
        if self.format_version != FORMAT_VERSION {
            e.push(format!(
                "formatVersion {} is not supported by this core (expected {}); run the migration in @skidpad/core first",
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
        if !(c.roll_inertia > 0.0) {
            e.push(format!(
                "chassis.rollInertia must be positive (got {})",
                c.roll_inertia
            ));
        }
        if !(c.pitch_inertia > 0.0) {
            e.push(format!(
                "chassis.pitchInertia must be positive (got {})",
                c.pitch_inertia
            ));
        }
        if !(c.track_width > 0.0) {
            e.push(format!(
                "chassis.trackWidth must be positive (got {})",
                c.track_width
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
            if !a.static_camber_deg.is_finite()
                || m::abs(a.static_camber_deg) > MAX_STATIC_CAMBER_DEG
            {
                e.push(format!(
                    "axles[{i}] ({name}).staticCamberDeg must be within ±45 (got {})",
                    a.static_camber_deg
                ));
            }
            if !(a.track_width >= 0.0) || !a.track_width.is_finite() {
                e.push(format!(
                    "axles[{i}] ({name}).trackWidth must be zero (use chassis.trackWidth) or positive (got {})",
                    a.track_width
                ));
            }
            if !a.static_toe_deg.is_finite() || m::abs(a.static_toe_deg) > MAX_STATIC_TOE_DEG {
                e.push(format!(
                    "axles[{i}] ({name}).staticToeDeg must be within ±{MAX_STATIC_TOE_DEG} (got {})",
                    a.static_toe_deg
                ));
            }
            if !a.lateral_compliance_steer_deg.is_finite()
                || m::abs(a.lateral_compliance_steer_deg) > MAX_LATERAL_COMPLIANCE_STEER_DEG
            {
                e.push(format!(
                    "axles[{i}] ({name}).lateralComplianceSteerDeg must be within ±{MAX_LATERAL_COMPLIANCE_STEER_DEG} deg/kN (got {})",
                    a.lateral_compliance_steer_deg
                ));
            }
            a.suspension
                .validate(&format!("axles[{i}] ({name}).suspension"), &mut e);
            a.validate_kinematics(
                &format!("axles[{i}] ({name}).suspension.kinematics"),
                &mut e,
            );
        }
        if self.axles.len() == 2 && c.mass > 0.0 && c.wheelbase > 0.0 {
            let unsprung: f64 = self
                .axles
                .iter()
                .map(|a| 2.0 * a.suspension.unsprung_mass)
                .sum();
            if unsprung > 0.0 && !(unsprung < 0.5 * c.mass) {
                e.push(format!(
                    "the four wheels' unsprungMass ({unsprung} kg) must be below half of chassis.mass ({} kg)",
                    c.mass
                ));
            }
            // Along up the body rolls and pitches with the wheels' share of
            // the inertias taken out (ADR-0028); keep a tenth of each.
            let x = [c.cg_to_front_axle, c.wheelbase - c.cg_to_front_axle];
            let (mut roll, mut pitch) = (0.0, 0.0);
            for (i, a) in self.axles.iter().enumerate() {
                let mu = a.suspension.unsprung_mass;
                roll += self.unsprung_roll_inertia(i);
                pitch += 2.0 * mu * x[i] * x[i];
            }
            if roll > 0.0 && !(roll <= 0.9 * c.roll_inertia) {
                e.push(format!(
                    "the wheels' unsprungMass at the track ({roll:.1} kg·m²) must leave at least a tenth of chassis.rollInertia ({} kg·m²) to the body",
                    c.roll_inertia
                ));
            }
            if pitch > 0.0 && !(pitch <= 0.9 * c.pitch_inertia) {
                e.push(format!(
                    "the wheels' unsprungMass at the axles ({pitch:.1} kg·m²) must leave at least a tenth of chassis.pitchInertia ({} kg·m²) to the body",
                    c.pitch_inertia
                ));
            }
            for (i, a) in self.axles.iter().enumerate() {
                let mu = a.suspension.unsprung_mass;
                if mu > 0.0 && !(mu * crate::GRAVITY < self.static_wheel_load(i)) {
                    e.push(format!(
                        "axles[{i}].suspension.unsprungMass ({mu} kg) must weigh less than the wheel's static load ({:.0} N)",
                        self.static_wheel_load(i)
                    ));
                }
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
        if !(0.0..=1.0).contains(&self.steering.ackermann) {
            e.push(format!(
                "steering.ackermann must be between 0 and 1 (got {})",
                self.steering.ackermann
            ));
        }
        if !(0.0..=1.0).contains(&self.steering.power_assist) {
            e.push(format!(
                "steering.powerAssist must be between 0 and 1 (got {})",
                self.steering.power_assist
            ));
        }
        if !(self.steering.steering_arm > 0.0) {
            e.push(format!(
                "steering.steeringArm must be positive (got {})",
                self.steering.steering_arm
            ));
        }
        for (name, v) in [
            ("mechanicalTrail", self.steering.mechanical_trail),
            ("scrubRadius", self.steering.scrub_radius),
            ("jackingRate", self.steering.jacking_rate),
        ] {
            if !v.is_finite() || m::abs(v) > 0.5 {
                e.push(format!("steering.{name} must be within ±0.5 m (got {v})"));
            }
        }
        let kpi = self.steering.kingpin_inclination_deg;
        if !(0.0..=MAX_KINGPIN_INCLINATION_DEG).contains(&kpi) {
            e.push(format!(
                "steering.kingpinInclinationDeg must be in [0, {MAX_KINGPIN_INCLINATION_DEG}] deg (got {kpi})"
            ));
        }
        let caster = self.steering.caster_deg;
        if !(MIN_CASTER_DEG..=MAX_CASTER_DEG).contains(&caster) {
            e.push(format!(
                "steering.casterDeg must be in [{MIN_CASTER_DEG}, {MAX_CASTER_DEG}] deg (got {caster})"
            ));
        }
        let onset = self.steering.power_assist_onset;
        if !(0.0..=MAX_POWER_ASSIST_ONSET).contains(&onset) {
            e.push(format!(
                "steering.powerAssistOnset must be in [0, {MAX_POWER_ASSIST_ONSET}] N·m (got {onset})"
            ));
        }
        let cds = self.steering.column_damping_speed;
        if !(0.0..=MAX_COLUMN_DAMPING_SPEED).contains(&cds) {
            e.push(format!(
                "steering.columnDampingSpeed must be in [0, {MAX_COLUMN_DAMPING_SPEED}] m/s (got {cds})"
            ));
        }
        let atc = self.steering.align_torque_compliance_deg;
        if !(0.0..=MAX_ALIGN_TORQUE_COMPLIANCE_DEG).contains(&atc) {
            e.push(format!(
                "steering.alignTorqueComplianceDeg must be in [0, {MAX_ALIGN_TORQUE_COMPLIANCE_DEG}] deg/kN·m (got {atc})"
            ));
        }
        for (name, v) in [
            ("columnFriction", self.steering.column_friction),
            ("columnDamping", self.steering.column_damping),
            (
                "columnDampingAtSpeed",
                self.steering.column_damping_at_speed,
            ),
        ] {
            if !(v >= 0.0) {
                e.push(format!(
                    "steering.{name} must be zero or positive (got {v})"
                ));
            }
        }
        self.drivetrain.validate("drivetrain", &mut e);
        self.assists.validate("assists", &mut e);
        if !(self.aero.drag_coefficient >= 0.0
            && self.aero.frontal_area >= 0.0
            && self.aero.air_density >= 0.0)
        {
            e.push(String::from("aero.dragCoefficient, aero.frontalArea and aero.airDensity must be zero or positive"));
        }
        for (name, v) in [
            ("liftCoefficientFront", self.aero.lift_coefficient_front),
            ("liftCoefficientRear", self.aero.lift_coefficient_rear),
        ] {
            if !v.is_finite() || m::abs(v) > AeroDef::MAX_LIFT_COEFFICIENT {
                e.push(format!(
                    "aero.{name} must be within ±{} (got {v})",
                    AeroDef::MAX_LIFT_COEFFICIENT
                ));
            }
        }
        if !self.aero.drag_height_above_cg.is_finite()
            || m::abs(self.aero.drag_height_above_cg) > 5.0
        {
            e.push(format!(
                "aero.dragHeightAboveCg must be within ±5 m (got {})",
                self.aero.drag_height_above_cg
            ));
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
            c.roll_inertia,
            c.pitch_inertia,
            c.wheelbase,
            c.cg_to_front_axle,
            c.cg_height,
            c.track_width,
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

    /// Kingpin torque of one steered wheel (ADR-0012): the tire's aligning
    /// moment, the mechanical trail on the lateral force, and the scrub
    /// radius on the longitudinal force. `side` is +1 left, −1 right (0 for
    /// the single-track model's lumped tire).
    #[inline]
    pub fn kingpin_torque(&self, mz: f64, fy: f64, fx: f64, side: f64) -> f64 {
        let st = &self.steering;
        mz - st.mechanical_trail * fy - side * st.scrub_radius * fx
    }

    /// Kingpin torque from the wheel's vertical load as it steers (ADR-0030),
    /// N·m about +z like [`Self::kingpin_torque`], for a wheel on `side`
    /// (+1 left) carrying `fz` at road-wheel angle `steer` (rad, from its
    /// straight-ahead position), of unloaded radius `radius`.
    ///
    /// Exact rigid-wheel geometry [DERIVED]: the wheel turns about the
    /// kingpin axis, which meets the ground `mechanical_trail` ahead of the
    /// contact and `scrub_radius` inboard of it, tilted inboard by the
    /// inclination and rearward by the caster. The lowest point of the
    /// turned wheel is `h(δ) = C_z − R·√(1 − a_z²)` above the ground, with
    /// `C` the wheel centre and `a` the axle direction after the rotation;
    /// the ground holds it at zero, so the corner rises by `−h`, and virtual
    /// work gives the torque `T = Fz · dh/dδ`. Inclination lowers `h` either
    /// way, a centring torque that grows with steer; caster lowers the
    /// inner wheel and raises the outer, opposite torques that cancel at
    /// equal loads. Zero when both angles are zero.
    pub fn kingpin_lift_torque(&self, fz: f64, steer: f64, side: f64, radius: f64) -> f64 {
        let st = &self.steering;
        if (st.kingpin_inclination_deg == 0.0 && st.caster_deg == 0.0) || !(fz > 0.0) {
            return 0.0;
        }
        // Work as a left wheel, y outboard; a right wheel is its mirror,
        // where steer and torque about z both change sign.
        let s = if side < 0.0 { -1.0 } else { 1.0 };
        let d = s * steer;
        let tl = m::tan(m::deg_to_rad(st.kingpin_inclination_deg));
        let tc = m::tan(m::deg_to_rad(st.caster_deg));
        let n = m::sqrt(1.0 + tl * tl + tc * tc);
        let u = Vec3::new(-tc / n, -tl / n, 1.0 / n);
        let p0 = Vec3::new(st.mechanical_trail, -st.scrub_radius, 0.0);
        let c = Vec3::new(0.0, 0.0, radius) - p0;
        let a = Vec3::new(0.0, 1.0, 0.0);
        let (sd, cd) = (m::sin(d), m::cos(d));
        // d/dδ of Rodrigues' v cos δ + (u × v) sin δ + u (u·v)(1 − cos δ).
        let drot = |v: Vec3| v * (-sd) + u.cross(v) * cd + u * (u.dot(v) * sd);
        let az = a.z * cd + u.cross(a).z * sd + u.z * (u.dot(a) * (1.0 - cd));
        let root = m::sqrt(m::max(1.0 - az * az, 1e-12));
        let dh = drot(c).z + radius * az * drot(a).z / root;
        s * fz * dh
    }

    /// Hand-wheel torque in the sign of the steer input (positive turns
    /// right) from a total kingpin torque, after the power assist.
    ///
    /// With a boost onset `T₀` (ADR-0029) the manual torque `Tm = −T_kp / ratio`
    /// becomes `(1 − a)·Tm + a·Tm / √(1 + (Tm/T₀)²)`: slope 1 on centre (no
    /// assist), slope `1 − a` at large torque, and rising everywhere, so the
    /// wheel never gets lighter as the load grows. Without an onset it is
    /// the constant fraction `(1 − a)·Tm`, bit for bit as before.
    #[inline]
    pub fn hand_wheel_torque(&self, kingpin_torque: f64) -> f64 {
        let a = self.steering.power_assist;
        let manual = -kingpin_torque / self.steering.ratio;
        let onset = self.steering.power_assist_onset;
        if !(onset > 0.0) {
            return (1.0 - a) * manual;
        }
        let x = manual / onset;
        (1.0 - a) * manual + a * manual / m::sqrt(1.0 + x * x)
    }

    /// The hand-wheel torque split by source (ADR-0031), N·m in the sign of
    /// the steer input: the aligning moment, the mechanical trail, the scrub
    /// radius and the steering lift, each through the ratio as
    /// [`Self::hand_wheel_torque`] would carry it without assist, then the
    /// torque the assist took away (`hand` less the manual torque). From the
    /// kingpin-torque `parts` in that order, about +z, summing to `kingpin`.
    /// The five sum to `hand` up to rounding.
    pub fn steering_parts(&self, parts: [f64; 4], kingpin: f64, hand: f64) -> [f64; 5] {
        let ratio = self.steering.ratio;
        [
            -parts[0] / ratio,
            -parts[1] / ratio,
            -parts[2] / ratio,
            -parts[3] / ratio,
            hand + kingpin / ratio,
        ]
    }

    /// Column damping for the device at road speed `speed` (m/s), N·m per
    /// rad/s of hand-wheel rate (ADR-0033): `column_damping` at rest,
    /// linear to `column_damping_at_speed` at `column_damping_speed` and
    /// held there; constant when that speed is zero.
    pub fn column_damping_at(&self, speed: f64) -> f64 {
        let st = &self.steering;
        if !(st.column_damping_speed > 0.0) {
            return st.column_damping;
        }
        let u = m::min(m::abs(speed) / st.column_damping_speed, 1.0);
        st.column_damping + u * (st.column_damping_at_speed - st.column_damping)
    }

    /// Which axles are driven, front then rear.
    pub fn driven_axles(&self) -> [bool; 2] {
        [
            self.axles.first().is_some_and(|a| a.driven),
            self.axles.get(1).is_some_and(|a| a.driven),
        ]
    }

    /// Track width of axle `axle`, m: its own, or the chassis track when it
    /// sets none.
    #[inline]
    pub fn axle_track(&self, axle: usize) -> f64 {
        match self.axles.get(axle) {
            Some(a) if a.track_width > 0.0 => a.track_width,
            _ => self.chassis.track_width,
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

    /// Static vertical load on one wheel of axle `axle` (0 front, 1 rear) on
    /// level ground, N.
    /// Roll inertia of axle `axle`'s unsprung mass about the body's roll
    /// axis through the axle's centre, kg·m² (ADR-0028): the wheels at the
    /// track, or a solid axle's beam inertia when it is set.
    pub fn unsprung_roll_inertia(&self, axle: usize) -> f64 {
        let s = &self.axles[axle].suspension;
        if s.kind == SuspensionKind::Solid && s.beam_roll_inertia > 0.0 {
            s.beam_roll_inertia
        } else {
            let y = 0.5 * self.axle_track(axle);
            2.0 * s.unsprung_mass * y * y
        }
    }

    /// Whether any axle carries unsprung mass (ADR-0028).
    pub fn has_unsprung_mass(&self) -> bool {
        self.axles.iter().any(|a| a.suspension.unsprung_mass > 0.0)
    }

    pub fn static_wheel_load(&self, axle: usize) -> f64 {
        let c = &self.chassis;
        let mg = c.mass * crate::GRAVITY;
        let share = if axle == 0 {
            self.cg_to_rear_axle() / c.wheelbase
        } else {
            c.cg_to_front_axle / c.wheelbase
        };
        0.5 * mg * share
    }
}
