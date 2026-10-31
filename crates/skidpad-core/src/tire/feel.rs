//! The "feel" tire model (ADR-0008): a Magic Formula curve shape driven by
//! intuitive parameters. Combined slip uses the resultant-slip method
//! (Milliken & Milliken, *Race Car Vehicle Dynamics*, ch. 2) applied to the
//! *theoretical* slips of the brush model, `σx = κ / (1 + κ)` and
//! `σy = tan α / (1 + κ)` (Pacejka, *Tire and Vehicle Dynamics*, 3rd ed.,
//! ch. 3, brush model; the `1 + κ` denominator is what makes a braked tire
//! lose lateral grip sooner than a driven one). Load sensitivity is a linear
//! drop in peak friction with load, and stiffness follows the saturating
//! load dependence `sin(2·atan(Fz / Fz_peak))` from Pacejka's lateral
//! stiffness formula.

use super::{TireInput, TireOutput};
use crate::curve::{FeelCurveShape, MagicCurve};
use skidpad_math as m;

/// Floor on the theoretical-slip denominator `1 + κ`. A locked wheel has
/// `κ = −1` (and a wheel spun backwards while moving forward has `κ < −1`),
/// where the theoretical slips are infinite. Below this floor both curves
/// are at their sliding asymptotes anyway, so the value only has to be small
/// enough that the resultant normalised slip is far past the peak (with the
/// default peaks it is above `10^9`) and large enough that its square cannot
/// overflow (`10^20` against an `f64` range of `10^308`); at `10^-9` the
/// pure braking curve at exactly `κ = −1` is reproduced to better than
/// `10^-10` relative. ADR-0008.
pub const THEORETICAL_SLIP_MIN_DENOM: f64 = 1e-9;

/// Floor on `1 − σ*` when mapping a driving theoretical slip back to a slip
/// ratio (`κ* = σ* / (1 − σ*)`). A resultant theoretical slip of one or more
/// corresponds to an infinite driving slip ratio; the floor caps `κ*` near
/// 1000, where the curve has long reached its asymptote. ADR-0008.
pub const KAPPA_STAR_MIN_DENOM: f64 = 1e-3;

/// Largest slip-angle magnitude fed to `tan` for the theoretical lateral
/// slip, rad (about 86°). Camber enters as a slip-angle shift and can push
/// the effective angle past 90°, where `tan` would flip sign; beyond this
/// clamp the lateral curve is at its asymptote regardless. ADR-0008.
pub const ALPHA_TAN_LIMIT: f64 = 1.5;

/// Range of `longitudinalFrictionRatio`. Measured road tires sit within
/// a few tens of percent of one either way; the range only rejects values
/// that are clearly a typo, such as a friction coefficient entered in place
/// of the ratio. ADR-0037.
pub const LONGITUDINAL_FRICTION_RATIO_MIN: f64 = 0.5;
pub const LONGITUDINAL_FRICTION_RATIO_MAX: f64 = 2.0;

/// Range of `trailReversal` the trail curve accepts. Zero would make the
/// shape factor infinite (the curve would collapse to zero for any slip), so
/// the depth is floored at a tenth of a percent, which is indistinguishable
/// from no reversal; above half of `t0` the lobe is deeper than any
/// published trail curve. ADR-0008.
pub const TRAIL_REVERSAL_MIN: f64 = 1e-3;
pub const TRAIL_REVERSAL_MAX: f64 = 0.5;

/// Largest `peakSlipRatio` the theoretical-slip normalisation accepts. The
/// braking peak `κp / (1 − κp)` needs `κp < 1`; definitions are validated to
/// stay below it and this clamp only protects the arithmetic.
const KAPPA_PEAK_MAX: f64 = 0.95;

