//! On-centre weave, after ISO 13674-1 (steering feel, weave test) and
//! Norman's on-centre handling metrics (SAE 840069).
//!
//! The car runs straight at a constant speed while the hand wheel follows a
//! slow sine, sized by linear theory for a small peak lateral acceleration
//! (0.2 g at 0.2 Hz by default). Over the settled cycles the hand-wheel
//! torque the driver holds is read against the lateral acceleration and the
//! hand-wheel angle, and the numbers steering engineers quote for on-centre
//! feel come out of the two loops:
//!
//! * torque at 0 g, half the width of the torque loop where it crosses zero
//!   lateral acceleration: the friction and lag the driver pushes through
//!   before the car turns;
//! * torque gradient at 0 g and at the reference acceleration (0.1 g by
//!   default), N·m per g: how fast the wheel weights up;
//! * steering sensitivity, g per 100° of hand wheel at 0 g;
//! * angle hysteresis, the width of the angle loop at 0 g, degrees;
//! * peak torque and peak lateral acceleration.
//!
//! The driver's torque is the core's hand-wheel torque (ADR-0012, averaged
//! over the host step, ADR-0031) plus the column friction and damping the
//! force-feedback device adds (`columnFriction`, `columnDamping`, ADR-0033),
//! taken analytically from the known hand-wheel rate since the core does not
//! simulate the column. All torques are in the driver's frame: positive
//! steers left, the direction of positive lateral acceleration.
//!
//! The speed-sensitive steering assist is a game-input aid that shrinks
//! the lock at speed; it is turned off here so the hand-wheel angle is the
//! one the sine asks for.

use super::linear_fit;
use super::straight_line::STOP_SPEED;
use crate::definition::VehicleDefinition;
use crate::input::VehicleInput;
use crate::vehicle::VehicleModel;
use crate::GRAVITY;
use skidpad_math as m;

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct WeaveConfig {
    /// Speed held through the manoeuvre, m/s (default 100 km/h).
    pub speed: f64,
    /// Steering frequency, Hz (ISO 13674-1 uses 0.2).
    pub frequency: f64,
    /// Peak lateral acceleration the sine is sized for by linear theory,
    /// m/s² (default 0.2 g).
    pub lat_accel_peak: f64,
    /// Lateral acceleration at which the second torque gradient is read,
    /// m/s² (default 0.1 g, Norman's).
    pub reference_lat_accel: f64,
    /// Cycles run before measuring, to let the transient die.
    pub settle_cycles: u32,
    /// Cycles measured.
    pub measure_cycles: u32,
    /// Straight running before the sine starts, s.
    pub lead_time: f64,
    /// Half-width of the band around each acceleration the gradients and
    /// crossings are fitted over, m/s².
    pub fit_band: f64,
    /// Add the device's column friction and damping to the driver torque.
    pub include_column: bool,
    pub host_dt: f64,
}

