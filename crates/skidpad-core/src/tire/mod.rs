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
#[derive(Clone, Copy, Debug, PartialEq)]
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
    /// Surface grip scale on the peak and sliding friction (ADR-0014), the
    /// Magic Formula's `λμ`. 1 on the surface the tire was parameterised on.
    pub grip: f64,
    /// Surface scale on the rolling resistance (ADR-0014).
    pub rolling_resistance: f64,
}

impl Default for TireInput {
    fn default() -> Self {
        Self {
            fz: 0.0,
            slip_ratio: 0.0,
            slip_angle: 0.0,
            camber: 0.0,
            vx: 0.0,
            grip: 1.0,
            rolling_resistance: 1.0,
        }
    }
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
    /// Longitudinal force at full sliding (the large-slip asymptote of the
    /// curve) at this load, N. Bounds the force a sliding contact patch can
    /// carry once low-speed damping is added (ADR-0010).
    pub fx_slide: f64,
    /// Lateral force at full sliding at this load, N.
    pub fy_slide: f64,
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

    /// Speed floor used for the kinematic slip (telemetry and the static
    /// deflection bound, ADR-0005, ADR-0010), m/s. It no longer sets any
    /// relaxation rate.
    #[inline]
    pub fn low_speed_floor(&self) -> f64 {
        match self {
            TireModel::Feel(p) => p.low_speed_floor,
            TireModel::MagicFormula(p) => p.low_speed_floor,
        }
    }

    /// Damping ratio of the contact-patch spring on the corner mass at
    /// standstill (ADR-0010).
    #[inline]
    pub fn low_speed_damping(&self) -> f64 {
        match self {
            TireModel::Feel(p) => p.low_speed_damping,
            TireModel::MagicFormula(p) => p.low_speed_damping,
        }
    }

    /// Rolling speed at which the low-speed damping has faded to zero, m/s
    /// (ADR-0010).
    #[inline]
    pub fn low_speed_damping_fade(&self) -> f64 {
        match self {
            TireModel::Feel(p) => p.low_speed_damping_fade,
            TireModel::MagicFormula(p) => p.low_speed_damping_fade,
        }
    }

    /// Low-speed damping coefficients `(c_x, c_y)`, N·s/m, for load `fz`
    /// and substep `dt` (ADR-0010; the published reference for low-speed
    /// damping on the contact-patch slip velocities is Pacejka §8.6
    /// [VERIFY]). The contact-patch deflection is a spring of rate
    /// `k = C / σ` (slip stiffness over relaxation length) on the corner
    /// mass `Fz / g`, so a damping ratio `ζ` needs `c = 2 ζ √(k Fz / g)`.
    ///
    /// The lateral coefficient, and the chassis side of the longitudinal
    /// one, act explicitly on the chassis proxy, so each is capped at
    /// `(Fz / g) / (2 dt)`, a quarter of the explicit stability limit of a
    /// damper on that mass; the cap only binds at very low substep rates.
    #[inline]
    pub fn low_speed_damping_coefficients(&self, fz: f64, dt: f64) -> (f64, f64) {
        let zeta = self.low_speed_damping();
        if zeta <= 0.0 || fz <= 0.0 {
            return (0.0, 0.0);
        }
        let (sigma_x, sigma_y) = self.relaxation_lengths();
        let corner_mass = fz / crate::GRAVITY;
        let cap = corner_mass / (2.0 * m::max(dt, 1e-6));
        let kx = m::max(self.longitudinal_stiffness(fz), 0.0) / m::max(sigma_x, 1e-6);
        let ky = m::max(self.cornering_stiffness(fz), 0.0) / m::max(sigma_y, 1e-6);
        (
            m::min(2.0 * zeta * m::sqrt(kx * corner_mass), cap),
            m::min(2.0 * zeta * m::sqrt(ky * corner_mass), cap),
        )
    }

