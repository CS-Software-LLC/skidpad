//! Steady-state circular driving, after ISO 4138 (constant radius method).
//!
//! The vehicle is driven around a circle of fixed radius at a series of
//! increasing speeds. At each speed the steer angle needed to hold the radius
//! is recorded against the lateral acceleration. The understeer gradient is
//! the slope of steer angle against lateral acceleration:
//!
//! `δ = L / R + K_us · a_y`
//!
//! Linear theory (Gillespie ch. 6, eq. 6-8; Milliken ch. 5) predicts
//! `K_us = (m / L) · (b / C_f − a / C_r)` where `C_f`, `C_r` are the axle
//! cornering stiffnesses at their static loads. That textbook form ignores the
//! aligning moments. With pneumatic trail `t`, each axle's lateral force acts
//! `t` behind the axle, so the moment arms become `a − t_f` and `b + t_r`
//! (Milliken ch. 5, "effect of aligning torque on understeer"). The scenario
//! reports the trail-corrected analytic value so the validation page can show
//! simulated and analytic gradients side by side.

use super::linear_fit;
use crate::definition::VehicleDefinition;
use crate::input::VehicleInput;
use crate::vehicle::VehicleModel;
use crate::GRAVITY;
use skidpad_math as m;

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct UndersteerConfig {
    /// Circle radius, m.
    pub radius: f64,
    /// Speeds to hold, m/s, in increasing order.
    pub speeds: Vec<f64>,
    /// Time allowed to settle at each speed before measuring, s.
    pub settle_time: f64,
    /// Averaging window at the end of each settle period, s.
    pub measure_time: f64,
    /// Host step, s.
    pub host_dt: f64,
}

impl Default for UndersteerConfig {
    fn default() -> Self {
        Self {
            radius: 40.0,
            speeds: vec![4.0, 6.0, 8.0, 10.0, 12.0],
            settle_time: 8.0,
            measure_time: 1.0,
            host_dt: 1.0 / 100.0,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct UndersteerPoint {
    pub target_speed: f64,
    pub speed: f64,
    pub steer_angle: f64,
    pub lat_accel: f64,
    pub yaw_rate: f64,
    pub front_slip_angle: f64,
    pub rear_slip_angle: f64,
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct UndersteerResult {
    pub points: Vec<UndersteerPoint>,
    /// Ackermann steer angle `L / R`, rad.
    pub ackermann_angle: f64,
    /// Fitted intercept, rad. Should be close to `ackermann_angle`.
    pub fitted_intercept: f64,
    /// Simulated understeer gradient, rad per m/s².
    pub gradient: f64,
    /// Simulated understeer gradient, degrees per g.
    pub gradient_deg_per_g: f64,
    /// Linear-theory understeer gradient at static loads, rad per m/s².
    pub analytic_gradient: f64,
    pub analytic_gradient_deg_per_g: f64,
}

pub fn run(def: &VehicleDefinition, cfg: &UndersteerConfig) -> Result<UndersteerResult, String> {
    def.validate().map_err(|e| e.join("; "))?;
    if cfg.speeds.is_empty() {
        return Err(String::from("understeer: speeds must not be empty"));
    }
    if !(cfg.radius > 0.0) {
        return Err(String::from("understeer: radius must be positive"));
    }

    let mut car = VehicleModel::new(def.clone());
    car.set_speed(cfg.speeds[0]);
    car.set_yaw_rate(cfg.speeds[0] / cfg.radius);
    let rate = def.simulation.substep_rate_hz;
    let n_sub = m::max(m::round(cfg.host_dt * rate), 1.0) as usize;
    let sub_dt = cfg.host_dt / n_sub as f64;
    let max_angle = def.max_wheel_angle();

    // Controllers. Steering is PI on yaw-rate error; speed is P with the
    // negative half going to the brake.
    let kp_steer = 0.4;
    let ki_steer = 1.2;
    let kp_speed = 0.6;
    let mut steer_integral = def.chassis.wheelbase / cfg.radius;

    let mut points = Vec::with_capacity(cfg.speeds.len());
    for &target in &cfg.speeds {
        let settle_steps = m::max(m::round(cfg.settle_time / cfg.host_dt), 1.0) as usize;
        let measure_steps = m::max(m::round(cfg.measure_time / cfg.host_dt), 1.0) as usize;
        let mut acc = [0.0f64; 6];
        let mut count = 0.0;
        for step in 0..settle_steps {
            let speed = car.vx();
            let r_target = target / cfg.radius;
            let err = r_target - car.yaw_rate();
            steer_integral += ki_steer * err * cfg.host_dt;
            steer_integral = m::clamp(steer_integral, -max_angle, max_angle);
            let delta = m::clamp(kp_steer * err + steer_integral, -max_angle, max_angle);
            let pedal = kp_speed * (target - speed);
            let input = VehicleInput {
                steer: -delta / max_angle,
                throttle: m::clamp(pedal, 0.0, 1.0),
                brake: m::clamp(-pedal, 0.0, 1.0),
                handbrake: 0.0,
            };
            for _ in 0..n_sub {
                car.substep(sub_dt, &input);
            }
            if step + measure_steps >= settle_steps {
                acc[0] += car.vx();
                acc[1] += car.steer_angle();
                acc[2] += car.vx() * car.yaw_rate();
                acc[3] += car.yaw_rate();
                acc[4] += car.axle_slip_angle(0);
                acc[5] += car.axle_slip_angle(1);
                count += 1.0;
            }
        }
        points.push(UndersteerPoint {
            target_speed: target,
            speed: acc[0] / count,
            steer_angle: acc[1] / count,
            lat_accel: acc[2] / count,
            yaw_rate: acc[3] / count,
            front_slip_angle: acc[4] / count,
            rear_slip_angle: acc[5] / count,
        });
    }

    let xs: Vec<f64> = points.iter().map(|p| p.lat_accel).collect();
    let ys: Vec<f64> = points.iter().map(|p| p.steer_angle).collect();
    let (gradient, intercept) = linear_fit(&xs, &ys);

    let c = &def.chassis;
    let a = c.cg_to_front_axle;
    let b = def.cg_to_rear_axle();
    let l = c.wheelbase;
    let wf = c.mass * GRAVITY * b / l;
    let wr = c.mass * GRAVITY * a / l;
    // Axle cornering stiffness: two tires, each at half the axle load.
    let cf = 2.0 * def.axles[0].tire.cornering_stiffness(0.5 * wf);
    let cr = 2.0 * def.axles[1].tire.cornering_stiffness(0.5 * wr);
    // Trail moves the force application points rearward.
    let tf = def.axles[0].tire.static_trail(0.5 * wf);
    let tr = def.axles[1].tire.static_trail(0.5 * wr);
    let a_eff = a - tf;
    let b_eff = b + tr;
    let l_eff = a_eff + b_eff;
    let analytic = (c.mass / l_eff) * (b_eff / cf - a_eff / cr);

    let deg_per_g = |k: f64| m::rad_to_deg(k) * GRAVITY;
    Ok(UndersteerResult {
        points,
        ackermann_angle: l / cfg.radius,
        fitted_intercept: intercept,
        gradient,
        gradient_deg_per_g: deg_per_g(gradient),
        analytic_gradient: analytic,
        analytic_gradient_deg_per_g: deg_per_g(analytic),
    })
}
