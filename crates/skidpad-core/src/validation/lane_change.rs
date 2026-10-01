//! Double lane change, after ISO 3888-1 (the "severe lane change" test
//! track) with the ISO 3888-2 ("moose test") course as an option.
//!
//! The course is five sections laid out along +x: an entry lane, a
//! transition, an offset lane to the left, a transition back, and the exit
//! lane. The lane widths depend on the vehicle's width as the standard
//! prescribes; the lateral offset of ISO 3888-1 is the standard's 3.5 m
//! between lane centres, that of ISO 3888-2 is `1 m + vehicle width`.
//!
//! A preview driver (pure pursuit on a smooth centreline through the
//! lanes) steers the car through at a held entry speed; the car is judged
//! by whether every wheel stayed inside the lanes of sections 1, 3 and 5,
//! which is where the cones stand, and by how hard it had to work: peak
//! lateral acceleration, yaw rate, steer, side slip and roll. Run at several
//! speeds the scenario reports the highest one that passed, which is the
//! usual single number quoted for a lane change.
//!
//! Sources: ISO 3888-1:2018 and ISO 3888-2:2011 for the geometry; the
//! pure-pursuit path tracker is from R. C. Coulter, *Implementation of the
//! Pure Pursuit Path Tracking Algorithm*, CMU-RI-TR-92-01 (1992).

use super::straight_line::STOP_SPEED;
use crate::definition::VehicleDefinition;
use crate::input::VehicleInput;
use crate::vehicle::VehicleModel;
use skidpad_math as m;

/// Which course to lay out.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub enum LaneChangeCourse {
    /// ISO 3888-1: 15 / 30 / 25 / 25 / 15 m, 3.5 m between lane centres.
    #[default]
    Iso3888Part1,
    /// ISO 3888-2: 12 / 13.5 / 11 / 12.5 / 12 m, offset `1 m + width`.
    Iso3888Part2,
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct LaneChangeConfig {
    pub course: LaneChangeCourse,
    /// Entry speeds to try, m/s, in increasing order (default 50 to 110
    /// km/h in steps of 10).
    pub speeds: Vec<f64>,
    /// Overall vehicle width, m. Zero means `trackWidth + 0.25`.
    pub vehicle_width: f64,
    /// Preview time of the driver, s; the look-ahead is this times the
    /// speed, floored at `min_preview`.
    pub preview_time: f64,
    /// Smallest look-ahead distance, m.
    pub min_preview: f64,
    /// How far ahead of the car, in seconds of travel, the path curvature
    /// is read for the feedforward steer: about the car's own yaw response
    /// time, so the steer leads the curve by what the tires need.
    pub feedforward_lead: f64,
    /// Whether the throttle holds the entry speed (true) or is released at
    /// the start of the course (ISO 3888-2's instruction).
    pub hold_speed: bool,
    /// Practice runs per speed. After each run the driver corrects its
    /// steering along the course by the path error it saw (iterative
    /// learning), as a test driver does; the best run is reported. 1 is a
    /// single blind run.
    pub learning_passes: u32,
    pub host_dt: f64,
}

impl Default for LaneChangeConfig {
    fn default() -> Self {
        Self {
            course: LaneChangeCourse::Iso3888Part1,
            speeds: vec![
                50.0 / 3.6,
                60.0 / 3.6,
                70.0 / 3.6,
                80.0 / 3.6,
                90.0 / 3.6,
                100.0 / 3.6,
                110.0 / 3.6,
            ],
            vehicle_width: 0.0,
            preview_time: 0.35,
            min_preview: 4.0,
            feedforward_lead: 0.2,
            hold_speed: true,
            learning_passes: 4,
            host_dt: 1.0 / 100.0,
        }
    }
}

