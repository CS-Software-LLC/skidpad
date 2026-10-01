//! Driving assists (ADR-0013): anti-lock braking, traction control,
//! stability control and the speed-sensitive steering limit, as a stateless
//! stage inside the core so replays reproduce them. Each substep the stage
//! reads the current slips, speed and yaw rate and scales this substep's
//! brake capacities, throttle and steer angle; it carries no state, so the
//! snapshot layout is untouched. Everything is off by default.

use crate::GRAVITY;
use skidpad_math as m;

#[derive(Clone, Debug, PartialEq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct AssistsDef {
    pub abs: AbsDef,
    pub traction_control: TractionControlDef,
    pub stability_control: StabilityControlDef,
    pub steering_assist: SteeringAssistDef,
}

/// Anti-lock braking: an ideal, continuous modulation of each wheel's brake
/// capacity on its braking slip ratio.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct AbsDef {
    pub enabled: bool,
    /// Braking slip ratio magnitude where modulation starts (the tire's
    /// force peak).
    pub slip_target: f64,
    /// Slip ratio magnitude where the capacity is at its floor.
    pub slip_release: f64,
    /// Smallest fraction of the brake capacity left to the wheel.
    pub floor: f64,
    /// Below this speed, m/s, the assist stands down and wheels may lock.
    pub min_speed: f64,
}

impl Default for AbsDef {
    fn default() -> Self {
        Self {
            enabled: false,
            slip_target: 0.12,
            slip_release: 0.3,
            floor: 0.15,
            min_speed: 2.0,
        }
    }
}

/// Traction control: scales the throttle on the largest driven-wheel drive
/// slip.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct TractionControlDef {
    pub enabled: bool,
    /// Drive slip ratio where the cut starts.
    pub slip_target: f64,
    /// Drive slip ratio where the throttle is fully cut.
    pub slip_release: f64,
}

impl Default for TractionControlDef {
    fn default() -> Self {
        Self {
            enabled: false,
            slip_target: 0.10,
            slip_release: 0.25,
        }
    }
}

/// Stability control: brakes one wheel on the yaw-rate error against the
/// neutral-steer reference and cuts the throttle.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct StabilityControlDef {
    pub enabled: bool,
    /// Brake torque per rad/s of yaw-rate error, N·m/(rad/s).
    pub gain: f64,
    /// Yaw-rate error ignored, rad/s.
    pub dead_band: f64,
    /// Throttle cut per rad/s of error (1 removes all throttle at 1 rad/s).
    pub throttle_cut: f64,
    /// Below this speed, m/s, the assist stands down.
    pub min_speed: f64,
}

impl Default for StabilityControlDef {
    fn default() -> Self {
        Self {
            enabled: false,
            gain: 1500.0,
            dead_band: 0.05,
            throttle_cut: 1.0,
            min_speed: 3.0,
        }
    }
}

/// Speed-sensitive steering limit for digital inputs: the road-wheel angle
/// is capped at the one a steady turn at this lateral acceleration needs.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct SteeringAssistDef {
    pub enabled: bool,
    /// Lateral acceleration the limit aims for, m/s².
    pub lat_accel_limit: f64,
}

impl Default for SteeringAssistDef {
    fn default() -> Self {
        Self {
            enabled: false,
            lat_accel_limit: 9.0,
        }
    }
}

impl AssistsDef {
    pub fn validate(&self, prefix: &str, e: &mut Vec<String>) {
        let a = &self.abs;
        if !(a.slip_target > 0.0 && a.slip_release > a.slip_target) {
            e.push(format!(
                "{prefix}.abs.slipRelease must exceed slipTarget, both positive (got {} and {})",
                a.slip_target, a.slip_release
            ));
        }
        if !(0.0..=1.0).contains(&a.floor) {
            e.push(format!(
                "{prefix}.abs.floor must be in [0, 1] (got {})",
                a.floor
            ));
        }
        if !(a.min_speed >= 0.0) {
            e.push(format!(
                "{prefix}.abs.minSpeed must be zero or positive (got {})",
                a.min_speed
            ));
        }
        let t = &self.traction_control;
        if !(t.slip_target > 0.0 && t.slip_release > t.slip_target) {
            e.push(format!(
                "{prefix}.tractionControl.slipRelease must exceed slipTarget, both positive (got {} and {})",
                t.slip_target, t.slip_release
            ));
        }
        let s = &self.stability_control;
        for (name, v) in [
            ("gain", s.gain),
            ("deadBand", s.dead_band),
            ("throttleCut", s.throttle_cut),
            ("minSpeed", s.min_speed),
        ] {
            if !(v >= 0.0) {
                e.push(format!(
                    "{prefix}.stabilityControl.{name} must be zero or positive (got {v})"
                ));
            }
        }
        if !(self.steering_assist.lat_accel_limit > 0.0) {
            e.push(format!(
                "{prefix}.steeringAssist.latAccelLimit must be positive (got {})",
                self.steering_assist.lat_accel_limit
            ));
        }
    }

