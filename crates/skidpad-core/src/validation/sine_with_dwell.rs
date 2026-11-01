//! Sine with dwell, after FMVSS 126 (49 CFR 571.126), the US test of
//! electronic stability control.
//!
//! A slowly increasing steer at 80 km/h finds `A`, the hand-wheel angle
//! that gives 0.3 g (S7.6). Then, from 80 km/h and coasting, the hand wheel
//! follows a 0.7 Hz sine with a 500 ms dwell at its second peak (S7.9), at
//! amplitudes from 1.5A up in steps of 0.5A to 6.5A or 270°, whichever is
//! larger, but not past 300°, starting each way.
//!
//! The car must stop turning once the steer ends (S5.2.1, S5.2.2): its yaw
//! rate 1.0 s and 1.75 s after the steer is complete may be at most 35 %
//! and 20 % of the first yaw-rate peak after the steer reverses. And it
//! must still turn (S5.2.3): on runs at 5A or more, the centre of mass has
//! moved at least 1.83 m sideways 1.07 s after the steer begins (1.52 m for
//! a GVWR over 3500 kg).
//!
//! The regulation filters measured signals (6 Hz Butterworth, roll and
//! sensor-position corrections) and integrates the lateral acceleration
//! twice for the displacement. The model's values are clean, so the yaw
//! rate is read as it is and the displacement is the centre of mass's
//! distance from the line it was running on at the beginning of steer.

use crate::definition::VehicleDefinition;
use crate::input::VehicleInput;
use crate::vehicle::VehicleModel;
use skidpad_math as m;

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct SineWithDwellConfig {
    /// Entry speed, m/s (default 80 km/h).
    pub speed: f64,
    /// Sine frequency, Hz (0.7).
    pub frequency: f64,
    /// Hold at the second peak, s (0.5).
    pub dwell: f64,
    /// Hand-wheel rate of the slowly increasing steer, rad/s (13.5°/s).
    pub sis_rate: f64,
    /// Lateral acceleration `A` is read at, m/s² (0.3 g).
    pub sis_target: f64,
    /// Smallest lateral displacement 1.07 s after the beginning of steer,
    /// m (1.83 m; 1.52 m above 3500 kg GVWR).
    pub min_displacement: f64,
    /// Turn stability control on whatever the definition says, as the test
    /// requires; false runs the car as defined.
    pub force_stability_control: bool,
    pub host_dt: f64,
}