/// One attempt at one entry speed.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct LaneChangeAttempt {
    pub entry_speed: f64,
    /// Speed at the end of the course, m/s.
    pub exit_speed: f64,
    /// Every wheel stayed inside the coned lanes of sections 1, 3 and 5.
    pub passed: bool,
    /// Largest excursion of a wheel beyond a lane edge, m (zero if passed).
    pub cone_overlap: f64,
    /// Largest lateral distance of the centre of mass from the centreline
    /// the driver aimed for, m.
    pub max_path_error: f64,
    pub max_lat_accel: f64,
    pub max_yaw_rate: f64,
    /// Largest road-wheel steer angle, rad.
    pub max_steer_angle: f64,
    /// Largest body side-slip angle, rad.
    pub max_body_slip_angle: f64,
    /// Largest body roll, rad.
    pub max_roll: f64,
    /// The car reached the end of the course with every sample finite.
    pub completed: bool,
    /// Which practice run this is (0 is the blind run).
    pub practice_run: u32,
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct LaneChangeResult {
    pub course: LaneChangeCourse,
    /// Vehicle width the lanes were sized for, m.
    pub vehicle_width: f64,
    /// Lane widths of sections 1, 3 and 5, m.
    pub lane_widths: [f64; 3],
    /// Lateral offset between the entry lane and the offset lane centres, m.
    pub lane_offset: f64,
    /// Length of the whole course, m.
    pub course_length: f64,
    pub attempts: Vec<LaneChangeAttempt>,
    /// Highest entry speed that passed, m/s. `None` when none did.
    pub max_passing_speed: Option<f64>,
}

/// Section lengths along x and the lane-width multipliers of the coned
/// sections `(s1, s3, s5)` per standard.
struct Course {
    lengths: [f64; 5],
    width_factors: [f64; 3],
    width_adds: [f64; 3],
    offset: f64,
}

fn course(kind: LaneChangeCourse, vehicle_width: f64) -> Course {
    match kind {
        LaneChangeCourse::Iso3888Part1 => Course {
            lengths: [15.0, 30.0, 25.0, 25.0, 15.0],
            width_factors: [1.1, 1.2, 1.3],
            width_adds: [0.25, 0.25, 0.25],
            offset: 3.5,
        },
        LaneChangeCourse::Iso3888Part2 => Course {
            lengths: [12.0, 13.5, 11.0, 12.5, 12.0],
            width_factors: [1.1, 1.0, 1.3],
            width_adds: [0.25, 1.0, 0.25],
            offset: 1.0 + vehicle_width,
        },
    }
}

/// Lateral position of the centreline the driver follows at `x`: the lane
/// centres joined by cosine blends over the transitions, which keeps the
/// path curvature continuous.
fn centreline(c: &Course, x: f64) -> f64 {
    let [l1, l2, l3, l4, _] = c.lengths;
    let x1 = l1;
    let x2 = l1 + l2;
    let x3 = l1 + l2 + l3;
    let x4 = l1 + l2 + l3 + l4;
    let blend = |s: f64| 0.5 - 0.5 * m::cos(m::PI * m::clamp(s, 0.0, 1.0));
    if x < x1 {
        0.0
    } else if x < x2 {
        c.offset * blend((x - x1) / l2)
    } else if x < x3 {
        c.offset
    } else if x < x4 {
        c.offset * (1.0 - blend((x - x3) / l4))
    } else {
        0.0
    }
}

/// Curvature of the centreline at `x`, 1/m, positive turning left.
fn centreline_curvature(c: &Course, x: f64) -> f64 {
    let [l1, l2, l3, l4, _] = c.lengths;
    let x1 = l1;
    let x2 = l1 + l2;
    let x3 = l1 + l2 + l3;
    let x4 = l1 + l2 + l3 + l4;
    // y = off · (½ − ½ cos(π s)) over a transition of length `len`:
    // y' = off · π/(2 len) · sin(π s), y'' = off · π²/(2 len²) · cos(π s).
    let (sign, s, len) = if (x1..x2).contains(&x) {
        (1.0, (x - x1) / l2, l2)
    } else if (x3..x4).contains(&x) {
        (-1.0, (x - x3) / l4, l4)
    } else {
        return 0.0;
    };
    let dy = sign * c.offset * m::PI / (2.0 * len) * m::sin(m::PI * s);
    let ddy = sign * c.offset * m::PI * m::PI / (2.0 * len * len) * m::cos(m::PI * s);
    let n = 1.0 + dy * dy;
    ddy / (n * m::sqrt(n))
}

