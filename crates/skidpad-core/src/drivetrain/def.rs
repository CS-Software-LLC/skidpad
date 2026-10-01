//! Drivetrain definitions (ADR-0011): the power unit, the transmission and
//! the differentials. Plain data with defaults, validated before a vehicle
//! is built.

use skidpad_math as m;

/// Largest number of forward gears a transmission may define.
pub const MAX_GEARS: usize = 10;
/// Largest number of points in an engine torque curve.
pub const MAX_CURVE_POINTS: usize = 32;

pub const RPM_TO_RAD: f64 = m::TAU / 60.0;
pub const RAD_TO_RPM: f64 = 60.0 / m::TAU;

#[derive(Clone, Debug, PartialEq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct DrivetrainDef {
    pub power_unit: PowerUnitDef,
    pub transmission: TransmissionDef,
    /// Front axle differential (four-wheel model; the single-track model has
    /// one wheel per axle and ignores it).
    pub front: DifferentialDef,
    /// Rear axle differential.
    pub rear: DifferentialDef,
    /// Centre differential, used when both axles are driven.
    pub center: CenterDifferentialDef,
}

/// What turns the carrier.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(tag = "kind", rename_all = "camelCase"))]
pub enum PowerUnitDef {
    /// A torque law at the carrier with no state: the interim drive of
    /// milestones 1 to 3, kept as the default and as the cheap option for
    /// traffic.
    Direct(DirectDriveDef),
    /// Internal combustion engine with a torque curve, engine braking, an
    /// idle governor, a rev limiter and crank inertia.
    Combustion(CombustionEngineDef),
    /// Electric motor: constant torque to the base speed, constant power
    /// beyond it, regeneration on lift-off, rigidly coupled.
    Electric(ElectricMotorDef),
}

