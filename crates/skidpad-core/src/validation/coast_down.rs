//! Coast-down: the car rolls from speed in neutral on flat ground and its
//! deceleration gives the road load, fitted as `F = A + B·v + C·v²` the
//! way EPA's coast-down target coefficients are defined (40 CFR 1066.310,
//! SAE J2263). It checks the longitudinal model's rolling resistance and
//! aero drag against measured cars.
//!
//! The force is the deceleration times the car's mass plus its rotating
//! inertia (each wheel's `wheelInertia / r²`), so it is the resistance
//! alone. The drive is disconnected: clutch open and neutral for an
//! engine, no regeneration for a motor, as in an EPA coast-down.

use crate::definition::VehicleDefinition;
use crate::drivetrain::PowerUnitDef;
use crate::input::VehicleInput;
use crate::vehicle::VehicleModel;
use skidpad_math as m;

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct CoastDownConfig {
    /// Speed the coast starts from, m/s (default 80 mph, as EPA's).
    pub start_speed: f64,
    /// Speed the fit ends at, m/s (default 15 mph).
    pub end_speed: f64,
    /// Give up after this long, s.
    pub max_time: f64,
    pub host_dt: f64,
}

impl Default for CoastDownConfig {
    fn default() -> Self {
        Self {
            start_speed: 80.0 * MPH,
            end_speed: 15.0 * MPH,
            max_time: 600.0,
            host_dt: 0.1,
        }
    }
}

/// One mile per hour, m/s.
pub const MPH: f64 = 0.447_04;
/// One pound-force, N.
pub const LBF: f64 = 4.448_221_615_260_5;

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct CoastDownResult {
    /// Fitted road-load coefficients: `A` in N, `B` in N per m/s, `C` in N
    /// per (m/s)².
    pub a: f64,
    pub b: f64,
    pub c: f64,
    /// The same in EPA's units: lbf, lbf/mph, lbf/mph².
    pub a_lbf: f64,
    pub b_lbf_mph: f64,
    pub c_lbf_mph2: f64,
    /// Road load from the fit at 50 and 100 km/h, N.
    pub force_50: f64,
    pub force_100: f64,
    /// Mass plus rotating inertia the deceleration was multiplied by, kg.
    pub effective_mass: f64,
    /// Time from the start speed to the end speed, s.
    pub coast_time: f64,
    /// Largest gap between a sample and the fit, as a fraction of the
    /// sample.
    pub fit_spread: f64,
    pub completed: bool,
}

impl CoastDownResult {
    /// The fitted road load at `v`, m/s, N.
    pub fn force_at(&self, v: f64) -> f64 {
        self.a + self.b * v + self.c * v * v
    }
}

