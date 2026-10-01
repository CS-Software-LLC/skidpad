//! Parked on a slope, and at rest on flat ground: the standstill scenarios
//! of ADR-0005 and ADR-0010. The car is placed at rest on the built-in flat
//! world with a tilted gravity (road grade along +x, cross slope along +y),
//! the given brake and handbrake are held, and after a settling period the
//! car must stay put: no creep, no drift, no sustained oscillation.

use crate::definition::VehicleDefinition;
use crate::input::VehicleInput;
use crate::vehicle::VehicleModel;
use skidpad_math as m;

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct ParkedConfig {
    /// Road grade as rise per metre along world +x (0.1 for 10 %). The car
    /// heads +x, so a positive grade faces it uphill.
    pub grade: f64,
    /// Cross slope as rise per metre along world +y.
    pub cross_slope: f64,
    /// Service brake input held throughout, 0 … 1.
    pub brake: f64,
    /// Handbrake input held throughout, 0 … 1.
    pub handbrake: f64,
    /// Heading, rad (0 faces +x).
    pub heading: f64,
    /// Settling period before the measurement, s.
    pub settle_time: f64,
    /// Measurement period, s.
    pub hold_time: f64,
    /// Window at the end of the hold over which the velocity RMS is taken, s.
    pub rms_window: f64,
    pub host_dt: f64,
}

impl Default for ParkedConfig {
    fn default() -> Self {
        Self {
            grade: 0.0,
            cross_slope: 0.0,
            brake: 0.0,
            handbrake: 0.0,
            heading: 0.0,
            settle_time: 5.0,
            hold_time: 10.0,
            rms_window: 5.0,
            host_dt: 1.0 / 100.0,
        }
    }
}

/// Acceptance thresholds (ADR-0010).
pub const SETTLE_SPEED_LIMIT: f64 = 1e-4;
pub const DRIFT_LIMIT: f64 = 1e-3;
pub const VELOCITY_RMS_LIMIT: f64 = 1e-4;

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct ParkedResult {
    /// Speed over ground at the end of the settling period, m/s.
    pub settle_speed: f64,
    /// Planar displacement over the hold period, m.
    pub drift: f64,
    /// Mean creep speed over the hold period, m/s (drift / hold time).
    pub creep_speed: f64,
    /// RMS of the speed over the last `rms_window` of the hold, m/s.
    pub velocity_rms: f64,
    /// Largest speed seen after the settling period, m/s.
    pub max_speed: f64,
    /// Largest speed seen during the settling period, m/s.
    pub settle_max_speed: f64,
    /// All three criteria met: settled below 0.1 mm/s, less than 1 mm of
    /// drift over the hold, velocity RMS below 0.1 mm/s.
    pub holds: bool,
}

pub fn run(def: &VehicleDefinition, cfg: &ParkedConfig) -> Result<ParkedResult, String> {
    def.validate().map_err(|e| e.join("; "))?;
    if !(cfg.host_dt > 0.0) || !(cfg.settle_time >= 0.0) || !(cfg.hold_time > 0.0) {
        return Err(String::from("parked: times must be positive"));
    }
    let mut car = VehicleModel::new(def.clone());
    car.reset(0.0, 0.0, cfg.heading);
    car.set_ground_slope(cfg.grade, cfg.cross_slope);
    let rate = def.simulation.substep_rate_hz;
    let n_sub = m::max(m::round(cfg.host_dt * rate), 1.0) as usize;
    let sub_dt = cfg.host_dt / n_sub as f64;
    let input = VehicleInput {
        steer: 0.0,
        throttle: 0.0,
        brake: cfg.brake,
        handbrake: cfg.handbrake,
        ..VehicleInput::default()
    };
    let speed = |car: &VehicleModel| {
        let (vx, vy) = car.planar_velocity();
        m::hypot(vx, vy)
    };

    let settle_steps = m::round(cfg.settle_time / cfg.host_dt) as usize;
    let mut settle_max_speed: f64 = 0.0;
    for _ in 0..settle_steps {
        for _ in 0..n_sub {
            car.substep(sub_dt, &input);
        }
        settle_max_speed = m::max(settle_max_speed, speed(&car));
    }
    let settle_speed = speed(&car);
    let (x0, y0, _) = car.pose2d();

    let hold_steps = m::max(m::round(cfg.hold_time / cfg.host_dt), 1.0) as usize;
    let rms_steps = m::clamp(
        m::round(cfg.rms_window / cfg.host_dt),
        1.0,
        hold_steps as f64,
    ) as usize;
    let mut max_speed: f64 = 0.0;
    let mut sum_sq = 0.0;
    for step in 0..hold_steps {
        for _ in 0..n_sub {
            car.substep(sub_dt, &input);
        }
        let v = speed(&car);
        max_speed = m::max(max_speed, v);
        if step + rms_steps >= hold_steps {
            sum_sq += v * v;
        }
    }
    let (x1, y1, _) = car.pose2d();
    let drift = m::hypot(x1 - x0, y1 - y0);
    let velocity_rms = m::sqrt(sum_sq / rms_steps as f64);
    let holds = settle_speed < SETTLE_SPEED_LIMIT
        && drift < DRIFT_LIMIT
        && velocity_rms < VELOCITY_RMS_LIMIT;
    Ok(ParkedResult {
        settle_speed,
        drift,
        creep_speed: drift / cfg.hold_time,
        velocity_rms,
        max_speed,
        settle_max_speed,
        holds,
    })
}
