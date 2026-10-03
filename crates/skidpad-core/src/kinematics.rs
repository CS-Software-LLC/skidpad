//! Suspension geometry that changes with travel (ADR-0025): piecewise-linear
//! curves of a wheel's toe, camber, roll-centre height and anti-pitch
//! fractions against its suspension travel, as a kinematics-and-compliance
//! rig measures them.
//!
//! Sources: Milliken & Milliken, *Race Car Vehicle Dynamics*, ch. 17
//! (bump steer, camber gain, roll-centre migration); T. D. Gillespie,
//! *Fundamentals of Vehicle Dynamics*, ch. 7.
//!
//! Each curve is an offset from the static value the scalar field already
//! carries, so it passes through zero at zero travel. Evaluation uses only
//! comparisons, add, multiply and divide, so it is deterministic.

use skidpad_math as m;

/// Fewest points a curve may have.
pub const MIN_CURVE_POINTS: usize = 2;
/// Most points a curve may have. Keeps the per-substep lookup short.
pub const MAX_CURVE_POINTS: usize = 16;
/// How close to zero a curve must be at zero travel.
pub const ZERO_TOLERANCE: f64 = 1e-9;

/// A table of `[travel, value]` pairs, travel in metres (positive is bump,
/// as `WheelState::travel`), strictly increasing. Linear between points and
/// held at the end points outside them.
#[derive(Clone, Debug, PartialEq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(transparent))]
pub struct TravelCurve(pub Vec<[f64; 2]>);

impl TravelCurve {
    pub fn new(points: &[[f64; 2]]) -> Self {
        TravelCurve(points.to_vec())
    }

    /// The value at `travel`. An empty curve is zero; travel outside the
    /// table (or NaN) holds the nearer end point.
    pub fn eval(&self, travel: f64) -> f64 {
        let p = &self.0;
        let Some(first) = p.first() else {
            return 0.0;
        };
        if !(travel > first[0]) {
            return first[1];
        }
        for k in 1..p.len() {
            let [x1, y1] = p[k];
            if travel < x1 {
                let [x0, y0] = p[k - 1];
                return y0 + (y1 - y0) * (travel - x0) / (x1 - x0);
            }
        }
        p[p.len() - 1][1]
    }

    /// Check the shape, the zero crossing, and that `static_value` plus the
    /// curve stays within `±bound`. `path` names the curve in messages.
    pub fn validate(&self, path: &str, static_value: f64, bound: f64, errors: &mut Vec<String>) {
        let p = &self.0;
        if p.len() < MIN_CURVE_POINTS || p.len() > MAX_CURVE_POINTS {
            errors.push(format!(
                "{path} must have between {MIN_CURVE_POINTS} and {MAX_CURVE_POINTS} points (got {})",
                p.len()
            ));
            return;
        }
        if p.iter().any(|q| !q[0].is_finite() || !q[1].is_finite()) {
            errors.push(format!("{path} must contain only finite numbers"));
            return;
        }
        for k in 1..p.len() {
            if !(p[k][0] > p[k - 1][0]) {
                errors.push(format!(
                    "{path} travel must be strictly increasing (point {k} at {} m follows {} m)",
                    p[k][0],
                    p[k - 1][0]
                ));
                return;
            }
        }
        let at_zero = self.eval(0.0);
        if !(m::abs(at_zero) <= ZERO_TOLERANCE) {
            errors.push(format!(
                "{path} must pass through zero at zero travel (got {at_zero}); it is an offset from the static value"
            ));
        }
        // Piecewise linear and held at the ends: the extremes are points.
        if static_value.is_finite() {
            for q in p {
                let total = static_value + q[1];
                if m::abs(total) > bound {
                    errors.push(format!(
                        "{path} plus the static value reaches {total} at {} m of travel, beyond ±{bound}",
                        q[0]
                    ));
                    break;
                }
            }
        }
    }
}

/// The travel curves of one axle's suspension, all optional. They describe
/// the left wheel; the right wheel mirrors them as static toe and camber do.
/// Units match the scalar fields each one offsets.
#[derive(Clone, Debug, PartialEq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct KinematicsDef {
    /// Toe change, degrees, positive toe-in (bump steer). Offsets
    /// `staticToeDeg`. Not on a solid axle.
    #[cfg_attr(feature = "serde", serde(skip_serializing_if = "Option::is_none"))]
    pub toe_deg: Option<TravelCurve>,
    /// Camber change relative to the body, degrees, negative top-in (camber
    /// gain). Offsets `staticCamberDeg`. Not on a solid axle.
    #[cfg_attr(feature = "serde", serde(skip_serializing_if = "Option::is_none"))]
    pub camber_deg: Option<TravelCurve>,
    /// Roll-centre height change, m. Offsets `rollCenterHeight`, and
    /// switches the axle to per-wheel link forces, which jack the body.
    #[cfg_attr(feature = "serde", serde(skip_serializing_if = "Option::is_none"))]
    pub roll_center_height: Option<TravelCurve>,
    /// Anti-brake fraction change. Offsets `antiBrake`.
    #[cfg_attr(feature = "serde", serde(skip_serializing_if = "Option::is_none"))]
    pub anti_brake: Option<TravelCurve>,
    /// Anti-drive fraction change. Offsets `antiDrive`.
    #[cfg_attr(feature = "serde", serde(skip_serializing_if = "Option::is_none"))]
    pub anti_drive: Option<TravelCurve>,
}