pub fn run(def: &VehicleDefinition, cfg: &CoastDownConfig) -> Result<CoastDownResult, String> {
    def.validate().map_err(|e| e.join("; "))?;
    if !(cfg.start_speed > cfg.end_speed && cfg.end_speed > 0.0)
        || !(cfg.host_dt > 0.0)
        || !(cfg.max_time > 0.0)
    {
        return Err(String::from(
            "coastDown: startSpeed must be above endSpeed, both positive, and hostDt and maxTime positive",
        ));
    }
    let mut def = def.clone();
    if let PowerUnitDef::Electric(e) = &mut def.drivetrain.power_unit {
        e.regen_torque = 0.0;
    }
    let mut effective_mass = def.chassis.mass;
    for axle in &def.axles {
        let r = axle.tire.unloaded_radius();
        effective_mass += 2.0 * axle.wheel_inertia / (r * r);
    }

    let mut car = VehicleModel::new(def.clone());
    car.set_speed(cfg.start_speed);
    let rate = def.simulation.substep_rate_hz;
    let n_sub = m::max(m::round(cfg.host_dt * rate), 1.0) as usize;
    let sub_dt = cfg.host_dt / n_sub as f64;
    let input = VehicleInput {
        clutch: 1.0,
        gear: 0.0,
        ..VehicleInput::default()
    };

    // Let the transients of the start settle for a second (the tires take
    // up their rolling deflection, the body its pitch).
    let settle = m::round(1.0 / cfg.host_dt) as usize;
    let steps = m::round(cfg.max_time / cfg.host_dt) as usize;
    let mut v_prev = f64::NAN;
    let (mut vs, mut fs) = (Vec::new(), Vec::new());
    let mut t_start = f64::NAN;
    let mut coast_time = 0.0;
    let mut completed = false;
    for step in 0..steps {
        for _ in 0..n_sub {
            car.substep(sub_dt, &input);
        }
        let v = car.vx();
        if !v.is_finite() {
            break;
        }
        if step >= settle && v_prev.is_finite() {
            let v_mid = 0.5 * (v + v_prev);
            if v_mid <= cfg.start_speed && v_mid >= cfg.end_speed {
                if t_start.is_nan() {
                    t_start = step as f64 * cfg.host_dt;
                }
                vs.push(v_mid);
                fs.push(effective_mass * (v_prev - v) / cfg.host_dt);
            }
            if v < cfg.end_speed {
                coast_time = (step + 1) as f64 * cfg.host_dt - t_start;
                completed = true;
                break;
            }
        }
        v_prev = v;
    }
    let (a, b, c) = quadratic_fit(&vs, &fs);
    let mut spread: f64 = 0.0;
    for (v, f) in vs.iter().zip(&fs) {
        let fit = a + b * v + c * v * v;
        if m::abs(*f) > 1e-9 {
            spread = m::max(spread, m::abs(fit - f) / m::abs(*f));
        }
    }
    Ok(CoastDownResult {
        a,
        b,
        c,
        a_lbf: a / LBF,
        b_lbf_mph: b * MPH / LBF,
        c_lbf_mph2: c * MPH * MPH / LBF,
        force_50: a + b * (50.0 / 3.6) + c * (50.0 / 3.6) * (50.0 / 3.6),
        force_100: a + b * (100.0 / 3.6) + c * (100.0 / 3.6) * (100.0 / 3.6),
        effective_mass,
        coast_time,
        fit_spread: spread,
        completed: completed && vs.len() >= 3,
    })
}

/// Least-squares `y = a + b·x + c·x²`, by the normal equations with `x`
/// scaled to its largest value so they stay well conditioned.
pub(crate) fn quadratic_fit(x: &[f64], y: &[f64]) -> (f64, f64, f64) {
    let n = x.len().min(y.len());
    if n < 3 {
        return (0.0, 0.0, 0.0);
    }
    let s = x[..n]
        .iter()
        .fold(0.0, |acc: f64, v| m::max(acc, m::abs(*v)));
    let s = if s > 0.0 { s } else { 1.0 };
    // Sums of u^k and y·u^k with u = x / s.
    let mut su = [0.0; 5];
    let mut sy = [0.0; 3];
    for i in 0..n {
        let u = x[i] / s;
        let mut p = 1.0;
        for (k, slot) in su.iter_mut().enumerate() {
            *slot += p;
            if k < 3 {
                sy[k] += y[i] * p;
            }
            p *= u;
        }
    }
    let mat = [
        [su[0], su[1], su[2]],
        [su[1], su[2], su[3]],
        [su[2], su[3], su[4]],
    ];
    let det3 = |a: [[f64; 3]; 3]| {
        a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1])
            - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
            + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])
    };
    let d = det3(mat);
    if m::abs(d) < 1e-300 {
        return (0.0, 0.0, 0.0);
    }
    let mut coef = [0.0; 3];
    for (k, out) in coef.iter_mut().enumerate() {
        let mut a = mat;
        for row in 0..3 {
            a[row][k] = sy[row];
        }
        *out = det3(a) / d;
    }
    (coef[0], coef[1] / s, coef[2] / (s * s))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_fit_recovers_a_quadratic_exactly() {
        let x: Vec<f64> = (0..50).map(|i| 5.0 + 0.5 * i as f64).collect();
        let y: Vec<f64> = x.iter().map(|v| 140.0 + 0.8 * v + 0.41 * v * v).collect();
        let (a, b, c) = quadratic_fit(&x, &y);
        assert!(m::abs(a - 140.0) < 1e-8, "{a}");
        assert!(m::abs(b - 0.8) < 1e-9, "{b}");
        assert!(m::abs(c - 0.41) < 1e-11, "{c}");
    }
}