impl Default for SineWithDwellConfig {
    fn default() -> Self {
        Self {
            speed: 80.0 / 3.6,
            frequency: 0.7,
            dwell: 0.5,
            sis_rate: 13.5 * DEG,
            sis_target: 0.3 * crate::GRAVITY,
            min_displacement: 1.83,
            force_stability_control: false,
            host_dt: 1.0 / 100.0,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct SineWithDwellRun {
    /// Commanded hand-wheel amplitude, rad.
    pub amplitude: f64,
    /// +1 when the first half-cycle steers left (counter-clockwise), −1 right.
    pub direction: f64,
    /// First yaw-rate peak after the steer reverses, rad/s (signed).
    pub peak_yaw_rate: f64,
    /// Yaw rate 1.0 s and 1.75 s after completion of steer over the peak.
    pub yaw_ratio_1: f64,
    pub yaw_ratio_175: f64,
    /// Lateral displacement 1.07 s after the beginning of steer, m, toward
    /// the first steer.
    pub lateral_displacement: f64,
    /// Both yaw-rate ratios within their limits.
    pub stable: bool,
    /// The displacement met, on runs at 5A or more; `None` below 5A.
    pub responsive: Option<bool>,
    /// The commanded amplitude was more than the car's steering lock.
    pub lock_limited: bool,
    /// Every sample finite (a car that spins out still completes; it fails
    /// the yaw-rate criteria instead).
    pub completed: bool,
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct SineWithDwellResult {
    /// Hand-wheel angle for 0.3 g in the slowly increasing steer, rad.
    pub amplitude_a: f64,
    /// Whether stability control was on for the runs.
    pub stability_control: bool,
    pub runs: Vec<SineWithDwellRun>,
    /// Largest yaw-rate ratios over all runs.
    pub worst_yaw_ratio_1: f64,
    pub worst_yaw_ratio_175: f64,
    /// Smallest displacement over the runs at 5A or more, m.
    pub min_lateral_displacement: f64,
    /// Smallest amplitude whose run failed, rad; `None` when all passed.
    pub first_failure: Option<f64>,
    /// Every run met every criterion that applies to it.
    pub passed: bool,
    /// Every run completed.
    pub completed: bool,
}

/// Yaw-rate ratio limits, S5.2.1 and S5.2.2.
pub const YAW_RATIO_1_LIMIT: f64 = 0.35;
pub const YAW_RATIO_175_LIMIT: f64 = 0.20;
/// Times after completion of steer the ratios are read at, s.
const T_RATIO_1: f64 = 1.0;
const T_RATIO_175: f64 = 1.75;
/// Time after the beginning of steer the displacement is read at, s.
const T_DISPLACEMENT: f64 = 1.07;
/// Hand-wheel angle that marks the beginning of steer, rad (5°).
const DEG: f64 = core::f64::consts::PI / 180.0;
const BOS_ANGLE: f64 = 5.0 * DEG;
/// Speed held before a run, s.
const LEAD_TIME: f64 = 2.0;

pub fn run(
    def: &VehicleDefinition,
    cfg: &SineWithDwellConfig,
) -> Result<SineWithDwellResult, String> {
    def.validate().map_err(|e| e.join("; "))?;
    if !(cfg.speed > 0.0)
        || !(cfg.frequency > 0.0)
        || !(cfg.dwell >= 0.0)
        || !(cfg.sis_rate > 0.0)
        || !(cfg.sis_target > 0.0)
        || !(cfg.host_dt > 0.0)
    {
        return Err(String::from(
            "sine with dwell: speed, frequency, sisRate, sisTarget and hostDt must be positive, dwell zero or more",
        ));
    }
    let mut def = def.clone();
    // The digital-input steering limit would cut the commanded angle.
    def.assists.steering_assist.enabled = false;
    if cfg.force_stability_control {
        def.assists.stability_control.enabled = true;
    }
    let amplitude_a = slowly_increasing_steer(&def, cfg);
    let a = m::abs(amplitude_a);

    // S7.9: 1.5A, 2A, … up to the larger of 6.5A and 270°, capped at 300°.
    let final_amp = m::min(m::max(6.5 * a, 270.0 * DEG), 300.0 * DEG);
    let mut amplitudes = Vec::new();
    if a > 0.0 && a.is_finite() {
        let mut k = 3.0;
        loop {
            let amp = k * 0.5 * a;
            if amp >= final_amp - 1e-9 {
                amplitudes.push(final_amp);
                break;
            }
            amplitudes.push(amp);
            k += 1.0;
            if amplitudes.len() > 200 {
                break;
            }
        }
    }

    let mut runs = Vec::new();
    for direction in [1.0, -1.0] {
        for &amp in &amplitudes {
            runs.push(one_run(&def, cfg, amp, direction, amp >= 5.0 * a - 1e-9));
        }
    }
    let mut worst1: f64 = 0.0;
    let mut worst175: f64 = 0.0;
    let mut min_disp = f64::INFINITY;
    let mut first_failure: Option<f64> = None;
    let mut completed = !runs.is_empty();
    for r in &runs {
        worst1 = m::max(worst1, r.yaw_ratio_1);
        worst175 = m::max(worst175, r.yaw_ratio_175);
        if r.responsive.is_some() {
            min_disp = m::min(min_disp, r.lateral_displacement);
        }
        let ok = r.completed && r.stable && r.responsive != Some(false);
        if !ok {
            first_failure = Some(match first_failure {
                Some(f) => m::min(f, r.amplitude),
                None => r.amplitude,
            });
        }
        completed &= r.completed;
    }
    Ok(SineWithDwellResult {
        amplitude_a: a,
        stability_control: def.assists.stability_control.enabled,
        runs,
        worst_yaw_ratio_1: worst1,
        worst_yaw_ratio_175: worst175,
        min_lateral_displacement: if min_disp.is_finite() { min_disp } else { 0.0 },
        first_failure,
        passed: completed && first_failure.is_none(),
        completed,
    })
}

/// Hand-wheel angle that gives `sis_target` at `speed`, from a steer that
/// grows at `sis_rate` while the speed is held (S7.6): the regression of
/// angle on lateral acceleration between 0.1 g and 0.375 g, read at 0.3 g.
/// Counter-clockwise and clockwise runs are averaged.
fn slowly_increasing_steer(def: &VehicleDefinition, cfg: &SineWithDwellConfig) -> f64 {
    let ratio = def.steering.ratio;
    let max_angle = def.max_wheel_angle();
    let g = crate::GRAVITY;
    let mut sum = 0.0;
    let mut n = 0.0;
    for direction in [1.0, -1.0] {
        let mut car = VehicleModel::new(def.clone());
        car.set_speed(cfg.speed);
        let (n_sub, sub_dt) = substeps(def, cfg.host_dt);
        let mut held = SpeedHold::default();
        let (mut xs, mut ys) = (Vec::new(), Vec::new());
        let lead = m::round(LEAD_TIME / cfg.host_dt) as usize;
        // Up to 0.5 g or full lock, as S7.6 steers to about 0.5 g.
        let steps = lead + m::round((ratio * max_angle / cfg.sis_rate) / cfg.host_dt) as usize;
        for step in 0..steps {
            let t = m::max(step as f64 - lead as f64, 0.0) * cfg.host_dt;
            let hand = cfg.sis_rate * t;
            let road = m::min(hand / ratio, max_angle);
            let input = VehicleInput {
                steer: -direction * road / max_angle,
                ..held.input(&car, cfg)
            };
            for _ in 0..n_sub {
                car.substep(sub_dt, &input);
            }
            let ay = direction * car.vx() * car.yaw_rate();
            if !ay.is_finite() {
                break;
            }
            if step >= lead {
                if ay >= 0.1 * g && ay <= 0.375 * g {
                    xs.push(ay);
                    ys.push(road * ratio);
                }
                if ay > 0.5 * g {
                    break;
                }
            }
        }
        if xs.len() >= 2 {
            let (slope, intercept) = super::linear_fit(&xs, &ys);
            sum += slope * cfg.sis_target + intercept;
            n += 1.0;
        }
    }
    if n > 0.0 {
        sum / n
    } else {
        f64::NAN
    }
}

/// Hand-wheel angle of the sine with dwell `t` s after it starts, rad.
fn sine_with_dwell(amp: f64, freq: f64, dwell: f64, t: f64) -> f64 {
    let w = 2.0 * core::f64::consts::PI * freq;
    let second_peak = 0.75 / freq;
    let end = 1.0 / freq + dwell;
    if t <= 0.0 || t >= end {
        0.0
    } else if t < second_peak {
        amp * m::sin(w * t)
    } else if t < second_peak + dwell {
        -amp
    } else {
        amp * m::sin(w * (t - dwell))
    }
}

/// One sine-with-dwell run at hand-wheel amplitude `amp` (rad), first
/// steering left for a `direction` of +1, right for −1; the displacement is
/// judged when `check_displacement` (runs at 5A or more). The definition is
/// used as given (`run` turns the steering assist off first).
pub fn single_run(
    def: &VehicleDefinition,
    cfg: &SineWithDwellConfig,
    amp: f64,
    direction: f64,
    check_displacement: bool,
) -> SineWithDwellRun {
    one_run(def, cfg, amp, direction, check_displacement)
}

/// Hand-wheel angle for `sis_target` from the slowly increasing steer, rad.
pub fn amplitude_a(def: &VehicleDefinition, cfg: &SineWithDwellConfig) -> f64 {
    m::abs(slowly_increasing_steer(def, cfg))
}

fn one_run(
    def: &VehicleDefinition,
    cfg: &SineWithDwellConfig,
    amp: f64,
    direction: f64,
    check_displacement: bool,
) -> SineWithDwellRun {
    let ratio = def.steering.ratio;
    let max_angle = def.max_wheel_angle();
    let mut car = VehicleModel::new(def.clone());
    car.set_speed(cfg.speed);
    let (n_sub, sub_dt) = substeps(def, cfg.host_dt);
    let mut held = SpeedHold::default();
    let lead = m::round(LEAD_TIME / cfg.host_dt) as usize;
    for _ in 0..lead {
        let input = held.input(&car, cfg);
        for _ in 0..n_sub {
            car.substep(sub_dt, &input);
        }
    }

    let completion = 1.0 / cfg.frequency + cfg.dwell;
    let reversal = 0.5 / cfg.frequency;
    let bos = m::asin(m::min(BOS_ANGLE / amp, 1.0)) / (2.0 * core::f64::consts::PI * cfg.frequency);
    let t_end = completion + T_RATIO_175 + cfg.host_dt;
    let steps = m::round(t_end / cfg.host_dt) as usize + 1;
    let mut lock_limited = false;
    let mut finite = true;
    // Samples at the end of each host step: time, yaw rate (positive in the
    // direction of the first steer), lateral offset.
    let mut ts = Vec::with_capacity(steps);
    let mut yaws = Vec::with_capacity(steps);
    let mut offs = Vec::with_capacity(steps);
    let (x0, y0, yaw0) = car.pose2d();
    let mut line: Option<(f64, f64, f64)> = None;
    let mut t = 0.0;
    for _ in 0..steps {
        for _ in 0..n_sub {
            let hand = direction * sine_with_dwell(amp, cfg.frequency, cfg.dwell, t + sub_dt);
            let road = hand / ratio;
            lock_limited |= m::abs(road) > max_angle + 1e-12;
            let input = VehicleInput {
                // Positive input steers right; the sine's positive half
                // steers left (counter-clockwise).
                steer: m::clamp(-road / max_angle, -1.0, 1.0),
                ..VehicleInput::default()
            };
            car.substep(sub_dt, &input);
            t += sub_dt;
            if line.is_none() && t >= bos {
                line = Some(car.pose2d());
            }
        }
        let r = direction * car.yaw_rate();
        let (x, y, _) = car.pose2d();
        let (lx, ly, lyaw) = line.unwrap_or((x0, y0, yaw0));
        // Left of the line the car ran on at BOS, toward the first steer.
        let off = direction * (-(x - lx) * m::sin(lyaw) + (y - ly) * m::cos(lyaw));
        finite &= r.is_finite() && off.is_finite();
        ts.push(t);
        yaws.push(r);
        offs.push(off);
    }

    // First yaw-rate peak after the steer reverses: the second lobe runs
    // the other way, so the peak is the most negative value before it
    // turns back.
    let mut peak = 0.0;
    for (&tk, &r) in ts.iter().zip(&yaws) {
        if tk < reversal {
            continue;
        }
        if r < peak {
            peak = r;
        } else if peak < 0.0 && r > peak {
            break;
        }
    }
    let at = |series: &[f64], when: f64| interpolate(&ts, series, when);
    let ratio_of = |when: f64| {
        if m::abs(peak) > 1e-6 {
            at(&yaws, when) / peak
        } else {
            0.0
        }
    };
    let yaw_ratio_1 = ratio_of(completion + T_RATIO_1);
    let yaw_ratio_175 = ratio_of(completion + T_RATIO_175);
    let lateral_displacement = at(&offs, bos + T_DISPLACEMENT);
    SineWithDwellRun {
        amplitude: amp,
        direction,
        peak_yaw_rate: direction * peak,
        yaw_ratio_1,
        yaw_ratio_175,
        lateral_displacement,
        stable: yaw_ratio_1 <= YAW_RATIO_1_LIMIT && yaw_ratio_175 <= YAW_RATIO_175_LIMIT,
        responsive: if check_displacement {
            Some(lateral_displacement >= cfg.min_displacement)
        } else {
            None
        },
        lock_limited,
        completed: finite,
    }
}

fn interpolate(ts: &[f64], ys: &[f64], t: f64) -> f64 {
    for k in 1..ts.len() {
        if ts[k] >= t {
            let u = (t - ts[k - 1]) / m::max(ts[k] - ts[k - 1], 1e-12);
            return ys[k - 1] + m::clamp(u, 0.0, 1.0) * (ys[k] - ys[k - 1]);
        }
    }
    ys.last().copied().unwrap_or(0.0)
}

fn substeps(def: &VehicleDefinition, host_dt: f64) -> (usize, f64) {
    let n = m::max(m::round(host_dt * def.simulation.substep_rate_hz), 1.0) as usize;
    (n, host_dt / n as f64)
}

/// Holds the entry speed with the same PI the step steer uses.
#[derive(Default)]
struct SpeedHold {
    integral: f64,
}

impl SpeedHold {
    fn input(&mut self, car: &VehicleModel, cfg: &SineWithDwellConfig) -> VehicleInput {
        let err = cfg.speed - car.vx();
        self.integral = m::clamp(self.integral + 0.4 * err * cfg.host_dt, -1.0, 1.0);
        let pedal = 0.6 * err + self.integral;
        VehicleInput {
            throttle: m::clamp(pedal, 0.0, 1.0),
            brake: m::clamp(-pedal, 0.0, 1.0),
            ..VehicleInput::default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_steer_follows_the_regulation_timing() {
        let amp = 1.0;
        let f = 0.7;
        let peak2 = 0.75 / f;
        // First peak at a quarter period, reversal at half, second peak held
        // for the dwell, completion a quarter period after the dwell.
        assert!(m::abs(sine_with_dwell(amp, f, 0.5, 0.25 / f) - 1.0) < 1e-12);
        assert!(m::abs(sine_with_dwell(amp, f, 0.5, 0.5 / f)) < 1e-12);
        assert_eq!(sine_with_dwell(amp, f, 0.5, peak2 + 0.25), -1.0);
        assert!(m::abs(sine_with_dwell(amp, f, 0.5, peak2 + 0.5) + 1.0) < 1e-12);
        assert!(m::abs(sine_with_dwell(amp, f, 0.5, 1.0 / f + 0.5 - 1e-9)) < 1e-6);
        assert_eq!(sine_with_dwell(amp, f, 0.5, 1.0 / f + 0.5 + 0.01), 0.0);
        // Completion of steer 1.929 s after it starts.
        assert!(m::abs(1.0 / f + 0.5 - 1.928_571) < 1e-5);
    }
}