/// Largest `peakSlipAngle` used for the lateral normalisation `tan αp`, rad
/// (45°). Definitions are validated to stay below it.
const ALPHA_PEAK_MAX: f64 = 0.785;

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct FeelTireParams {
    /// Unloaded radius, m.
    pub radius: f64,
    /// Load at which the friction and stiffness parameters are quoted, N.
    pub nominal_load: f64,
    /// Peak friction coefficient at the nominal load.
    pub peak_friction: f64,
    /// Peak longitudinal (braking and driving) friction as a multiple of
    /// `peakFriction`, which then sets the lateral peak only. Real tires
    /// usually grip a little more in braking than in cornering, which is why
    /// the Magic Formula carries the two peaks separately (`PDX1`, `PDY1`).
    /// One (the default) gives both directions the same peak. ADR-0037.
    pub longitudinal_friction_ratio: f64,
    /// Fractional drop in peak friction per unit of `(Fz − Fz0) / Fz0`.
    /// 0.1 means 10 % less friction at twice the nominal load.
    pub load_sensitivity: f64,
    /// Slip ratio at which longitudinal force peaks.
    pub peak_slip_ratio: f64,
    /// Slip angle at which lateral force peaks, degrees.
    pub peak_slip_angle_deg: f64,
    /// Longitudinal stiffness at the nominal load, normalised by load
    /// (`dFx/dκ / Fz0`).
    pub longitudinal_stiffness: f64,
    /// Cornering stiffness at the nominal load, normalised by load
    /// (`dFy/dα / Fz0`), 1/rad.
    pub cornering_stiffness: f64,
    /// Load at which stiffness is highest, N. Above it the stiffness per unit
    /// load falls, which is what makes a nose-heavy car understeer.
    pub stiffness_peak_load: f64,
    /// Sliding friction as a fraction of peak friction (longitudinal).
    pub falloff_long: f64,
    /// Sliding friction as a fraction of peak friction (lateral).
    pub falloff_lat: f64,
    /// Lateral force per radian of camber, normalised by load, 1/rad.
    pub camber_stiffness: f64,
    /// Pneumatic trail at zero slip, m.
    pub pneumatic_trail: f64,
    /// Equivalent slip angle at which the trail crosses zero, as a multiple
    /// of `peakSlipAngleDeg`. Steering torque peaks well before this and is
    /// zero here, which is the "going light" cue (ADR-0008 amendment B).
    pub trail_zero_crossing: f64,
    /// Depth of the negative trail lobe past the zero crossing, as a
    /// fraction of `pneumaticTrail`. Past the limit the steering torque
    /// reverses by this much of its peak scale.
    pub trail_reversal: f64,
    /// Lateral offset of the longitudinal force from the wheel centre plane
    /// per unit of `Fy / nominalLoad`, m. Adds `s · Fx` to the aligning
    /// moment, the Magic Formula `SSZ2` term. Zero (the default) disables it.
    pub fx_moment_arm: f64,
    /// Rolling resistance coefficient.
    pub rolling_resistance: f64,
    /// Longitudinal relaxation length, m.
    pub relaxation_length_long: f64,
    /// Lateral relaxation length, m; at the nominal load when
    /// `lateralRelaxationFollowsLoad` is set.
    pub relaxation_length_lat: f64,
    /// Scale the lateral relaxation length with the cornering stiffness, so
    /// it is `relaxationLengthLat` at the nominal load, longer above it and
    /// shorter below. The contact patch's lateral deflection is a spring of
    /// roughly constant carcass stiffness `CFy`, and `σα = Cα / CFy`
    /// (Pacejka, *Tire and Vehicle Dynamics*, ch. 7 [VERIFY]), which is
    /// also the load shape of the Magic Formula's `PTY1`/`PTY2`. Off (the
    /// default) keeps one length at every load. ADR-0038.
    pub lateral_relaxation_follows_load: bool,
    /// Speed floor for the kinematic slip, m/s (ADR-0005). Sets the
    /// telemetry slips and the static deflection bound at standstill; the
    /// deflection transient itself decays at the true rolling speed
    /// (ADR-0010).
    pub low_speed_floor: f64,
    /// Damping ratio of the contact-patch spring on the corner mass at
    /// standstill (ADR-0010). Zero leaves the standstill spring undamped,
    /// which rings for seconds when a parked car is nudged.
    pub low_speed_damping: f64,
    /// Rolling speed at which the low-speed damping has faded to zero, m/s
    /// (ADR-0010).
    pub low_speed_damping_fade: f64,
    /// Vertical stiffness of the tire, N/m (ADR-0028). Used only on an axle
    /// with unsprung mass, where the tire is a spring between the wheel and
    /// the road.
    pub vertical_stiffness: f64,
    /// Vertical damping of the tire, N·s/m (ADR-0028). Used only on an axle
    /// with unsprung mass.
    pub vertical_damping: f64,
}