impl Default for WeaveConfig {
    fn default() -> Self {
        Self {
            speed: 100.0 / 3.6,
            frequency: 0.2,
            lat_accel_peak: 0.2 * GRAVITY,
            reference_lat_accel: 0.1 * GRAVITY,
            settle_cycles: 1,
            measure_cycles: 2,
            lead_time: 2.0,
            fit_band: 0.03 * GRAVITY,
            include_column: true,
            host_dt: 1.0 / 100.0,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct WeaveResult {
    pub speed: f64,
    /// Peak hand-wheel angle of the sine, degrees.
    pub steering_wheel_amplitude_deg: f64,
    /// Peak lateral acceleration reached, g.
    pub lat_accel_peak_g: f64,
    /// Half the width of the torque loop at 0 g, N·m.
    pub torque_at_zero_g: f64,
    /// Slope of driver torque against lateral acceleration at 0 g, N·m/g,
    /// the mean of the two branches.
    pub torque_gradient_zero_g: f64,
    /// The same at the reference acceleration, N·m/g.
    pub torque_gradient_reference: f64,
    /// Lateral acceleration per 100° of hand wheel at 0 g, g.
    pub steering_sensitivity: f64,
    /// Width of the hand-wheel angle loop at 0 g, degrees.
    pub angle_hysteresis_deg: f64,
    /// Largest driver torque, N·m.
    pub torque_peak: f64,
    /// The column's share of `torque_at_zero_g`, N·m: the friction plus
    /// the damping at the zero-crossing rate.
    pub column_torque_at_zero_g: f64,
    pub completed: bool,
}

/// One measured sample: lateral acceleration, hand-wheel angle (rad),
/// driver torque, and whether the hand wheel is turning left.
struct Sample {
    ay: f64,
    angle: f64,
    torque: f64,
    rising: bool,
}

pub fn run(def: &VehicleDefinition, cfg: &WeaveConfig) -> Result<WeaveResult, String> {
    def.validate().map_err(|e| e.join("; "))?;
    if !(cfg.speed > 0.0)
        || !(cfg.host_dt > 0.0)
        || !(cfg.frequency > 0.0)
        || !(cfg.lat_accel_peak > 0.0)
        || !(cfg.fit_band > 0.0)
        || cfg.measure_cycles == 0
    {
        return Err(String::from(
            "weave: speed, frequency, latAccelPeak, fitBand, hostDt and measureCycles must be positive",
        ));
    }
    let mut def = def.clone();
    def.assists.steering_assist.enabled = false;
    let max_angle = def.max_wheel_angle();
    let ratio = def.steering.ratio;
    let amplitude = m::min(
        m::abs(super::step_steer::linear_steer_angle(
            &def,
            cfg.speed,
            cfg.lat_accel_peak,
        )),
        max_angle,
    );
    let omega = 2.0 * m::PI * cfg.frequency;
    let friction = def.steering.column_friction;
    let damping = def.column_damping_at(cfg.speed);

    let mut car = VehicleModel::new(def.clone());
    car.set_speed(cfg.speed);
    let rate = def.simulation.substep_rate_hz;
    let n_sub = m::max(m::round(cfg.host_dt * rate), 1.0) as usize;
    let sub_dt = cfg.host_dt / n_sub as f64;

    let kp_speed = 0.6;
    let ki_speed = 0.4;
    let mut speed_integral = 0.0;
    let period = 1.0 / cfg.frequency;
    let lead_steps = m::round(m::max(cfg.lead_time, 0.0) / cfg.host_dt) as usize;
    let settle = cfg.settle_cycles as f64 * period;
    let total = settle + cfg.measure_cycles as f64 * period;
    let sine_steps = m::round(total / cfg.host_dt) as usize;

    let mut samples = Vec::with_capacity(sine_steps);
    let mut ay_peak: f64 = 0.0;
    let mut torque_peak: f64 = 0.0;
    let mut finite = true;
    for step in 0..lead_steps + sine_steps {
        // The angle is applied over the host step; it and its rate are
        // read at the step's end, where the response is sampled.
        let t_end = if step >= lead_steps {
            (step + 1 - lead_steps) as f64 * cfg.host_dt
        } else {
            0.0
        };
        let delta = if step >= lead_steps {
            amplitude * m::sin(omega * t_end)
        } else {
            0.0
        };
        let speed = car.vx();
        speed_integral = m::clamp(
            speed_integral + ki_speed * (cfg.speed - speed) * cfg.host_dt,
            -1.0,
            1.0,
        );
        let pedal = kp_speed * (cfg.speed - speed) + speed_integral;
        let input = VehicleInput {
            // Positive input steers right (ADR-0007).
            steer: -delta / max_angle,
            throttle: m::clamp(pedal, 0.0, 1.0),
            brake: m::clamp(-pedal, 0.0, 1.0),
            ..VehicleInput::default()
        };
        let mut torque_sum = 0.0;
        let mut ay_sum = 0.0;
        for _ in 0..n_sub {
            car.substep(sub_dt, &input);
            torque_sum += car.steering_torque();
            ay_sum += car.lat_accel();
        }
        if step < lead_steps {
            continue;
        }
        // The core's hand-wheel torque is what the wheel pushes the hands
        // with, in the input's sign (positive right). The driver holds the
        // opposite, in the left-positive frame: the same number.
        let core_torque = torque_sum / n_sub as f64;
        let angle_rate = ratio * amplitude * omega * m::cos(omega * t_end);
        let column = if cfg.include_column {
            friction * smooth_sign(angle_rate, ratio * amplitude * omega) + damping * angle_rate
        } else {
            0.0
        };
        let torque = core_torque + column;
        // What a body accelerometer reads, `v̇y + vx·r`, averaged over the
        // step like the torque; `vx·r` alone would miss the side-slip rate
        // and lag the real acceleration.
        let ay = ay_sum / n_sub as f64;
        finite &= ay.is_finite() && torque.is_finite();
        if t_end > settle {
            ay_peak = m::max(ay_peak, m::abs(ay));
            torque_peak = m::max(torque_peak, m::abs(torque));
            samples.push(Sample {
                ay,
                angle: ratio * delta,
                torque,
                rising: angle_rate > 0.0,
            });
        }
    }

    let band = cfg.fit_band;
    let at = |a: f64, rising: bool, y: fn(&Sample) -> f64| -> (f64, f64) {
        let (x, v): (Vec<f64>, Vec<f64>) = samples
            .iter()
            .filter(|s| s.rising == rising && m::abs(s.ay - a) <= band)
            .map(|s| (s.ay, y(s)))
            .unzip();
        let (slope, intercept) = linear_fit(&x, &v);
        (slope, intercept + slope * a)
    };
    let torque = |s: &Sample| s.torque;
    let angle = |s: &Sample| s.angle;
    let (tg_up, t0_up) = at(0.0, true, torque);
    let (tg_dn, t0_dn) = at(0.0, false, torque);
    let a_ref = m::abs(cfg.reference_lat_accel);
    // At +reference and −reference, both branches: four slopes.
    let mut ref_slopes = 0.0;
    for a in [a_ref, -a_ref] {
        ref_slopes += at(a, true, torque).0 + at(a, false, torque).0;
    }
    let (ag_up, a0_up) = at(0.0, true, angle);
    let (ag_dn, a0_dn) = at(0.0, false, angle);
    let angle_gradient = 0.5 * (ag_up + ag_dn);
    // The hand-wheel rate where the car crosses 0 g, for the column share.
    let rate_at_zero = ratio * amplitude * omega;
    let column_at_zero = if cfg.include_column {
        friction + damping * rate_at_zero * m::cos(omega * phase_lag(&samples, cfg.host_dt))
    } else {
        0.0
    };

    Ok(WeaveResult {
        speed: car.vx(),
        steering_wheel_amplitude_deg: m::rad_to_deg(ratio * amplitude),
        lat_accel_peak_g: ay_peak / GRAVITY,
        torque_at_zero_g: 0.5 * (t0_up - t0_dn),
        torque_gradient_zero_g: 0.5 * (tg_up + tg_dn) * GRAVITY,
        torque_gradient_reference: 0.25 * ref_slopes * GRAVITY,
        steering_sensitivity: if m::abs(angle_gradient) > 1e-12 {
            m::deg_to_rad(100.0) / (angle_gradient * GRAVITY)
        } else {
            0.0
        },
        angle_hysteresis_deg: m::rad_to_deg(a0_up - a0_dn),
        torque_peak,
        column_torque_at_zero_g: column_at_zero,
        completed: finite && car.vx() > STOP_SPEED && !samples.is_empty(),
    })
}

/// `sign(x)` smoothed over the bottom percent of the rate's range, so the
/// column friction does not flip on the one sample nearest a reversal.
fn smooth_sign(x: f64, scale: f64) -> f64 {
    let w = 0.01 * m::max(scale, 1e-9);
    m::clamp(x / w, -1.0, 1.0)
}

/// Time by which the lateral acceleration lags the hand-wheel angle, s:
/// from the mean gap between each upward zero crossing of the angle and the
/// next upward zero crossing of the acceleration.
fn phase_lag(samples: &[Sample], host_dt: f64) -> f64 {
    let mut lags = 0.0;
    let mut n = 0.0;
    let mut angle_cross: Option<usize> = None;
    for k in 1..samples.len() {
        let (p, s) = (&samples[k - 1], &samples[k]);
        if p.angle < 0.0 && s.angle >= 0.0 {
            angle_cross = Some(k);
        }
        if p.ay < 0.0 && s.ay >= 0.0 {
            if let Some(a) = angle_cross.take() {
                lags += (k - a) as f64 * host_dt;
                n += 1.0;
            }
        }
    }
    if n > 0.0 {
        lags / n
    } else {
        0.0
    }
}