/// The coned lane at `x`, as `(centre, half width)`; `None` in a
/// transition, where the car may go where it likes.
fn lane_at(c: &Course, widths: &[f64; 3], x: f64) -> Option<(f64, f64)> {
    let [l1, l2, l3, l4, l5] = c.lengths;
    if x < 0.0 {
        None
    } else if x < l1 {
        Some((0.0, 0.5 * widths[0]))
    } else if x < l1 + l2 {
        None
    } else if x < l1 + l2 + l3 {
        Some((c.offset, 0.5 * widths[1]))
    } else if x < l1 + l2 + l3 + l4 {
        None
    } else if x < l1 + l2 + l3 + l4 + l5 {
        Some((0.0, 0.5 * widths[2]))
    } else {
        None
    }
}

pub fn run(def: &VehicleDefinition, cfg: &LaneChangeConfig) -> Result<LaneChangeResult, String> {
    def.validate().map_err(|e| e.join("; "))?;
    if cfg.speeds.is_empty() || cfg.speeds.iter().any(|&v| !(v > 0.0)) {
        return Err(String::from("lane change: speeds must be positive"));
    }
    if !(cfg.host_dt > 0.0) {
        return Err(String::from("lane change: hostDt must be positive"));
    }
    let vehicle_width = if cfg.vehicle_width > 0.0 {
        cfg.vehicle_width
    } else {
        def.chassis.track_width + 0.25
    };
    let c = course(cfg.course, vehicle_width);
    let widths = [
        c.width_factors[0] * vehicle_width + c.width_adds[0],
        c.width_factors[1] * vehicle_width + c.width_adds[1],
        c.width_factors[2] * vehicle_width + c.width_adds[2],
    ];
    let course_length: f64 = c.lengths.iter().sum();
    let kus = super::understeer::linear_understeer_gradient(def);
    let max_angle = def.max_wheel_angle();
    let wheelbase = def.chassis.wheelbase;
    let half_track = 0.5 * def.chassis.track_width;
    let tire_half_width = 0.5 * (vehicle_width - def.chassis.track_width);

    // The learned steering correction lives on a grid along x.
    const GRID: f64 = 0.5;
    let mut attempts = Vec::with_capacity(cfg.speeds.len());
    let mut max_passing = None;
    for &entry in &cfg.speeds {
        let preview = m::max(cfg.preview_time * entry, cfg.min_preview);
        // The car starts two preview lengths before the first cone so the
        // driver is settled on the centreline when it enters.
        let start_x = -2.0 * preview - 5.0;
        let cells = ((course_length - start_x + 10.0) / GRID) as usize + 2;
        let mut correction = vec![0.0f64; cells];
        let mut errors = vec![0.0f64; cells];
        let mut best: Option<LaneChangeAttempt> = None;
        for pass in 0..cfg.learning_passes.max(1) {
            let geometry = CourseRun {
                course: &c,
                widths: &widths,
                course_length,
                vehicle_width,
                half_track,
                tire_half_width,
                kus,
                max_angle,
                preview,
                start_x,
            };
            errors.iter_mut().for_each(|e| *e = 0.0);
            let mut attempt =
                run_course(def, cfg, entry, &geometry, &correction, GRID, &mut errors);
            attempt.practice_run = pass;
            let better = match &best {
                None => true,
                Some(b) => {
                    attempt.completed
                        && (attempt.cone_overlap < b.cone_overlap
                            || (attempt.cone_overlap == b.cone_overlap
                                && attempt.max_path_error < b.max_path_error))
                }
            };
            if better {
                best = Some(attempt.clone());
            }
            if !attempt.completed || attempt.passed && attempt.max_path_error < 0.05 {
                break;
            }
            // Learn: steer more toward where the car should have been, a
            // response lead ahead of each grid cell, with half the
            // pure-pursuit gain so the update converges.
            let lead = (cfg.feedforward_lead * entry / GRID) as usize;
            let gain = 0.5 * 2.0 * wheelbase / (preview * preview);
            for (i, corr) in correction.iter_mut().enumerate() {
                let j = (i + lead).min(cells - 1);
                *corr += gain * errors[j];
            }
        }
        let attempt = best.unwrap_or(LaneChangeAttempt {
            entry_speed: entry,
            exit_speed: 0.0,
            passed: false,
            cone_overlap: 0.0,
            max_path_error: 0.0,
            max_lat_accel: 0.0,
            max_yaw_rate: 0.0,
            max_steer_angle: 0.0,
            max_body_slip_angle: 0.0,
            max_roll: 0.0,
            completed: false,
            practice_run: 0,
        });
        if attempt.passed {
            max_passing = Some(entry);
        }
        attempts.push(attempt);
    }
    Ok(LaneChangeResult {
        course: cfg.course,
        vehicle_width,
        lane_widths: widths,
        lane_offset: c.offset,
        course_length,
        attempts,
        max_passing_speed: max_passing,
    })
}