impl Default for FeelTireParams {
    fn default() -> Self {
        Self {
            radius: 0.31,
            nominal_load: 4000.0,
            peak_friction: 1.0,
            longitudinal_friction_ratio: 1.0,
            load_sensitivity: 0.1,
            peak_slip_ratio: 0.12,
            peak_slip_angle_deg: 7.0,
            longitudinal_stiffness: 22.0,
            cornering_stiffness: 18.0,
            stiffness_peak_load: 8000.0,
            falloff_long: 0.85,
            falloff_lat: 0.85,
            camber_stiffness: 0.8,
            pneumatic_trail: 0.03,
            trail_zero_crossing: 1.0,
            trail_reversal: 0.1,
            fx_moment_arm: 0.0,
            rolling_resistance: 0.012,
            relaxation_length_long: 0.25,
            relaxation_length_lat: 0.35,
            lateral_relaxation_follows_load: false,
            low_speed_floor: 0.5,
            low_speed_damping: 0.7,
            low_speed_damping_fade: 2.0,
            vertical_stiffness: 250000.0,
            vertical_damping: 500.0,
        }
    }
}

/// The constants of a feel tire that do not depend on its inputs
/// ([`FeelTireParams::shape`]): five transcendental calls per evaluation
/// that a vehicle makes once.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FeelShape {
    /// `sin(2·atan(Fz0 / Fz_peak))`, the stiffness shape at the nominal load.
    at_nominal: f64,
    long: FeelCurveShape,
    lat: FeelCurveShape,
    /// `tan` of the peak slip angle, the lateral normalisation.
    tan_alpha_peak: f64,
}

impl FeelTireParams {
    /// Peak friction coefficient at a given load.
    #[inline]
    pub fn friction_at_load(&self, fz: f64) -> f64 {
        let fz0 = m::max(self.nominal_load, 1.0);
        let dfz = (fz - fz0) / fz0;
        m::max(
            self.peak_friction * (1.0 - self.load_sensitivity * dfz),
            0.05 * self.peak_friction,
        )
    }

    /// The load-independent constants of [`Self::eval`] and the stiffness
    /// functions. A vehicle works these out once per definition; the plain
    /// methods work them out on every call. Same results either way.
    pub fn shape(&self) -> FeelShape {
        let fz0 = m::max(self.nominal_load, 1.0);
        let fzk = m::max(self.stiffness_peak_load, 1.0);
        let alpha_peak = m::max(self.peak_slip_angle(), 1e-4);
        FeelShape {
            at_nominal: m::sin(2.0 * m::atan(fz0 / fzk)),
            long: FeelCurveShape::new(self.falloff_long),
            lat: FeelCurveShape::new(self.falloff_lat),
            tan_alpha_peak: m::tan(m::min(alpha_peak, ALPHA_PEAK_MAX)),
        }
    }

    /// Stiffness shape factor: 1 at the nominal load, rising then saturating
    /// at `stiffness_peak_load`.
    #[inline]
    fn stiffness_shape(&self, s: &FeelShape, fz: f64) -> f64 {
        let fz0 = m::max(self.nominal_load, 1.0);
        let fzk = m::max(self.stiffness_peak_load, 1.0);
        if s.at_nominal <= 1e-9 {
            return fz / fz0;
        }
        m::sin(2.0 * m::atan(fz / fzk)) / s.at_nominal
    }

    #[inline]
    pub fn longitudinal_stiffness(&self, fz: f64) -> f64 {
        self.longitudinal_stiffness_in(&self.shape(), fz)
    }

    #[inline]
    pub fn cornering_stiffness(&self, fz: f64) -> f64 {
        self.cornering_stiffness_in(&self.shape(), fz)
    }

    /// [`Self::longitudinal_stiffness`] with the constants from [`Self::shape`].
    #[inline]
    pub fn longitudinal_stiffness_in(&self, s: &FeelShape, fz: f64) -> f64 {
        self.longitudinal_stiffness * self.nominal_load * self.stiffness_shape(s, fz)
    }

    /// [`Self::cornering_stiffness`] with the constants from [`Self::shape`].
    #[inline]
    pub fn cornering_stiffness_in(&self, s: &FeelShape, fz: f64) -> f64 {
        self.cornering_stiffness * self.nominal_load * self.stiffness_shape(s, fz)
    }

    /// Both slip stiffnesses at load `fz`, `(Cκ, Cα)`, sharing the one
    /// load shape between them.
    #[inline]
    pub fn slip_stiffness_in(&self, s: &FeelShape, fz: f64) -> (f64, f64) {
        let shape = self.stiffness_shape(s, fz);
        (
            self.longitudinal_stiffness * self.nominal_load * shape,
            self.cornering_stiffness * self.nominal_load * shape,
        )
    }