impl KinematicsDef {
    /// True when no curve is set: the model then runs exactly as without
    /// the block.
    pub fn is_empty(&self) -> bool {
        self.toe_deg.is_none()
            && self.camber_deg.is_none()
            && self.roll_center_height.is_none()
            && self.anti_brake.is_none()
            && self.anti_drive.is_none()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn curve() -> TravelCurve {
        TravelCurve::new(&[[-0.1, 1.0], [0.0, 0.0], [0.05, -0.5], [0.1, -2.0]])
    }

    #[test]
    fn interpolates_between_points() {
        let c = curve();
        assert_eq!(c.eval(0.0), 0.0);
        assert_eq!(c.eval(-0.05), 0.5);
        assert_eq!(c.eval(0.025), -0.25);
        assert!((c.eval(0.075) - -1.25).abs() < 1e-15);
        assert_eq!(c.eval(0.05), -0.5);
    }

    #[test]
    fn holds_the_end_points() {
        let c = curve();
        assert_eq!(c.eval(-1.0), 1.0);
        assert_eq!(c.eval(-0.1), 1.0);
        assert_eq!(c.eval(0.1), -2.0);
        assert_eq!(c.eval(5.0), -2.0);
        assert_eq!(c.eval(f64::NAN), 1.0);
        assert_eq!(TravelCurve::default().eval(0.3), 0.0);
    }

    #[test]
    fn is_continuous_at_the_points() {
        let c = curve();
        for q in &c.0 {
            let below = c.eval(q[0] - 1e-12);
            let above = c.eval(q[0] + 1e-12);
            assert!((below - q[1]).abs() < 1e-9 && (above - q[1]).abs() < 1e-9);
        }
    }

    fn errors(c: &TravelCurve, static_value: f64, bound: f64) -> Vec<String> {
        let mut e = Vec::new();
        c.validate("k", static_value, bound, &mut e);
        e
    }

    #[test]
    fn accepts_a_valid_curve() {
        assert!(errors(&curve(), 0.0, 10.0).is_empty());
        // Zero outside the table's range is fine when the held value is zero.
        assert!(errors(&TravelCurve::new(&[[0.0, 0.0], [0.1, 1.0]]), 0.0, 10.0).is_empty());
    }

    #[test]
    fn rejects_bad_shapes() {
        let one = TravelCurve::new(&[[0.0, 0.0]]);
        assert!(errors(&one, 0.0, 10.0)[0].contains("between 2 and 16 points (got 1)"));
        let many = TravelCurve((0..17).map(|k| [k as f64 * 0.01, 0.0]).collect());
        assert!(errors(&many, 0.0, 10.0)[0].contains("(got 17)"));
        let nan = TravelCurve::new(&[[0.0, 0.0], [0.1, f64::NAN]]);
        assert!(errors(&nan, 0.0, 10.0)[0].contains("finite"));
        let flat = TravelCurve::new(&[[0.0, 0.0], [0.0, 1.0]]);
        assert!(errors(&flat, 0.0, 10.0)[0].contains("strictly increasing"));
        let back = TravelCurve::new(&[[0.0, 0.0], [0.1, 1.0], [0.05, 2.0]]);
        assert!(errors(&back, 0.0, 10.0)[0].contains("point 2"));
    }

    #[test]
    fn rejects_a_curve_off_zero_at_zero_travel() {
        let c = TravelCurve::new(&[[-0.1, 0.1], [0.1, 0.3]]);
        assert!(errors(&c, 0.0, 10.0)[0].contains("zero at zero travel"));
        let held = TravelCurve::new(&[[0.01, 0.2], [0.1, 0.3]]);
        assert!(errors(&held, 0.0, 10.0)[0].contains("zero at zero travel"));
        let tiny = TravelCurve::new(&[[-0.1, 0.0], [0.0, 1e-10], [0.1, 0.0]]);
        assert!(errors(&tiny, 0.0, 10.0).is_empty());
    }

    #[test]
    fn rejects_a_total_beyond_the_bound() {
        let c = TravelCurve::new(&[[-0.1, -0.5], [0.0, 0.0], [0.1, 0.5]]);
        assert!(errors(&c, 1.6, 2.0)[0].contains("reaches 2.1"));
        assert!(errors(&c, -1.6, 2.0)[0].contains("reaches -2.1"));
        assert!(errors(&c, 1.4, 2.0).is_empty());
    }
}
