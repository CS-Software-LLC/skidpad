//! Straight-line acceleration from rest and braking from a target speed.
//! Reports 0–100 km/h time, quarter-mile time, and 100–0 km/h braking
//! distance. Used as a sanity check against published figures for the
//! reference vehicles.

use crate::definition::VehicleDefinition;
use crate::input::VehicleInput;
use crate::vehicle::BicycleVehicle;
use skidpad_math as m;

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct StraightLineConfig {
    /// Speed to reach before braking, m/s (default 100 km/h).
    pub target_speed: f64,
    /// Give up on acceleration after this many seconds.
    pub max_accel_time: f64,
    pub host_dt: f64,
}

impl Default for StraightLineConfig {
    fn default() -> Self {
        Self {
            target_speed: 100.0 / 3.6,
            max_accel_time: 60.0,
            host_dt: 1.0 / 100.0,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct StraightLineResult {
    /// Time to reach the target speed, s. `null` if never reached.
    pub accel_time: Option<f64>,
    /// Distance to reach the target speed, m.
    pub accel_distance: Option<f64>,
    /// Quarter-mile (402.336 m) time from rest, s.
    pub quarter_mile_time: Option<f64>,
    /// Braking distance from the target speed to rest, m.
    pub braking_distance: f64,
    /// Braking time, s.
    pub braking_time: f64,
    /// Mean deceleration during braking, m/s².
    pub mean_deceleration: f64,
    /// Whether any wheel locked during braking.
    pub wheel_locked: bool,
}

pub fn run(
    def: &VehicleDefinition,
    cfg: &StraightLineConfig,
) -> Result<StraightLineResult, String> {
    def.validate().map_err(|e| e.join("; "))?;
    let mut car = BicycleVehicle::new(def.clone());
    let rate = def.simulation.substep_rate_hz;
    let n_sub = m::max(m::round(cfg.host_dt * rate), 1.0) as usize;
    let sub_dt = cfg.host_dt / n_sub as f64;

    let full_throttle = VehicleInput {
        steer: 0.0,
        throttle: 1.0,
        brake: 0.0,
        handbrake: 0.0,
    };
    let mut accel_time = None;
    let mut accel_distance = None;
    let mut quarter_mile_time = None;
    let max_steps = (cfg.max_accel_time / cfg.host_dt) as usize;
    for _ in 0..max_steps {
        for _ in 0..n_sub {
            car.substep(sub_dt, &full_throttle);
        }
        if accel_time.is_none() && car.vx >= cfg.target_speed {
            accel_time = Some(car.time);
            accel_distance = Some(car.x);
        }
        if quarter_mile_time.is_none() && car.x >= 402.336 {
            quarter_mile_time = Some(car.time);
        }
        if accel_time.is_some() && (quarter_mile_time.is_some() || car.x > 402.336) {
            break;
        }
    }

    // Braking from exactly the target speed, wheels rolling.
    car.reset(0.0, 0.0, 0.0);
    car.set_speed(cfg.target_speed);
    let full_brake = VehicleInput {
        steer: 0.0,
        throttle: 0.0,
        brake: 1.0,
        handbrake: 0.0,
    };
    let mut locked = false;
    let mut steps = 0usize;
    while car.vx > 0.05 && steps < max_steps {
        for _ in 0..n_sub {
            car.substep(sub_dt, &full_brake);
        }
        locked |= car.axles[0].locked || car.axles[1].locked;
        steps += 1;
    }
    let braking_distance = car.x;
    let braking_time = car.time;
    let mean_decel = if braking_time > 0.0 {
        cfg.target_speed / braking_time
    } else {
        0.0
    };

    Ok(StraightLineResult {
        accel_time,
        accel_distance,
        quarter_mile_time,
        braking_distance,
        braking_time,
        mean_deceleration: mean_decel,
        wheel_locked: locked,
    })
}
