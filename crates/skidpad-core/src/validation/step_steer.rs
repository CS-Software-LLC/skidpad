//! Step steer, after ISO 7401 (lateral transient response, step input).
//!
//! The car runs straight at a constant speed, then the steer is stepped to
//! an angle that linear theory says gives a chosen steady lateral
//! acceleration, and the yaw rate and lateral acceleration are watched as
//! they settle. The headline numbers are the ones ISO 7401 asks for: the
//! steady-state yaw-rate gain, the yaw-rate response time (to 90 % of the
//! steady state), its peak overshoot, the lateral-acceleration response
//! time, and the steady-state side-slip angle.
//!
//! The step is a 0.1 s ramp rather than a true step, as the standard
//! allows (the steering must reach its value within 0.15 s), so that the
//! result does not depend on the host step the ramp happens to fall on.
//! Sources: ISO 7401:2011; Milliken & Milliken, *Race Car Vehicle
//! Dynamics*, ch. 8 (transient response); Gillespie ch. 6.

use super::straight_line::STOP_SPEED;
use crate::definition::VehicleDefinition;
use crate::input::VehicleInput;
use crate::vehicle::VehicleModel;
use skidpad_math as m;

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct StepSteerConfig {
    /// Speed held through the manoeuvre, m/s (default 80 km/h).
    pub speed: f64,
    /// Steady-state lateral acceleration the step aims for, m/s². The steer
    /// angle comes from linear theory with the definition's own cornering
    /// stiffnesses and trail (ISO 7401 recommends 4 m/s²).
    pub lat_accel_target: f64,
    /// Straight running before the step, s.
    pub lead_time: f64,
    /// Time the step is held, s.
    pub hold_time: f64,
    /// Ramp time of the step, s.
    pub ramp_time: f64,
    /// Averaging window at the end of the hold for the steady state, s.
    pub measure_time: f64,
    pub host_dt: f64,
}

