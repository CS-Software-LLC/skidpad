//! The "feel" tire model (ADR-0008): a Magic Formula curve shape driven by
//! intuitive parameters. Combined slip uses the resultant-slip method
//! (Milliken & Milliken, *Race Car Vehicle Dynamics*, ch. 2), load
//! sensitivity is a linear drop in peak friction with load, and stiffness
//! follows the saturating load dependence `sin(2·atan(Fz / Fz_peak))` from
//! Pacejka's lateral stiffness formula.

use super::{TireInput, TireOutput};
use crate::curve::MagicCurve;
use skidpad_math as m;

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
    /// Rolling resistance coefficient.
    pub rolling_resistance: f64,
    /// Longitudinal relaxation length, m.
    pub relaxation_length_long: f64,
    /// Lateral relaxation length, m.
    pub relaxation_length_lat: f64,
    /// Speed floor for slip computation and relaxation, m/s (ADR-0005).
    pub low_speed_floor: f64,
}

impl Default for FeelTireParams {
    fn default() -> Self {
        Self {
            radius: 0.31,
            nominal_load: 4000.0,
            peak_friction: 1.0,
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
            rolling_resistance: 0.012,
            relaxation_length_long: 0.25,
            relaxation_length_lat: 0.35,
            low_speed_floor: 0.5,
        }
    }
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

    /// Stiffness shape factor: 1 at the nominal load, rising then saturating
    /// at `stiffness_peak_load`.
    #[inline]
    fn stiffness_shape(&self, fz: f64) -> f64 {
        let fz0 = m::max(self.nominal_load, 1.0);
        let fzk = m::max(self.stiffness_peak_load, 1.0);
        let at_nominal = m::sin(2.0 * m::atan(fz0 / fzk));
        if at_nominal <= 1e-9 {
            return fz / fz0;
        }
        m::sin(2.0 * m::atan(fz / fzk)) / at_nominal
    }

    #[inline]
    pub fn longitudinal_stiffness(&self, fz: f64) -> f64 {
        self.longitudinal_stiffness * self.nominal_load * self.stiffness_shape(fz)
    }

    #[inline]
    pub fn cornering_stiffness(&self, fz: f64) -> f64 {
        self.cornering_stiffness * self.nominal_load * self.stiffness_shape(fz)
    }

    #[inline]
    pub fn peak_slip_angle(&self) -> f64 {
        m::deg_to_rad(self.peak_slip_angle_deg)
    }

    pub fn eval(&self, i: &TireInput) -> TireOutput {
        let fz = i.fz;
        if fz <= 0.0 {
            return TireOutput::default();
        }
        let mu = self.friction_at_load(fz);
        let peak = mu * fz;
        let kx = self.longitudinal_stiffness(fz);
        let ky = self.cornering_stiffness(fz);
        let kappa_peak = m::max(self.peak_slip_ratio, 1e-4);
        let alpha_peak = m::max(self.peak_slip_angle(), 1e-4);

        let cx = MagicCurve::from_feel(peak, kx, kappa_peak, self.falloff_long);
        let cy = MagicCurve::from_feel(peak, ky, alpha_peak, self.falloff_lat);

        // Camber thrust enters as an equivalent slip-angle shift so that it is
        // subject to the same saturation as the slip-angle force.
        let camber_force = self.camber_stiffness * fz * i.camber;
        let alpha_eff = i.slip_angle - camber_force / m::max(ky, 1e-9);

        // Resultant-slip combined model.
        let sx = i.slip_ratio / kappa_peak;
        let sy = alpha_eff / alpha_peak;
        let s = m::hypot(sx, sy);
        let (fx, fy) = if s < 1e-9 {
            (kx * i.slip_ratio, -ky * alpha_eff)
        } else {
            let fx = (sx / s) * cx.eval(s * kappa_peak);
            let fy = -(sy / s) * cy.eval(s * alpha_peak);
            (fx, fy)
        };

        // Pneumatic trail falls to zero as the lateral slip reaches its peak
        // (Milliken & Milliken, ch. 2, pneumatic trail vs slip angle); a quadratic
        // keeps the derivative continuous at the origin.
        let sa = m::abs(alpha_eff) / alpha_peak;
        let trail = self.pneumatic_trail * m::clamp(1.0 - sa * sa, 0.0, 1.0);
        let mz = -trail * fy;

        // Rolling resistance moment opposes rolling.
        let my = -m::signum(i.vx) * self.rolling_resistance * fz * self.radius;

        TireOutput {
            fx,
            fy,
            mz,
            mx: 0.0,
            my,
            trail,
            fx_max: peak,
            fy_max: peak,
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
        if !(0.0..1.0).contains(&self.load_sensitivity) {
            errors.push(format!(
                "{prefix}.loadSensitivity must be in [0, 1) (got {})",
                self.load_sensitivity
            ));
        }
        for (name, v) in [
            ("camberStiffness", self.camber_stiffness),
            ("pneumaticTrail", self.pneumatic_trail),
            ("rollingResistance", self.rolling_resistance),
        ] {
            if !(v >= 0.0) || !v.is_finite() {
                errors.push(format!(
                    "{prefix}.{name} must be zero or positive (got {v})"
                ));
            }
        }
    }
}