    /// Bounds on the transient slips at standstill, `(κ, tan α)`: the
    /// contact-patch deflection may not wind up past the force peak, so a
    /// car pushed past its grip slides instead of storing more spring energy
    /// (ADR-0010). For the feel model these are the configured peaks; the
    /// Magic Formula has no closed-form peak, so typical passenger-car
    /// values are used (peaks near κ = 0.15 and α = 8°, Pacejka ch. 1).
    #[inline]
    pub fn static_slip_bounds(&self) -> (f64, f64) {
        match self {
            TireModel::Feel(p) => (
                m::max(p.peak_slip_ratio, 1e-4),
                m::tan(m::clamp(p.peak_slip_angle(), 1e-4, 0.785)),
            ),
            TireModel::MagicFormula(_) => (0.15, MF_STATIC_TAN_ALPHA_BOUND),
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
            ..TireInput::default()
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

/// `tan 8°`, the Magic Formula static lateral deflection bound.
const MF_STATIC_TAN_ALPHA_BOUND: f64 = 0.140_540_834_702_391_1;

/// Low-speed damping fade: 1 at rest, 0 at and above `fade_speed`, with a
/// smoothstep polynomial in between so the damping force has no kink at
/// either end (ADR-0010). No libm call.
#[inline]
pub fn low_speed_fade(vx: f64, fade_speed: f64) -> f64 {
    let s = m::clamp(m::abs(vx) / m::max(fade_speed, 1e-6), 0.0, 1.0);
    1.0 - s * s * (3.0 - 2.0 * s)
}

/// Clamp a planar force to the friction limit `f_max` (friction circle).
#[inline]
pub fn clamp_to_friction(fx: f64, fy: f64, f_max: f64) -> (f64, f64) {
    let mag = m::hypot(fx, fy);
    if mag > f_max && mag > 1e-12 {
        let s = f_max / mag;
        (fx * s, fy * s)
    } else {
        (fx, fy)
    }
}

/// Transient slip state for one tire: the contact-patch deflection of
/// Pacejka's first-order transient (ADR-0005, ADR-0010), stored as the
/// transient slip ratio `κ' = u / σx` and slip angle `α' = atan(v / σy)` so
/// that snapshots and telemetry keep their layout and meaning.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct TireTransient {
    pub slip_ratio: f64,
    pub slip_angle: f64,
}

impl TireTransient {
    /// Advance the contact-patch deflections over `dt`.
    ///
    /// The deflections obey (Pacejka, *Tire and Vehicle Dynamics*, ch. 7
    /// [VERIFY], the single-contact-point transient written in the
    /// deflection; Bernard & Clover, SAE 950311, for the low-speed case)
    ///
    /// ```text
    /// u̇ = (ω R − Vx) − (|Vx| / σx) · u,     κ' = u / σx
    /// v̇ = Vy − (|Vx| / σy) · v,             tan α' = v / σy
    /// ```
    ///
    /// At speed this is the usual relaxation of the transient slip toward
    /// the kinematic slip at rate `|Vx| / σ`. At `Vx = 0` the deflection
    /// integrates the slip velocity, so the tire is a spring and a parked
    /// car holds a static deflection instead of creeping.
    ///
    /// The update is linearly implicit (first-order Rosenbrock, Hairer &
    /// Wanner, *Solving ODEs II* [VERIFY]):
    /// `u_{n+1} = (u_n + dt · Vs) / (1 + dt · |Vx| / σ)`, unconditionally
    /// stable and monotone for any `dt`, with no `exp`.
    ///
    /// `kappa_bound` and `tan_alpha_bound` cap the deflections (ADR-0010):
    /// the spring cannot wind up past the force peak or past the floored
    /// kinematic slip, whichever is larger, so a car pushed past its grip
    /// slides at the curve's sliding force. At speed the cap never binds.
    #[inline]
    #[allow(clippy::too_many_arguments)]
    pub fn update(
        &mut self,
        slip_velocity_x: f64,
        vy: f64,
        vx: f64,
        dt: f64,
        sigma_long: f64,
        sigma_lat: f64,
        kappa_bound: f64,
        tan_alpha_bound: f64,
    ) {
        let sx = m::max(sigma_long, 1e-6);
        let sy = m::max(sigma_lat, 1e-6);
        let decay = m::abs(vx);
        let u = self.slip_ratio * sx;
        let v = m::tan(self.slip_angle) * sy;
        let u = (u + dt * slip_velocity_x) / (1.0 + dt * decay / sx);
        let v = (v + dt * vy) / (1.0 + dt * decay / sy);
        let kappa = m::clamp(u / sx, -kappa_bound, kappa_bound);
        let tan_alpha = m::clamp(v / sy, -tan_alpha_bound, tan_alpha_bound);
        self.slip_ratio = kappa;
        self.slip_angle = m::atan(tan_alpha);
    }

    /// Change of the transient slip ratio per unit of slip velocity within
    /// one step, s/m: `dκ'/dVs = dt / (σ + dt · |Vx|)`. Multiplied by the
    /// slip stiffness and the radius it is the tire force's sensitivity to
    /// wheel speed that the implicit wheel-spin integration needs
    /// (ADR-0005 item 3 as re-derived in ADR-0010).
    #[inline]
    pub fn deflection_gain(vx: f64, dt: f64, sigma: f64) -> f64 {
        dt / (m::max(sigma, 1e-6) + dt * m::abs(vx))
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