    /// Lateral relaxation length for cornering stiffness `ky` (from
    /// [`Self::cornering_stiffness`] at the load in question), m.
    #[inline]
    pub fn relaxation_length_lat_with(&self, ky: f64) -> f64 {
        if !self.lateral_relaxation_follows_load {
            return self.relaxation_length_lat;
        }
        let ky0 = self.cornering_stiffness * self.nominal_load;
        if ky0 <= 0.0 {
            return self.relaxation_length_lat;
        }
        self.relaxation_length_lat * m::max(ky, 0.0) / ky0
    }

    #[inline]
    pub fn peak_slip_angle(&self) -> f64 {
        m::deg_to_rad(self.peak_slip_angle_deg)
    }

    pub fn eval(&self, i: &TireInput) -> TireOutput {
        self.eval_in(&self.shape(), i)
    }

    /// [`Self::eval`] with the constants from [`Self::shape`].
    pub fn eval_in(&self, shape: &FeelShape, i: &TireInput) -> TireOutput {
        self.eval_with(shape, self.slip_stiffness_in(shape, i.fz), i)
    }

    /// [`Self::eval_in`] with the slip stiffnesses at `i.fz` from
    /// [`Self::slip_stiffness_in`].
    pub fn eval_with(&self, shape: &FeelShape, (kx, ky): (f64, f64), i: &TireInput) -> TireOutput {
        let fz = i.fz;
        if fz <= 0.0 {
            return TireOutput::default();
        }
        // The surface scales the friction the way the Magic Formula's `λμ`
        // does (ADR-0014): the stiffness is unchanged, so a slippery surface
        // peaks at a smaller slip, as a tire on ice does.
        let mu = self.friction_at_load(fz) * m::max(i.grip, 0.0);
        let peak = mu * fz;
        let peak_x = peak * self.longitudinal_friction_ratio;
        let kappa_peak = m::max(self.peak_slip_ratio, 1e-4);
        let alpha_peak = m::max(self.peak_slip_angle(), 1e-4);

        let cx = MagicCurve::from_feel_shape(peak_x, kx, kappa_peak, shape.long);
        let cy = MagicCurve::from_feel_shape(peak, ky, alpha_peak, shape.lat);

        // Camber thrust enters as an equivalent slip-angle shift so that it is
        // subject to the same saturation as the slip-angle force.
        let camber_force = self.camber_stiffness * fz * i.camber;
        let alpha_eff = i.slip_angle - camber_force / m::max(ky, 1e-9);

        // Theoretical slips of the brush model (Pacejka ch. 3):
        //   σx = κ / (1 + s·κ),   σy = tan α / (1 + s·κ),
        // where `s` is the direction of travel: +1 rolling forward, −1 in
        // reverse (theoretical slip assumes forward rolling, and in reverse
        // the kinematic slip ratio has the opposite sign for the same
        // physical situation, so braking while reversing then behaves like
        // braking forward). The sign is taken smoothly over ±lowSpeedFloor
        // rather than switched at zero: a parked car's velocity crosses
        // zero endlessly, and a hard switch stepped the combined-slip force
        // by a fraction of a percent at each crossing, which was enough to
        // keep a limit cycle alive on a cross slope (ADR-0010). At s = 0 the
        // theoretical slips reduce to the plain slips, which is symmetric.
        let dir = m::clamp(i.vx / m::max(self.low_speed_floor, 1e-6), -1.0, 1.0);
        let kappa = i.slip_ratio;
        let denom = m::max(1.0 + dir * kappa, THEORETICAL_SLIP_MIN_DENOM);
        let alpha_t = m::clamp(alpha_eff, -ALPHA_TAN_LIMIT, ALPHA_TAN_LIMIT);
        let sigma_x = kappa / denom;
        let sigma_y = m::tan(alpha_t) / denom;

        // Normalise by the peak theoretical slips, specific to whether the
        // longitudinal slip is driving or braking so that `peakSlipRatio`
        // marks the peak in both: σx,peak = κp / (1 + s·sign(κ)·κp), which is
        // κp / (1 + κp) driving and κp / (1 − κp) braking; σy,peak = tan αp.
        let kp = m::min(kappa_peak, KAPPA_PEAK_MAX);
        let kappa_sign = if kappa < 0.0 { -1.0 } else { 1.0 };
        let sigma_x_peak = kp / (1.0 + dir * kappa_sign * kp);
        let sigma_y_peak = shape.tan_alpha_peak;
        let sx = sigma_x / sigma_x_peak;
        let sy = sigma_y / sigma_y_peak;
        let s = m::hypot(sx, sy);
        let (fx, fy) = if s < 1e-9 {
            (kx * kappa, -ky * alpha_eff)
        } else {
            // Each pure-slip curve is evaluated at the slip whose own
            // normalised theoretical slip equals the resultant `s`, so that
            // pure slip reproduces the pure curve exactly:
            //   longitudinal: |σ*| = s · σx,peak, mapped back through the
            //     inverse of σ = κ / (1 + s·κ), which is κ = σ / (1 − s·σ);
            //     for pure slip that is κ itself;
            //   lateral: α* = atan(s · tan αp).
            // Evaluating at `s · κp` instead would scale the initial
            // longitudinal stiffness by `1 ± κp`.
            let sigma_mag = s * sigma_x_peak;
            let kappa_mag =
                sigma_mag / m::max(1.0 - dir * kappa_sign * sigma_mag, KAPPA_STAR_MIN_DENOM);
            let alpha_mag = m::atan(s * sigma_y_peak);
            // Direction cosines in normalised slip space (Milliken ch. 2).
            // At full sliding this direction differs from the slip velocity
            // by the ratio of the two normalisations; ADR-0008 records the
            // size of that error and the fix if it ever matters.
            let fx = (sx / s) * cx.eval(kappa_mag);
            let fy = -(sy / s) * cy.eval(alpha_mag);
            (fx, fy)
        };

        // Pneumatic trail. The published reference shape is the Magic
        // Formula cosine trail `Dt·cos(Ct·atan(Bt·α_t,eq − …))` (Pacejka ch. 4,
        // eq. 4.E42 [VERIFY]), which falls from `t0`, crosses zero near the
        // lateral peak, dips negative and returns toward zero; Milliken &
        // Milliken ch. 2 describe the same shape against slip angle. The feel
        // model uses a libm-free curve with the same features [DERIVED]:
        //   trail = t0 · (1 − x²) / (1 + k·x⁴),   x = α_t,eq / (c·αp),
        // where `c` is `trailZeroCrossing` and `k` sets the lobe depth: the
        // deepest point is at x² = 1 + √(1 + 1/k) with value −(√(1 + 1/k) − 1)/2
        // of t0, so a depth D (`trailReversal`) needs k = 1 / (4·D·(1 + D))
        // [DERIVED]. Below the crossing it is close to the quadratic
        // `t0·(1 − x²)` the model used before.
        //
        // Combined slip enters through the MF 5.2 equivalent slip angle
        // `α_t,eq = sign(α)·√(α² + (Kx/Ky)²·κ²)` (Pacejka 2nd ed. eq. 4.E77
        // [VERIFY]; MF 6.1 uses the atan/tan variant that `magic_formula.rs`
        // implements). Only its square is needed here, so the sign is moot.
        let stiffness_ratio = kx / m::max(ky, 1e-9);
        let alpha_eq_sq = alpha_eff * alpha_eff + stiffness_ratio * stiffness_ratio * kappa * kappa;
        let crossing = m::max(self.trail_zero_crossing, 1e-3) * alpha_peak;
        let x2 = alpha_eq_sq / (crossing * crossing);
        let depth = m::clamp(self.trail_reversal, TRAIL_REVERSAL_MIN, TRAIL_REVERSAL_MAX);
        let k = 1.0 / (4.0 * depth * (1.0 + depth));
        let trail = self.pneumatic_trail * (1.0 - x2) / (1.0 + k * x2 * x2);
        // Contact-patch shift of the longitudinal force: `Mz += s·Fx` with
        // `s = R0·SSZ2·(Fy/Fz0)` in the Magic Formula (eq. 4.E76 [VERIFY]);
        // here `fxMomentArm` plays the part of `R0·SSZ2`.
        let arm = self.fx_moment_arm * (fy / m::max(self.nominal_load, 1.0));
        let mz = -trail * fy + arm * fx;

        // Rolling resistance moment opposes rolling; it goes smoothly through
        // zero below the speed floor so a parked car never sees a
        // sign-switching torque (ADR-0005).
        let my = -m::clamp(i.vx / m::max(self.low_speed_floor, 1e-6), -1.0, 1.0)
            * self.rolling_resistance
            * m::max(i.rolling_resistance, 0.0)
            * fz
            * self.radius;

        TireOutput {
            fx,
            fy,
            mz,
            mx: 0.0,
            my,
            trail,
            fx_max: peak_x,
            fy_max: peak,
            fx_slide: m::clamp(self.falloff_long, 0.05, 1.0) * peak_x,
            fy_slide: m::clamp(self.falloff_lat, 0.05, 1.0) * peak,
        }
    }