/// Everything one practice run needs besides the definition and config.
struct CourseRun<'a> {
    course: &'a Course,
    widths: &'a [f64; 3],
    course_length: f64,
    vehicle_width: f64,
    half_track: f64,
    tire_half_width: f64,
    kus: f64,
    max_angle: f64,
    preview: f64,
    start_x: f64,
}

/// One run through the course at `entry` speed with a learned steering
/// correction on a grid of `grid` metres from `start_x`. Writes the path
/// error seen at each grid cell into `errors` (positive: the car was to the
/// right of the centreline and needed more left steer).
#[allow(clippy::too_many_arguments)]
fn run_course(
    def: &VehicleDefinition,
    cfg: &LaneChangeConfig,
    entry: f64,
    g: &CourseRun<'_>,
    correction: &[f64],
    grid: f64,
    errors: &mut [f64],
) -> LaneChangeAttempt {
    let c = g.course;
    let _ = g.vehicle_width;
    let mut car = VehicleModel::new(def.clone());
    car.reset(g.start_x, 0.0, 0.0);
    car.set_speed(entry);
    let rate = def.simulation.substep_rate_hz;
    let n_sub = m::max(m::round(cfg.host_dt * rate), 1.0) as usize;
    let sub_dt = cfg.host_dt / n_sub as f64;
    let kp_speed = 0.6;
    let ki_speed = 0.4;
    let mut speed_integral = 0.0;
    let wheelbase = def.chassis.wheelbase;
    let cells = errors.len();
    let cell_of = |x: f64| -> usize {
        let i = (x - g.start_x) / grid;
        if i < 0.0 {
            0
        } else {
            (i as usize).min(cells - 1)
        }
    };

    let mut passed = true;
    let mut overlap: f64 = 0.0;
    let mut max_err: f64 = 0.0;
    let mut max_ay: f64 = 0.0;
    let mut max_r: f64 = 0.0;
    let mut max_delta: f64 = 0.0;
    let mut max_beta: f64 = 0.0;
    let mut max_roll: f64 = 0.0;
    let mut finite = true;
    let max_steps =
        m::round((g.course_length - g.start_x + 20.0) / (0.2 * entry * cfg.host_dt)) as usize;
    let mut steps = 0;
    loop {
        let (x, y, yaw) = car.pose2d();
        if !(x.is_finite() && y.is_finite() && yaw.is_finite()) {
            finite = false;
            break;
        }
        if x >= g.course_length + 1.0 || steps >= max_steps || car.vx() < STOP_SPEED {
            break;
        }
        // Preview driver: the path's own curvature a response time ahead
        // of the car as feedforward, plus pure pursuit on the lateral error
        // of a point one preview ahead (the curvature of the arc through
        // it, Coulter 1992), through the bicycle geometry with the linear
        // understeer gradient, plus what the previous runs taught.
        let x_goal = x + g.preview;
        let y_goal = centreline(c, x_goal);
        let (sy, cy) = (m::sin(yaw), m::cos(yaw));
        let dx = x_goal - x;
        let dy = y_goal - y;
        let lateral = -dx * sy + dy * cy;
        let ld2 = m::max(dx * dx + dy * dy, 1e-6);
        let speed_now = m::max(car.vx(), 1.0);
        let x_ff = x + cfg.feedforward_lead * speed_now;
        let curvature = centreline_curvature(c, x_ff) + 2.0 * lateral / ld2;
        let learned = {
            let i = cell_of(x);
            let f = m::clamp((x - g.start_x) / grid - i as f64, 0.0, 1.0);
            let a = correction[i];
            let b = correction[(i + 1).min(correction.len() - 1)];
            a + (b - a) * f
        };
        let delta = m::clamp(
            m::atan(wheelbase * curvature) + g.kus * speed_now * speed_now * curvature + learned,
            -g.max_angle,
            g.max_angle,
        );

        let speed = car.vx();
        let on_course = x >= 0.0;
        let (throttle, brake) = if cfg.hold_speed || !on_course {
            speed_integral = m::clamp(
                speed_integral + ki_speed * (entry - speed) * cfg.host_dt,
                -1.0,
                1.0,
            );
            let pedal = kp_speed * (entry - speed) + speed_integral;
            (m::clamp(pedal, 0.0, 1.0), m::clamp(-pedal, 0.0, 1.0))
        } else {
            (0.0, 0.0)
        };
        let input = VehicleInput {
            steer: -delta / g.max_angle,
            throttle,
            brake,
            ..VehicleInput::default()
        };
        for _ in 0..n_sub {
            car.substep(sub_dt, &input);
        }
        steps += 1;

        // Judge the car after the step, at its new pose.
        let (x, y, yaw) = car.pose2d();
        let r = car.yaw_rate();
        let ay = car.lat_accel();
        let (beta, roll) = slip_and_roll(&car);
        finite &= r.is_finite() && ay.is_finite() && beta.is_finite() && roll.is_finite();
        max_ay = m::max(max_ay, m::abs(ay));
        max_r = m::max(max_r, m::abs(r));
        max_delta = m::max(max_delta, m::abs(car.steer_angle()));
        max_beta = m::max(max_beta, m::abs(beta));
        max_roll = m::max(max_roll, m::abs(roll));
        let err = centreline(c, x) - y;
        if x >= 0.0 && x <= g.course_length {
            max_err = m::max(max_err, m::abs(err));
        }
        let i = cell_of(x);
        errors[i] = err;
        // Each wheel's outer edge against its section's lane.
        let (sy, cy) = (m::sin(yaw), m::cos(yaw));
        let a = def.chassis.cg_to_front_axle;
        let b = def.cg_to_rear_axle();
        for (wx, wy) in [
            (a, g.half_track),
            (a, -g.half_track),
            (-b, g.half_track),
            (-b, -g.half_track),
        ] {
            let px = x + wx * cy - wy * sy;
            let py = y + wx * sy + wy * cy;
            if let Some((centre, half)) = lane_at(c, g.widths, px) {
                let excess = m::abs(py - centre) + g.tire_half_width - half;
                if excess > 0.0 {
                    passed = false;
                    overlap = m::max(overlap, excess);
                }
            }
        }
    }
    let (x_end, _, _) = car.pose2d();
    let completed = finite && x_end >= g.course_length;
    LaneChangeAttempt {
        entry_speed: entry,
        exit_speed: car.vx(),
        passed: passed && completed,
        cone_overlap: overlap,
        max_path_error: max_err,
        max_lat_accel: max_ay,
        max_yaw_rate: max_r,
        max_steer_angle: max_delta,
        max_body_slip_angle: max_beta,
        max_roll,
        completed,
        practice_run: 0,
    }
}

fn slip_and_roll(car: &VehicleModel) -> (f64, f64) {
    match car {
        VehicleModel::FourWheel(v) => {
            let vb = v.vel_body();
            let (_, _, roll) = v.orient.to_yaw_pitch_roll();
            (m::atan2(vb.y, m::max(m::abs(vb.x), 0.1)), roll)
        }
        VehicleModel::SingleTrack(v) => (m::atan2(v.vy, m::max(m::abs(v.vx), 0.1)), 0.0),
    }
}
