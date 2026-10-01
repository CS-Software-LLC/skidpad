//! Straight-line acceleration from rest and braking from a target speed.
//! Reports 0–100 km/h time, quarter-mile time, and 100–0 km/h braking
//! distance, used as a sanity check against published figures for the
//! reference vehicles, plus the locked-brake behaviour (milestone 3): when
//! the brakes exceed the tires' grip the wheels must lock once and stay
//! locked, the deceleration on sliding friction must be smooth, and the
//! car must come to a clean rest on the held brake.

use crate::definition::VehicleDefinition;
use crate::input::VehicleInput;
use crate::vehicle::VehicleModel;
use skidpad_math as m;

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct StraightLineConfig {
    /// Speed to reach before braking, m/s (default 100 km/h).
    pub target_speed: f64,
    /// Give up on acceleration after this many seconds. Zero skips the
    /// acceleration phase and reports only the braking.
    pub max_accel_time: f64,
    /// How long the brake stays held after the car has stopped, s. The
    /// largest speed over this window is `rest_speed`.
    pub rest_time: f64,
    pub host_dt: f64,
}

impl Default for StraightLineConfig {
    fn default() -> Self {
        Self {
            target_speed: 100.0 / 3.6,
            max_accel_time: 60.0,
            rest_time: 2.0,
            host_dt: 1.0 / 100.0,
        }
    }
}

/// Speed below which the car counts as stopped, m/s.
pub const STOP_SPEED: f64 = 0.05;
/// Give up on braking after this long, s.
pub const MAX_BRAKE_TIME: f64 = 60.0;
/// The deceleration ripple is measured from this long after the first lock
/// (so the pitch transient of the brake application has died down) …
pub const RIPPLE_START_AFTER_LOCK: f64 = 0.5;
/// … until the car slows to this speed, m/s, where the low-speed tire
/// handling takes over.
pub const RIPPLE_END_SPEED: f64 = 3.0;
/// The ripple is taken about a centred moving average of this width, s, so
/// the slow drift of the deceleration with speed (aero drag, the friction
/// curve, the pitch settling) is not counted while anything at the
/// wheel-hop and lock-chatter frequencies is.
pub const RIPPLE_WINDOW: f64 = 0.2;

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
    /// Time from brake application to the first wheel lock, s. `None` when
    /// no wheel locked.
    pub lock_time: Option<f64>,
    /// Number of substeps at which some wheel changed between rolling and
    /// locked, over the whole braking phase. A car whose wheels lock once
    /// each shows at most one transition per wheel.
    pub lock_transitions: u32,
    /// Number of times a locked wheel released while the car was still
    /// moving. Any value above zero is lock chatter.
    pub lock_releases: u32,
    /// Relative RMS ripple of the host-step deceleration while the wheels
    /// slide, from [`RIPPLE_START_AFTER_LOCK`] after the first lock until
    /// [`RIPPLE_END_SPEED`], about its moving average over
    /// [`RIPPLE_WINDOW`] (aero drag and the friction curve make the mean
    /// deceleration drift with speed; that is not ripple). Zero when that
    /// window is empty.
    pub locked_decel_ripple: f64,
    /// Largest speed over `rest_time` after the stop, brake still held, m/s.
    /// This is the spring-back of the contact-patch deflection the sliding
    /// tires stored (ADR-0010), the lurch a hard stop gives.
    pub rest_speed: f64,
    /// Speed at the end of the rest window, m/s. A clean stop leaves the car
    /// at rest on its locked wheels.
    pub settled_speed: f64,
    /// Planar displacement over the rest window, m: how far the spring-back
    /// moved the car.
    pub rest_distance: f64,
}