impl Default for PowerUnitDef {
    fn default() -> Self {
        PowerUnitDef::Direct(DirectDriveDef::default())
    }
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct DirectDriveDef {
    /// Carrier torque at full throttle and zero speed, N·m (the sum over the
    /// driven wheels, as before).
    pub max_wheel_torque: f64,
    /// Carrier speed at which the torque has faded to zero, rad/s.
    pub max_wheel_speed: f64,
}

impl Default for DirectDriveDef {
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
pub struct CombustionEngineDef {
    /// Idle speed, rpm.
    pub idle_rpm: f64,
    /// Rev limiter, rpm. The torque is cut smoothly over the last 2 %.
    pub redline_rpm: f64,
    /// Crank, flywheel and clutch cover inertia, kg·m².
    pub inertia: f64,
    /// Full-throttle (net brake) torque curve as `[rpm, N·m]` points in
    /// increasing rpm, interpolated linearly and held flat beyond the ends.
    pub torque_curve: Vec<[f64; 2]>,
    /// Closed-throttle drag torque at idle, N·m (friction and pumping).
    pub engine_braking_idle: f64,
    /// Closed-throttle drag torque at redline, N·m.
    pub engine_braking_redline: f64,
    /// Most torque the idle governor adds below idle, N·m. Stands in for a
    /// starter: the engine never stalls (ADR-0011).
    pub idle_torque_max: f64,
}

impl Default for CombustionEngineDef {
    fn default() -> Self {
        Self {
            idle_rpm: 850.0,
            redline_rpm: 6500.0,
            inertia: 0.25,
            // [ILLUSTRATIVE] a naturally aspirated 2 l four: ~180 N·m peak,
            // ~110 kW.
            torque_curve: vec![
                [1000.0, 120.0],
                [2000.0, 160.0],
                [3500.0, 180.0],
                [4500.0, 178.0],
                [5500.0, 165.0],
                [6500.0, 140.0],
            ],
            engine_braking_idle: 15.0,
            engine_braking_redline: 60.0,
            idle_torque_max: 60.0,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct ElectricMotorDef {
    /// Peak motor torque, N·m, available up to the base speed.
    pub max_torque: f64,
    /// Peak power, W; above the base speed the torque is `power / ω`.
    pub max_power: f64,
    /// Speed at which the torque has faded to zero, rpm.
    pub max_rpm: f64,
    /// Rotor inertia, kg·m².
    pub inertia: f64,
    /// Regenerative braking torque on a closed throttle, N·m, fading out
    /// below 5 % of `max_rpm`.
    pub regen_torque: f64,
}

impl Default for ElectricMotorDef {
    fn default() -> Self {
        Self {
            max_torque: 300.0,
            max_power: 150_000.0,
            max_rpm: 12_000.0,
            inertia: 0.05,
            regen_torque: 60.0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub enum TransmissionMode {
    /// Shifts on the gearbox input speed; a `gear` input of zero means drive.
    #[default]
    Automatic,
    /// Follows the `gear` input: negative reverse, zero neutral, positive
    /// gear number.
    Manual,
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct TransmissionDef {
    /// Forward gear ratios, first gear first (gearbox input turns per output
    /// turn). One entry is a single-speed transmission.
    pub gears: Vec<f64>,
    /// Reverse ratio magnitude; zero means no reverse.
    pub reverse: f64,
    /// Final drive ratio.
    pub final_drive: f64,
    pub mode: TransmissionMode,
    /// Torque interruption while changing gear, s.
    pub shift_time: f64,
    /// Time after a shift before the automatic may shift again, s.
    pub shift_hold: f64,
    /// Automatic upshift point as a fraction of redline, on the gearbox
    /// input speed.
    pub shift_up_at: f64,
    /// Automatic downshift point as a fraction of redline.
    pub shift_down_at: f64,
    /// Largest torque the clutch transmits when fully engaged, N·m.
    pub clutch_max_torque: f64,
    /// Time the clutch takes to re-engage after a shift, s.
    pub clutch_engage_time: f64,
    /// Automatic clutch (ADR-0011): the clutch bites from idle to this many
    /// rpm above idle. Zero disengages the automatic law (manual pedal only).
    pub clutch_bite_rpm: f64,
    /// Inertia of the gearbox input shaft and clutch disc, kg·m² (turns at
    /// the engine side of the ratio).
    pub input_inertia: f64,
    /// Inertia of the gearbox output and propshaft, kg·m² (turns at carrier
    /// speed).
    pub output_inertia: f64,
}

impl Default for TransmissionDef {
    fn default() -> Self {
        Self {
            gears: vec![1.0],
            reverse: 0.0,
            final_drive: 1.0,
            mode: TransmissionMode::Automatic,
            shift_time: 0.25,
            shift_hold: 0.5,
            shift_up_at: 0.9,
            shift_down_at: 0.45,
            clutch_max_torque: 400.0,
            clutch_engage_time: 0.3,
            clutch_bite_rpm: 1200.0,
            input_inertia: 0.05,
            output_inertia: 0.05,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub enum DifferentialKind {
    /// Equal torque to both outputs, speeds free.
    #[default]
    Open,
    /// A spool or solid axle: both outputs turn together.
    Locked,
    /// Clutch-pack limited slip with preload and torque bias ratios.
    Lsd,
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct DifferentialDef {
    pub kind: DifferentialKind,
    /// Locking torque with no carrier torque, N·m (LSD).
    pub preload: f64,
    /// Torque bias ratio under drive, ≥ 1 (LSD).
    pub bias_drive: f64,
    /// Torque bias ratio on the overrun, ≥ 1 (LSD).
    pub bias_coast: f64,
}

impl Default for DifferentialDef {
    fn default() -> Self {
        Self {
            kind: DifferentialKind::Open,
            preload: 0.0,
            bias_drive: 2.5,
            bias_coast: 1.5,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct CenterDifferentialDef {
    pub kind: DifferentialKind,
    /// Share of the carrier torque sent to the front axle when open, 0 … 1.
    pub front_torque_fraction: f64,
    pub preload: f64,
    pub bias_drive: f64,
    pub bias_coast: f64,
}

impl Default for CenterDifferentialDef {
    fn default() -> Self {
        Self {
            kind: DifferentialKind::Open,
            front_torque_fraction: 0.4,
            preload: 0.0,
            bias_drive: 2.0,
            bias_coast: 1.5,
        }
    }
}

impl DifferentialDef {
    fn validate(&self, prefix: &str, e: &mut Vec<String>) {
        validate_bias(prefix, self.preload, self.bias_drive, self.bias_coast, e);
    }
}

fn validate_bias(prefix: &str, preload: f64, drive: f64, coast: f64, e: &mut Vec<String>) {
    if !(preload >= 0.0) {
        e.push(format!(
            "{prefix}.preload must be zero or positive (got {preload})"
        ));
    }
    if !(drive >= 1.0) || !drive.is_finite() {
        e.push(format!(
            "{prefix}.biasDrive must be at least 1 (got {drive})"
        ));
    }
    if !(coast >= 1.0) || !coast.is_finite() {
        e.push(format!(
            "{prefix}.biasCoast must be at least 1 (got {coast})"
        ));
    }
}

impl DrivetrainDef {
    /// Human-readable validation, appended to `e`.
    pub fn validate(&self, prefix: &str, e: &mut Vec<String>) {
        match &self.power_unit {
            PowerUnitDef::Direct(d) => {
                if !(d.max_wheel_torque >= 0.0) {
                    e.push(format!(
                        "{prefix}.powerUnit.maxWheelTorque must be zero or positive (got {})",
                        d.max_wheel_torque
                    ));
                }
                if !(d.max_wheel_speed > 0.0) {
                    e.push(format!(
                        "{prefix}.powerUnit.maxWheelSpeed must be positive (got {})",
                        d.max_wheel_speed
                    ));
                }
            }
            PowerUnitDef::Combustion(c) => {
                if !(c.idle_rpm > 0.0) {
                    e.push(format!(
                        "{prefix}.powerUnit.idleRpm must be positive (got {})",
                        c.idle_rpm
                    ));
                }
                if !(c.redline_rpm > c.idle_rpm) {
                    e.push(format!(
                        "{prefix}.powerUnit.redlineRpm must exceed idleRpm (got {} vs {})",
                        c.redline_rpm, c.idle_rpm
                    ));
                }
                if !(c.inertia > 0.0) {
                    e.push(format!(
                        "{prefix}.powerUnit.inertia must be positive (got {})",
                        c.inertia
                    ));
                }
                if c.torque_curve.is_empty() || c.torque_curve.len() > MAX_CURVE_POINTS {
                    e.push(format!(
                        "{prefix}.powerUnit.torqueCurve needs 1 to {MAX_CURVE_POINTS} points (got {})",
                        c.torque_curve.len()
                    ));
                }
                for (i, p) in c.torque_curve.iter().enumerate() {
                    if !p[0].is_finite() || !p[1].is_finite() || p[0] < 0.0 {
                        e.push(format!(
                            "{prefix}.powerUnit.torqueCurve[{i}] must be finite with rpm ≥ 0"
                        ));
                    }
                    if i > 0 && !(p[0] > c.torque_curve[i - 1][0]) {
                        e.push(format!(
                            "{prefix}.powerUnit.torqueCurve[{i}] rpm must increase along the curve"
                        ));
                    }
                }
                for (name, v) in [
                    ("engineBrakingIdle", c.engine_braking_idle),
                    ("engineBrakingRedline", c.engine_braking_redline),
                    ("idleTorqueMax", c.idle_torque_max),
                ] {
                    if !(v >= 0.0) {
                        e.push(format!(
                            "{prefix}.powerUnit.{name} must be zero or positive (got {v})"
                        ));
                    }
                }
            }
            PowerUnitDef::Electric(el) => {
                for (name, v) in [
                    ("maxTorque", el.max_torque),
                    ("maxPower", el.max_power),
                    ("maxRpm", el.max_rpm),
                    ("inertia", el.inertia),
                ] {
                    if !(v > 0.0) {
                        e.push(format!(
                            "{prefix}.powerUnit.{name} must be positive (got {v})"
                        ));
                    }
                }
                if !(el.regen_torque >= 0.0) {
                    e.push(format!(
                        "{prefix}.powerUnit.regenTorque must be zero or positive (got {})",
                        el.regen_torque
                    ));
                }
            }
        }
        let t = &self.transmission;
        if t.gears.is_empty() || t.gears.len() > MAX_GEARS {
            e.push(format!(
                "{prefix}.transmission.gears needs 1 to {MAX_GEARS} ratios (got {})",
                t.gears.len()
            ));
        }
        for (i, g) in t.gears.iter().enumerate() {
            if !(*g > 0.0) || !g.is_finite() {
                e.push(format!(
                    "{prefix}.transmission.gears[{i}] must be positive (got {g})"
                ));
            }
        }
        if !(t.reverse >= 0.0) || !t.reverse.is_finite() {
            e.push(format!(
                "{prefix}.transmission.reverse must be zero or positive (got {})",
                t.reverse
            ));
        }
        if !(t.final_drive > 0.0) {
            e.push(format!(
                "{prefix}.transmission.finalDrive must be positive (got {})",
                t.final_drive
            ));
        }
        for (name, v) in [
            ("shiftTime", t.shift_time),
            ("shiftHold", t.shift_hold),
            ("clutchEngageTime", t.clutch_engage_time),
            ("clutchBiteRpm", t.clutch_bite_rpm),
            ("inputInertia", t.input_inertia),
            ("outputInertia", t.output_inertia),
        ] {
            if !(v >= 0.0) || !v.is_finite() {
                e.push(format!(
                    "{prefix}.transmission.{name} must be zero or positive (got {v})"
                ));
            }
        }
        if !(t.clutch_max_torque > 0.0) {
            e.push(format!(
                "{prefix}.transmission.clutchMaxTorque must be positive (got {})",
                t.clutch_max_torque
            ));
        }
        if !(t.shift_up_at > 0.0 && t.shift_up_at <= 1.05) {
            e.push(format!(
                "{prefix}.transmission.shiftUpAt must be in (0, 1.05] (got {})",
                t.shift_up_at
            ));
        }
        if !(t.shift_down_at >= 0.0 && t.shift_down_at < t.shift_up_at) {
            e.push(format!(
                "{prefix}.transmission.shiftDownAt must be below shiftUpAt (got {})",
                t.shift_down_at
            ));
        }
        self.front.validate(&format!("{prefix}.front"), e);
        self.rear.validate(&format!("{prefix}.rear"), e);
        let c = &self.center;
        validate_bias(
            &format!("{prefix}.center"),
            c.preload,
            c.bias_drive,
            c.bias_coast,
            e,
        );
        if !(c.front_torque_fraction > 0.0 && c.front_torque_fraction < 1.0) {
            e.push(format!(
                "{prefix}.center.frontTorqueFraction must be in (0, 1) (got {})",
                c.front_torque_fraction
            ));
        }
    }

    /// Whether the power unit has a speed of its own (engine or motor).
    pub fn has_engine(&self) -> bool {
        !matches!(self.power_unit, PowerUnitDef::Direct(_))
    }

    /// Redline in rad/s for the shift logic (electric: the motor's limit).
    pub fn redline(&self) -> f64 {
        match &self.power_unit {
            PowerUnitDef::Direct(d) => d.max_wheel_speed,
            PowerUnitDef::Combustion(c) => c.redline_rpm * RPM_TO_RAD,
            PowerUnitDef::Electric(e) => e.max_rpm * RPM_TO_RAD,
        }
    }

    /// Idle speed in rad/s (zero for motors and the direct drive).
    pub fn idle(&self) -> f64 {
        match &self.power_unit {
            PowerUnitDef::Combustion(c) => c.idle_rpm * RPM_TO_RAD,
            _ => 0.0,
        }
    }

    pub fn engine_inertia(&self) -> f64 {
        match &self.power_unit {
            PowerUnitDef::Direct(_) => 0.0,
            PowerUnitDef::Combustion(c) => c.inertia,
            PowerUnitDef::Electric(e) => e.inertia,
        }
    }
}