    /// Whether any assist is on.
    pub fn any_enabled(&self) -> bool {
        self.abs.enabled
            || self.traction_control.enabled
            || self.stability_control.enabled
            || self.steering_assist.enabled
    }
}

/// What the stage reports for telemetry.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct AssistTelemetry {
    /// 1 − the smallest brake scale applied by the ABS this substep.
    pub abs_activity: f64,
    /// 1 − the throttle scale applied by the traction control.
    pub tc_activity: f64,
    /// Yaw-rate error past the dead band, rad/s (positive: yawing faster
    /// than the reference, in the turn's direction).
    pub esc_yaw_error: f64,
    /// Brake torque the stability control applied, N·m.
    pub esc_brake_torque: f64,
    /// Steer scale of the steering assist, 1 when not limiting.
    pub steer_assist_scale: f64,
    /// Throttle that reached the power unit.
    pub throttle_effective: f64,
}

/// One wheel as the stage sees it.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct WheelObs {
    /// Kinematic slip ratio this substep.
    pub kappa: f64,
    pub driven: bool,
    pub front: bool,
    /// +1 left, −1 right, 0 for a lumped single-track axle.
    pub side: f64,
}

/// `clamp((release − x) / (release − target), floor, 1)`: 1 up to the
/// target, the floor at the release.
#[inline]
fn modulation(x: f64, target: f64, release: f64, floor: f64) -> f64 {
    m::clamp((release - x) / m::max(release - target, 1e-9), floor, 1.0)
}

/// Steer scale of the speed-sensitive limit: 1 when the full lock stays
/// below the lateral-acceleration limit at this speed.
pub fn steer_scale(def: &SteeringAssistDef, speed: f64, wheelbase: f64, max_angle: f64) -> f64 {
    if !def.enabled {
        return 1.0;
    }
    let limit = wheelbase * def.lat_accel_limit / m::max(speed * speed, 1e-3);
    m::clamp(limit / m::max(max_angle, 1e-9), 0.0, 1.0)
}

/// Apply the assists for one substep. `caps` are the wheels' brake torque
/// capacities, scaled and added to in place. Returns the throttle that
/// reaches the power unit.
#[allow(clippy::too_many_arguments)]
pub fn apply(
    def: &AssistsDef,
    wheels: &[WheelObs],
    caps: &mut [f64],
    speed: f64,
    yaw_rate: f64,
    steer_angle: f64,
    wheelbase: f64,
    mu: f64,
    throttle: f64,
    tel: &mut AssistTelemetry,
) -> f64 {
    let n = wheels.len().min(caps.len());
    let mut throttle_eff = throttle;
    tel.abs_activity = 0.0;
    tel.tc_activity = 0.0;
    tel.esc_yaw_error = 0.0;
    tel.esc_brake_torque = 0.0;

    let abs = &def.abs;
    if abs.enabled && m::abs(speed) > abs.min_speed {
        for i in 0..n {
            let k = wheels[i].kappa;
            if k < 0.0 && caps[i] > 0.0 {
                let scale = modulation(-k, abs.slip_target, abs.slip_release, abs.floor);
                caps[i] *= scale;
                tel.abs_activity = m::max(tel.abs_activity, 1.0 - scale);
            }
        }
    }

    let tc = &def.traction_control;
    if tc.enabled {
        let mut worst = 0.0;
        for w in &wheels[..n] {
            if w.driven {
                worst = m::max(worst, w.kappa);
            }
        }
        let scale = modulation(worst, tc.slip_target, tc.slip_release, 0.0);
        throttle_eff *= scale;
        tel.tc_activity = 1.0 - scale;
    }

    let esc = &def.stability_control;
    if esc.enabled && m::abs(speed) > esc.min_speed {
        // Neutral-steer reference, capped at what the friction allows.
        let mut r_ref = speed * m::tan(steer_angle) / m::max(wheelbase, 1e-6);
        let r_max = mu * GRAVITY / m::max(m::abs(speed), 1e-6);
        r_ref = m::clamp(r_ref, -r_max, r_max);
        let turn = if m::abs(r_ref) > 1e-6 {
            m::signum(r_ref)
        } else {
            m::signum(yaw_rate)
        };
        let error = yaw_rate - r_ref;
        let beyond = m::abs(error) - esc.dead_band;
        if beyond > 0.0 && turn != 0.0 {
            // Positive: yawing faster than the reference in the turn's
            // direction (oversteer).
            let signed = beyond * m::signum(error) * turn;
            tel.esc_yaw_error = signed;
            let torque = esc.gain * beyond;
            // Oversteer: brake the outer front; understeer: the inner rear.
            let (front, side) = if signed > 0.0 {
                (true, -turn)
            } else {
                (false, turn)
            };
            for i in 0..n {
                let w = &wheels[i];
                if w.front == front && w.side != 0.0 && w.side == side {
                    caps[i] += torque;
                    tel.esc_brake_torque = torque;
                }
            }
            throttle_eff *= m::clamp(1.0 - esc.throttle_cut * beyond, 0.0, 1.0);
        }
    }

    tel.throttle_effective = throttle_eff;
    throttle_eff
}