pub fn run(
    def: &VehicleDefinition,
    cfg: &StraightLineConfig,
) -> Result<StraightLineResult, String> {
    def.validate().map_err(|e| e.join("; "))?;
    let mut car = VehicleModel::new(def.clone());
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
    let max_steps = m::round(m::max(cfg.max_accel_time, 0.0) / cfg.host_dt) as usize;
    for _ in 0..max_steps {
        for _ in 0..n_sub {
            car.substep(sub_dt, &full_throttle);
        }
        let x = car.pose2d().0;
        if accel_time.is_none() && car.vx() >= cfg.target_speed {
            accel_time = Some(car.time());
            accel_distance = Some(x);
        }
        if quarter_mile_time.is_none() && x >= 402.336 {
            quarter_mile_time = Some(car.time());
        }
        if accel_time.is_some() && (quarter_mile_time.is_some() || x > 402.336) {
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
    let mut lock_time = None;
    let mut lock_transitions = 0u32;
    let mut lock_releases = 0u32;
    let mut prev_mask = car.locked_mask();
    // Per-host-step deceleration over the sliding window.
    let mut ripple_a = Vec::new();
    let max_brake_steps = m::round(MAX_BRAKE_TIME / cfg.host_dt) as usize;
    let mut steps = 0usize;
    while car.vx() > STOP_SPEED && steps < max_brake_steps {
        let v_before = car.vx();
        for _ in 0..n_sub {
            car.substep(sub_dt, &full_brake);
            let mask = car.locked_mask();
            if mask != prev_mask {
                lock_transitions += 1;
                if prev_mask & !mask != 0 {
                    lock_releases += 1;
                }
                if mask != 0 && lock_time.is_none() {
                    lock_time = Some(car.time());
                    locked = true;
                }
                prev_mask = mask;
            }
        }
        if let Some(t0) = lock_time {
            if car.time() >= t0 + RIPPLE_START_AFTER_LOCK && car.vx() > RIPPLE_END_SPEED {
                ripple_a.push((v_before - car.vx()) / cfg.host_dt);
            }
        }
        steps += 1;
    }
    let braking_distance = car.pose2d().0;
    let braking_time = car.time();
    let mean_decel = if braking_time > 0.0 {
        cfg.target_speed / braking_time
    } else {
        0.0
    };
    let locked_decel_ripple = decel_ripple(&ripple_a, cfg.host_dt);

    // Hold the brake after the stop: the car must stay put.
    let rest_steps = m::round(m::max(cfg.rest_time, 0.0) / cfg.host_dt) as usize;
    let (stop_x, stop_y, _) = car.pose2d();
    let mut rest_speed: f64 = 0.0;
    for _ in 0..rest_steps {
        for _ in 0..n_sub {
            car.substep(sub_dt, &full_brake);
        }
        rest_speed = m::max(rest_speed, car.speed());
    }
    let settled_speed = car.speed();
    let (end_x, end_y, _) = car.pose2d();
    let rest_distance = m::hypot(end_x - stop_x, end_y - stop_y);

    Ok(StraightLineResult {
        accel_time,
        accel_distance,
        quarter_mile_time,
        braking_distance,
        braking_time,
        mean_deceleration: mean_decel,
        wheel_locked: locked,
        lock_time,
        lock_transitions,
        lock_releases,
        locked_decel_ripple,
        rest_speed,
        settled_speed,
        rest_distance,
    })
}

/// Relative RMS of a deceleration series about its centred moving average
/// over [`RIPPLE_WINDOW`]. Zero when the series is shorter than the window.
fn decel_ripple(a: &[f64], host_dt: f64) -> f64 {
    let half = m::max(m::round(0.5 * RIPPLE_WINDOW / host_dt), 1.0) as usize;
    if a.len() < 2 * half + 1 {
        return 0.0;
    }
    let mut sum_sq = 0.0;
    let mut sum = 0.0;
    let mut n = 0.0;
    for i in half..a.len() - half {
        let window = &a[i - half..=i + half];
        let mean = window.iter().sum::<f64>() / window.len() as f64;
        let r = a[i] - mean;
        sum_sq += r * r;
        sum += a[i];
        n += 1.0;
    }
    let mean = sum / n;
    if mean > 0.0 {
        m::sqrt(sum_sq / n) / mean
    } else {
        0.0
    }
}