impl Default for StepSteerConfig {
    fn default() -> Self {
        Self {
            speed: 80.0 / 3.6,
            lat_accel_target: 4.0,
            lead_time: 2.0,
            hold_time: 5.0,
            ramp_time: 0.1,
            measure_time: 1.0,
            host_dt: 1.0 / 100.0,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct StepSteerResult {
    /// Speed over the hold, m/s.
    pub speed: f64,
    /// Road-wheel steer angle of the step, rad.
    pub steer_angle: f64,
    /// Hand-wheel angle of the step, rad.
    pub steering_wheel_angle: f64,
    /// Steady-state yaw rate, rad/s.
    pub yaw_rate: f64,
    /// Steady-state yaw-rate gain, (rad/s) per rad of road-wheel steer.
    pub yaw_rate_gain: f64,
    /// Peak yaw rate during the response, rad/s.
    pub yaw_rate_peak: f64,
    /// `peak / steady − 1`; zero for a response with no overshoot.
    pub yaw_rate_overshoot: f64,
    /// Time from the start of the step for the yaw rate to first reach
    /// 90 % of its steady state, s. `None` if it never did.
    pub yaw_rate_response_time: Option<f64>,
    /// Steady-state lateral acceleration, m/s².
    pub lat_accel: f64,
    /// Time for the lateral acceleration to first reach 90 % of its steady
    /// state, s.
    pub lat_accel_response_time: Option<f64>,
    /// Steady-state body side-slip angle, rad (positive nose-in).
    pub body_slip_angle: f64,
    /// Peak body roll, rad (four-wheel model; zero on the single-track).
    pub roll_peak: f64,
    /// Steady-state body roll, rad.
    pub roll: f64,
    /// Every sample finite and the car still moving at the end.
    pub completed: bool,
}

/// Steer angle that linear theory needs for `ay` at `speed`: the Ackermann
/// angle of the path plus the understeer gradient times the acceleration,
/// with the trail-corrected gradient the understeer scenario reports.
pub fn linear_steer_angle(def: &VehicleDefinition, speed: f64, ay: f64) -> f64 {
    let kus = super::understeer::linear_understeer_gradient(def);
    def.chassis.wheelbase * ay / (speed * speed) + kus * ay
}

pub fn run(def: &VehicleDefinition, cfg: &StepSteerConfig) -> Result<StepSteerResult, String> {
    def.validate().map_err(|e| e.join("; "))?;
    if !(cfg.speed > 0.0) || !(cfg.host_dt > 0.0) || !(cfg.hold_time > 0.0) {
        return Err(String::from(
            "step steer: speed, hostDt and holdTime must be positive",
        ));
    }
    let max_angle = def.max_wheel_angle();
    let delta = m::clamp(
        linear_steer_angle(def, cfg.speed, cfg.lat_accel_target),
        -max_angle,
        max_angle,
    );
    let mut car = VehicleModel::new(def.clone());
    car.set_speed(cfg.speed);
    let rate = def.simulation.substep_rate_hz;
    let n_sub = m::max(m::round(cfg.host_dt * rate), 1.0) as usize;
    let sub_dt = cfg.host_dt / n_sub as f64;

    // Speed is held by the same PI the skidpad uses, braking on the
    // negative half.
    let kp_speed = 0.6;
    let ki_speed = 0.4;
    let mut speed_integral = 0.0;
    let lead_steps = m::round(m::max(cfg.lead_time, 0.0) / cfg.host_dt) as usize;
    let hold_steps = m::max(m::round(cfg.hold_time / cfg.host_dt), 1.0) as usize;
    let measure_steps = m::clamp(
        m::round(cfg.measure_time / cfg.host_dt),
        1.0,
        hold_steps as f64,
    ) as usize;
    let ramp = m::max(cfg.ramp_time, 0.0);

    let mut yaw_rates = Vec::with_capacity(hold_steps);
    let mut lat_accels = Vec::with_capacity(hold_steps);
    let mut rolls = Vec::with_capacity(hold_steps);
    let mut acc = [0.0f64; 5];
    let mut count = 0.0;
    let mut finite = true;
    for step in 0..lead_steps + hold_steps {
        let t_step = if step >= lead_steps {
            (step - lead_steps) as f64 * cfg.host_dt
        } else {
            -1.0
        };
        let steer_frac = if t_step < 0.0 {
            0.0
        } else if ramp > 0.0 {
            m::clamp(t_step / ramp, 0.0, 1.0)
        } else {
            1.0
        };
        let speed = car.vx();
        speed_integral = m::clamp(
            speed_integral + ki_speed * (cfg.speed - speed) * cfg.host_dt,
            -1.0,
            1.0,
        );
        let pedal = kp_speed * (cfg.speed - speed) + speed_integral;
        let input = VehicleInput {
            // Positive input steers right (ADR-0007); a positive steer
            // angle is a left turn, so the input carries the opposite sign.
            steer: -steer_frac * delta / max_angle,
            throttle: m::clamp(pedal, 0.0, 1.0),
            brake: m::clamp(-pedal, 0.0, 1.0),
            ..VehicleInput::default()
        };
        for _ in 0..n_sub {
            car.substep(sub_dt, &input);
        }
        if step >= lead_steps {
            let r = car.yaw_rate();
            let ay = car.vx() * r;
            let (_, _, roll) = pose_angles(&car);
            finite &= r.is_finite() && ay.is_finite() && roll.is_finite();
            yaw_rates.push(r);
            lat_accels.push(ay);
            rolls.push(roll);
            if step + measure_steps >= lead_steps + hold_steps {
                let (vx, vy) = body_velocity(&car);
                acc[0] += car.vx();
                acc[1] += r;
                acc[2] += ay;
                acc[3] += m::atan2(vy, m::max(m::abs(vx), 0.1));
                acc[4] += roll;
                count += 1.0;
            }
        }
    }
    let speed = acc[0] / count;
    let yaw_rate = acc[1] / count;
    let lat_accel = acc[2] / count;
    let body_slip = acc[3] / count;
    let roll = acc[4] / count;
    let (yaw_peak, yaw_rt) = peak_and_response_time(&yaw_rates, yaw_rate, cfg.host_dt);
    let (_, ay_rt) = peak_and_response_time(&lat_accels, lat_accel, cfg.host_dt);
    let roll_peak = rolls.iter().fold(0.0f64, |p, &r| m::max(p, m::abs(r)));
    let overshoot = if m::abs(yaw_rate) > 1e-9 {
        m::max(yaw_peak / m::abs(yaw_rate) - 1.0, 0.0)
    } else {
        0.0
    };
    Ok(StepSteerResult {
        speed,
        steer_angle: delta,
        steering_wheel_angle: delta * def.steering.ratio,
        yaw_rate,
        yaw_rate_gain: if m::abs(delta) > 1e-12 {
            yaw_rate / delta
        } else {
            0.0
        },
        yaw_rate_peak: yaw_peak,
        yaw_rate_overshoot: overshoot,
        yaw_rate_response_time: yaw_rt,
        lat_accel,
        lat_accel_response_time: ay_rt,
        body_slip_angle: body_slip,
        roll_peak,
        roll,
        completed: finite && car.vx() > STOP_SPEED,
    })
}

/// Largest magnitude of a response and the first time it reaches 90 % of
/// the steady-state magnitude, s after the step.
fn peak_and_response_time(series: &[f64], steady: f64, host_dt: f64) -> (f64, Option<f64>) {
    let target = 0.9 * m::abs(steady);
    let sign = if steady < 0.0 { -1.0 } else { 1.0 };
    let mut peak: f64 = 0.0;
    let mut rt = None;
    for (k, &v) in series.iter().enumerate() {
        peak = m::max(peak, m::abs(v));
        if rt.is_none() && sign * v >= target && target > 0.0 {
            rt = Some((k + 1) as f64 * host_dt);
        }
    }
    (peak, rt)
}

fn pose_angles(car: &VehicleModel) -> (f64, f64, f64) {
    match car {
        VehicleModel::FourWheel(v) => v.orient.to_yaw_pitch_roll(),
        VehicleModel::SingleTrack(v) => (v.yaw, 0.0, 0.0),
    }
}

fn body_velocity(car: &VehicleModel) -> (f64, f64) {
    match car {
        VehicleModel::FourWheel(v) => {
            let vb = v.vel_body();
            (vb.x, vb.y)
        }
        VehicleModel::SingleTrack(v) => (v.vx, v.vy),
    }
}