    pub fn validate(&self, prefix: &str, errors: &mut Vec<String>) {
        let positive = [
            ("radius", self.radius),
            ("nominalLoad", self.nominal_load),
            ("peakFriction", self.peak_friction),
            ("peakSlipRatio", self.peak_slip_ratio),
            ("peakSlipAngleDeg", self.peak_slip_angle_deg),
            ("longitudinalStiffness", self.longitudinal_stiffness),
            ("corneringStiffness", self.cornering_stiffness),
            ("stiffnessPeakLoad", self.stiffness_peak_load),
            ("relaxationLengthLong", self.relaxation_length_long),
            ("relaxationLengthLat", self.relaxation_length_lat),
            ("lowSpeedFloor", self.low_speed_floor),
            ("lowSpeedDampingFade", self.low_speed_damping_fade),
            ("verticalStiffness", self.vertical_stiffness),
        ];
        for (name, v) in positive {
            if !(v > 0.0) || !v.is_finite() {
                errors.push(format!(
                    "{prefix}.{name} must be a positive number (got {v})"
                ));
            }
        }
        for (name, v) in [
            ("falloffLong", self.falloff_long),
            ("falloffLat", self.falloff_lat),
        ] {
            if !(v > 0.0 && v <= 1.0) {
                errors.push(format!("{prefix}.{name} must be in (0, 1] (got {v})"));
            }
        }
        if self.peak_slip_ratio.is_finite() && self.peak_slip_ratio >= 1.0 {
            errors.push(format!(
                "{prefix}.peakSlipRatio must be below 1 (got {}); the braking peak of the theoretical slip is κp / (1 − κp)",
                self.peak_slip_ratio
            ));
        }
        if self.peak_slip_angle_deg.is_finite() && self.peak_slip_angle_deg > 45.0 {
            errors.push(format!(
                "{prefix}.peakSlipAngleDeg must be at most 45 (got {})",
                self.peak_slip_angle_deg
            ));
        }
        if !(self.longitudinal_friction_ratio >= LONGITUDINAL_FRICTION_RATIO_MIN
            && self.longitudinal_friction_ratio <= LONGITUDINAL_FRICTION_RATIO_MAX)
        {
            errors.push(format!(
                "{prefix}.longitudinalFrictionRatio must be in [{LONGITUDINAL_FRICTION_RATIO_MIN}, {LONGITUDINAL_FRICTION_RATIO_MAX}] (got {})",
                self.longitudinal_friction_ratio
            ));
        }
        if !(0.0..1.0).contains(&self.load_sensitivity) {
            errors.push(format!(
                "{prefix}.loadSensitivity must be in [0, 1) (got {})",
                self.load_sensitivity
            ));
        }
        if !(self.trail_zero_crossing > 0.0 && self.trail_zero_crossing <= 5.0) {
            errors.push(format!(
                "{prefix}.trailZeroCrossing must be in (0, 5] multiples of the peak slip angle (got {})",
                self.trail_zero_crossing
            ));
        }
        if !(self.trail_reversal >= 0.0 && self.trail_reversal <= TRAIL_REVERSAL_MAX) {
            errors.push(format!(
                "{prefix}.trailReversal must be in [0, {TRAIL_REVERSAL_MAX}] of the trail at zero slip (got {})",
                self.trail_reversal
            ));
        }
        if !self.fx_moment_arm.is_finite() || m::abs(self.fx_moment_arm) > 1.0 {
            errors.push(format!(
                "{prefix}.fxMomentArm must be within ±1 m (got {})",
                self.fx_moment_arm
            ));
        }
        for (name, v) in [
            ("camberStiffness", self.camber_stiffness),
            ("pneumaticTrail", self.pneumatic_trail),
            ("rollingResistance", self.rolling_resistance),
            ("lowSpeedDamping", self.low_speed_damping),
            ("verticalDamping", self.vertical_damping),
        ] {
            if !(v >= 0.0) || !v.is_finite() {
                errors.push(format!(
                    "{prefix}.{name} must be zero or positive (got {v})"
                ));
            }
        }
    }
}
