//! Tire models behind a single interface.
//!
//! Sign conventions are ISO 8855 (ADR-0007): x forward, y left, z up. Slip
//! ratio is positive when driving and gives positive `fx`; slip angle is
//! positive when the contact patch moves toward +y and gives *negative* `fy`.
//! Aligning moment is positive about +z.

pub mod feel;
pub mod magic_formula;
pub mod tir;

use skidpad_math as m;

pub use feel::FeelTireParams;
pub use magic_formula::MagicFormulaParams;

/// Inputs to a tire evaluation. All in SI, ISO sign convention.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct TireInput {
    /// Vertical load, N. Non-positive loads give zero output.
    pub fz: f64,
    /// Longitudinal slip ratio (transient, after relaxation).
    pub slip_ratio: f64,
    /// Slip angle, rad (transient, after relaxation).
    pub slip_angle: f64,
    /// Camber (inclination) angle, rad. Positive when the top leans to +y.
    pub camber: f64,
    /// Forward speed of the wheel centre, m/s. Used for rolling resistance.
    pub vx: f64,
}

/// Forces and moments at the contact patch, plus a few derived values that
/// the telemetry and debug drawing need.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct TireOutput {
    /// Longitudinal force, N (+x forward).
    pub fx: f64,
    /// Lateral force, N (+y left).
    pub fy: f64,
    /// Aligning moment, N·m (+z).
    pub mz: f64,
    /// Overturning moment, N·m (+x).
    pub mx: f64,
    /// Rolling resistance moment, N·m (+y). Always opposes rolling.
    pub my: f64,
    /// Pneumatic trail, m. Positive behind the contact centre.
    pub trail: f64,
    /// Peak available longitudinal force at this load, N (friction circle).
    pub fx_max: f64,
    /// Peak available lateral force at this load, N (friction circle).
    pub fy_max: f64,
}

/// A tire model. Everything downstream is model-agnostic.
// The Magic Formula parameter block is much larger than the feel block, but
// both are configuration (read-only in the step) and boxing would move them
// out of the vehicle's contiguous memory for no benefit.
#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(tag = "model", rename_all = "camelCase"))]
pub enum TireModel {
    Feel(FeelTireParams),
    MagicFormula(MagicFormulaParams),
}

impl Default for TireModel {
    fn default() -> Self {
        TireModel::Feel(FeelTireParams::default())
    }
}

impl TireModel {
    #[inline]
    pub fn eval(&self, input: &TireInput) -> TireOutput {
        match self {
            TireModel::Feel(p) => p.eval(input),
            TireModel::MagicFormula(p) => p.eval(input),
        }
    }

    /// Longitudinal and lateral relaxation lengths, m.
    #[inline]
    pub fn relaxation_lengths(&self) -> (f64, f64) {
        match self {
            TireModel::Feel(p) => (p.relaxation_length_long, p.relaxation_length_lat),
            TireModel::MagicFormula(p) => (p.relaxation_length_long, p.relaxation_length_lat),
        }
    }

    /// Speed floor used for slip computation and relaxation (ADR-0005), m/s.
    #[inline]
    pub fn low_speed_floor(&self) -> f64 {
        match self {
            TireModel::Feel(p) => p.low_speed_floor,
            TireModel::MagicFormula(p) => p.low_speed_floor,
        }
    }

    /// Slope of `fx` with respect to slip ratio at the origin for the given
    /// load, N. Used by the implicit wheel-spin integration as a conservative
    /// (upper-bound) stiffness.
    #[inline]
    pub fn longitudinal_stiffness(&self, fz: f64) -> f64 {
        match self {
            TireModel::Feel(p) => p.longitudinal_stiffness(fz),
            TireModel::MagicFormula(p) => p.longitudinal_stiffness(fz),
        }
    }

    /// Slope of `−fy` with respect to slip angle at the origin, N/rad.
    #[inline]
    pub fn cornering_stiffness(&self, fz: f64) -> f64 {
        match self {
            TireModel::Feel(p) => p.cornering_stiffness(fz),
            TireModel::MagicFormula(p) => p.cornering_stiffness(fz),
        }
    }

    /// Pneumatic trail at (nearly) zero slip for the given load, m. Evaluated
    /// numerically so both models answer the same question.
    #[inline]
    pub fn static_trail(&self, fz: f64) -> f64 {
        self.eval(&TireInput {
            fz,
            slip_ratio: 0.0,
            slip_angle: 1e-4,
            camber: 0.0,
            vx: 10.0,
        })
        .trail
    }

    /// Unloaded radius, m.
    #[inline]
    pub fn unloaded_radius(&self) -> f64 {
        match self {
            TireModel::Feel(p) => p.radius,
            TireModel::MagicFormula(p) => p.unloaded_radius,
        }
    }

    pub fn validate(&self, prefix: &str, errors: &mut Vec<String>) {
        match self {
            TireModel::Feel(p) => p.validate(prefix, errors),
            TireModel::MagicFormula(p) => p.validate(prefix, errors),
        }
    }
}

/// Transient (relaxation-length) slip state for one tire (ADR-0005).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct TireTransient {
    pub slip_ratio: f64,
    pub slip_angle: f64,
}

impl TireTransient {
    /// Relax the transient slips toward the kinematic slips over `dt` with
    /// time constant `σ / V_eff`, where `V_eff = max(|vx|, floor)`.
    ///
    /// The update is the exact solution of the first-order lag, so it is
    /// unconditionally stable for any `dt`.
    #[inline]
    #[allow(clippy::too_many_arguments)]
    pub fn relax(
        &mut self,
        kinematic_ratio: f64,
        kinematic_angle: f64,
        vx: f64,
        dt: f64,
        sigma_long: f64,
        sigma_lat: f64,
        floor: f64,
    ) {
        let v = m::max(m::abs(vx), floor);
        let ax = 1.0 - m::exp(-v * dt / m::max(sigma_long, 1e-6));
        let ay = 1.0 - m::exp(-v * dt / m::max(sigma_lat, 1e-6));
        self.slip_ratio += (kinematic_ratio - self.slip_ratio) * ax;
        self.slip_angle += (kinematic_angle - self.slip_angle) * ay;
    }

    /// Fraction of a kinematic slip change that reaches the transient state
    /// within one step. Used by the implicit wheel-spin integration.
    #[inline]
    pub fn response_fraction(vx: f64, dt: f64, sigma: f64, floor: f64) -> f64 {
        let v = m::max(m::abs(vx), floor);
        1.0 - m::exp(-v * dt / m::max(sigma, 1e-6))
    }
}

/// Kinematic slip ratio and slip angle from contact-patch velocities in the
/// wheel frame (ADR-0005, ADR-0007).
///
/// * `vx`, `vy` – velocity of the wheel centre relative to the road, in the
///   wheel frame.
/// * `omega` – wheel angular velocity, rad/s (positive rolling forward).
/// * `re` – effective rolling radius, m.
#[inline]
pub fn kinematic_slip(vx: f64, vy: f64, omega: f64, re: f64, floor: f64) -> (f64, f64) {
    let denom = m::max(m::abs(vx), floor);
    let kappa = (omega * re - vx) / denom;
    let alpha = m::atan2(vy, denom);
    (kappa, alpha)
}
