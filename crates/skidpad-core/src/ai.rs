//! A path-following driver for traffic and opponents (ADR-0020).
//!
//! The driver follows a polyline: pure pursuit for the steering (R. C.
//! Coulter, *Implementation of the Pure Pursuit Path Tracking Algorithm*,
//! CMU-RI-TR-92-01, 1992) through the bicycle geometry with the linear
//! understeer gradient, as the lane-change validation driver does, and a
//! speed profile along the path for the pedals: each point's speed is capped
//! by the lateral acceleration the curvature allows, then a backward pass
//! caps it by the braking distance to every slower point ahead and a forward
//! pass by the acceleration from every slower point behind (the usual
//! quasi-steady-state lap-time construction).
//!
//! It is a helper, not a racing AI: no overtaking, no racing line, no
//! awareness of other cars. It runs inside the world step, before the
//! vehicle's substeps, and writes its steer, throttle and brake into the
//! vehicle's input record, so telemetry and a replay recorder see exactly
//! what it applied. Handbrake, clutch and gear are left as the application
//! set them.
//!
//! Everything is computed when the path is set; a step only searches a few
//! segments around the last match and interpolates.

use crate::definition::VehicleDefinition;
use crate::input::VehicleInput;
use crate::validation::understeer::linear_understeer_gradient;
use crate::vehicle::VehicleModel;
use skidpad_math as m;

/// How far along the path, in segments, the nearest-point search looks
/// ahead of (and a quarter of this behind) the last match.
const SEARCH_AHEAD: usize = 48;

/// Tuning of the driver. Every field has a usable default.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct AiConfig {
    /// Top speed the driver will ever ask for, m/s.
    pub max_speed: f64,
    /// Lateral acceleration the speed profile allows in a curve, m/s².
    pub lateral_accel: f64,
    /// Deceleration the speed profile plans for when braking, m/s².
    pub brake_decel: f64,
    /// Acceleration the speed profile plans for out of a slow point, m/s².
    pub drive_accel: f64,
    /// Look-ahead of the steering in seconds of travel.
    pub preview_time: f64,
    /// Smallest look-ahead distance, m.
    pub min_preview: f64,
    /// How far ahead, in seconds of travel, the target speed is read, so
    /// the pedals lead the profile by about the car's response.
    pub speed_lead: f64,
    /// Proportional gain of the pedals on the speed error, per m/s.
    pub speed_gain: f64,
    /// Integral gain of the pedals on the speed error, per m.
    pub speed_integral_gain: f64,
    /// Lateral offset from the path, m, positive to the left (+y of the
    /// path direction). Lets several cars share one path side by side.
    pub lateral_offset: f64,
    /// Whether the last point joins the first.
    pub closed: bool,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            max_speed: 30.0,
            lateral_accel: 6.0,
            brake_decel: 6.0,
            drive_accel: 3.0,
            preview_time: 0.5,
            min_preview: 5.0,
            speed_lead: 0.3,
            speed_gain: 0.6,
            speed_integral_gain: 0.3,
            lateral_offset: 0.0,
            closed: true,
        }
    }
}

impl AiConfig {
    /// Number of values in the flat form used across the WASM boundary.
    pub const LEN: usize = 11;

    /// Read the flat form `[maxSpeed, lateralAccel, brakeDecel, driveAccel,
    /// previewTime, minPreview, speedLead, speedGain, speedIntegralGain,
    /// lateralOffset, closed]`. A NaN or a missing value keeps the default;
    /// `closed` is true when above one half.
    pub fn from_values(v: &[f64]) -> Self {
        let mut c = Self::default();
        let slots: [&mut f64; 10] = [
            &mut c.max_speed,
            &mut c.lateral_accel,
            &mut c.brake_decel,
            &mut c.drive_accel,
            &mut c.preview_time,
            &mut c.min_preview,
            &mut c.speed_lead,
            &mut c.speed_gain,
            &mut c.speed_integral_gain,
            &mut c.lateral_offset,
        ];
        for (slot, value) in slots.into_iter().zip(v.iter()) {
            if !value.is_nan() {
                *slot = *value;
            }
        }
        if let Some(closed) = v.get(10) {
            if !closed.is_nan() {
                c.closed = *closed > 0.5;
            }
        }
        c
    }

    /// Check every value; the TypeScript layer reports the field by name
    /// before it gets here, so one message keeps the WASM small.
    pub fn validate(&self) -> Result<(), Vec<String>> {
        let positive = [
            self.max_speed,
            self.lateral_accel,
            self.brake_decel,
            self.drive_accel,
            self.preview_time,
            self.min_preview,
        ];
        let non_negative = [self.speed_lead, self.speed_gain, self.speed_integral_gain];
        if positive.iter().all(|v| *v > 0.0 && v.is_finite())
            && non_negative.iter().all(|v| *v >= 0.0 && v.is_finite())
            && self.lateral_offset.is_finite()
        {
            Ok(())
        } else {
            Err(vec![String::from(
                "ai: maxSpeed, lateralAccel, brakeDecel, driveAccel, previewTime and minPreview \
                 must be positive; speedLead, speedGain and speedIntegralGain zero or positive; \
                 lateralOffset finite",
            )])
        }
    }
}

/// What the driver did on its last step.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct AiStatus {
    /// Distance along the path of the car's nearest point, m.
    pub distance: f64,
    /// Completed laps of a closed path (counted when the car passes the
    /// first point going forward).
    pub laps: u32,
    /// Signed distance of the car from the path (plus the offset), m,
    /// positive to the left.
    pub lateral_error: f64,
    /// Speed the driver aimed for, m/s.
    pub target_speed: f64,
    /// Whether an open path has been driven to its end.
    pub finished: bool,
}

/// A path with its speed profile, and the driver's running state.
#[derive(Clone, Debug, PartialEq)]
pub struct AiDriver {
    config: AiConfig,
    /// Points, offset by `lateral_offset`.
    x: Vec<f64>,
    y: Vec<f64>,
    /// Arc length at each point, m.
    s: Vec<f64>,
    /// Planned speed at each point, m/s.
    v: Vec<f64>,
    /// Total length (closing segment included for a closed path), m.
    length: f64,
    wheelbase: f64,
    kus: f64,
    max_angle: f64,
    // --- running state (not in the vehicle snapshot; see ADR-0020) ---
    /// Segment of the last match, or `None` to search the whole path.
    hint: Option<usize>,
    speed_integral: f64,
    status: AiStatus,
}

impl AiDriver {
    /// Build a driver for `def` along `points` (`[x0, y0, x1, y1, …]`,
    /// world frame, at least two distinct points). Allocates; call outside
    /// the step.
    pub fn new(
        def: &VehicleDefinition,
        points: &[f64],
        config: AiConfig,
    ) -> Result<Self, Vec<String>> {
        config.validate()?;
        if points.len() % 2 != 0 || points.iter().any(|p| !p.is_finite()) {
            return Err(vec![String::from(
                "ai path must be a flat list of finite x, y pairs",
            )]);
        }
        // Drop repeated points: they have no direction.
        let mut px: Vec<f64> = Vec::with_capacity(points.len() / 2);
        let mut py: Vec<f64> = Vec::with_capacity(points.len() / 2);
        for p in points.chunks_exact(2) {
            if let (Some(&lx), Some(&ly)) = (px.last(), py.last()) {
                if m::hypot(p[0] - lx, p[1] - ly) < 1e-6 {
                    continue;
                }
            }
            px.push(p[0]);
            py.push(p[1]);
        }
        let closed = config.closed;
        if closed && px.len() > 2 {
            let n = px.len() - 1;
            if m::hypot(px[n] - px[0], py[n] - py[0]) < 1e-6 {
                px.pop();
                py.pop();
            }
        }
        if px.len() < if closed { 3 } else { 2 } {
            return Err(vec![String::from(
                "ai path needs two distinct points (three if closed)",
            )]);
        }
        let n = px.len();

        // Offset each point along the normal of its averaged tangent.
        let (x, y) = if config.lateral_offset != 0.0 {
            let mut ox = vec![0.0; n];
            let mut oy = vec![0.0; n];
            for i in 0..n {
                let (prev, next) = neighbours(i, n, closed);
                let tx = px[next] - px[prev];
                let ty = py[next] - py[prev];
                let l = m::max(m::hypot(tx, ty), 1e-9);
                ox[i] = px[i] - ty / l * config.lateral_offset;
                oy[i] = py[i] + tx / l * config.lateral_offset;
            }
            (ox, oy)
        } else {
            (px, py)
        };

        let mut s = vec![0.0; n];
        for i in 1..n {
            s[i] = s[i - 1] + m::hypot(x[i] - x[i - 1], y[i] - y[i - 1]);
        }
        let length = if closed {
            s[n - 1] + m::hypot(x[0] - x[n - 1], y[0] - y[n - 1])
        } else {
            s[n - 1]
        };

        // Curvature from the circle through each point and its neighbours,
        // then the lateral-acceleration cap.
        let mut v = vec![config.max_speed; n];
        for i in 0..n {
            let (prev, next) = neighbours(i, n, closed);
            if prev == i || next == i {
                continue;
            }
            let k = circumcurvature(x[prev], y[prev], x[i], y[i], x[next], y[next]);
            if k > 1e-9 {
                v[i] = m::min(v[i], m::sqrt(config.lateral_accel / k));
            }
        }
        if !closed {
            v[n - 1] = 0.0;
        }
        // Backward pass for braking, forward pass for acceleration. A
        // closed path wraps; two laps of each pass settle the wrap.
        let laps = if closed { 2 } else { 1 };
        let seg = |i: usize, j: usize| m::hypot(x[j] - x[i], y[j] - y[i]);
        for _ in 0..laps {
            for k in (0..n).rev() {
                let j = if k + 1 < n {
                    k + 1
                } else if closed {
                    0
                } else {
                    continue;
                };
                let cap = m::sqrt(v[j] * v[j] + 2.0 * config.brake_decel * seg(k, j));
                v[k] = m::min(v[k], cap);
            }
        }
        for _ in 0..laps {
            for k in 0..n {
                let j = if k + 1 < n {
                    k + 1
                } else if closed {
                    0
                } else {
                    continue;
                };
                let cap = m::sqrt(v[k] * v[k] + 2.0 * config.drive_accel * seg(k, j));
                v[j] = m::min(v[j], cap);
            }
        }

        Ok(Self {
            wheelbase: def.chassis.wheelbase,
            kus: linear_understeer_gradient(def),
            max_angle: def.max_wheel_angle(),
            config,
            x,
            y,
            s,
            v,
            length,
            hint: None,
            speed_integral: 0.0,
            status: AiStatus::default(),
        })
    }

    pub fn config(&self) -> &AiConfig {
        &self.config
    }

    pub fn status(&self) -> AiStatus {
        self.status
    }

    /// Path length, m.
    pub fn length(&self) -> f64 {
        self.length
    }

    /// Planned speed at distance `s` along the path, m/s. Between two
    /// points the speed follows the planned acceleration out of the first
    /// and braking into the second, capped by the faster of the two, so a
    /// long segment brakes late rather than easing off along its length.
    pub fn planned_speed(&self, s: f64) -> f64 {
        let (i, f) = self.locate(s);
        let j = self.next(i).unwrap_or(i);
        let seg = if j == 0 {
            self.length - self.s[i]
        } else {
            self.s[j] - self.s[i]
        };
        let (vi, vj) = (self.v[i], self.v[j]);
        let out = vi * vi + 2.0 * self.config.drive_accel * f * seg;
        let into = vj * vj + 2.0 * self.config.brake_decel * (1.0 - f) * seg;
        m::min(m::sqrt(m::min(out, into)), m::max(vi, vj))
    }

    /// Forget the last match so the next step searches the whole path, and
    /// clear the pedal integrator. Called when the vehicle is reset or
    /// restored.
    pub fn reset(&mut self) {
        self.hint = None;
        self.speed_integral = 0.0;
        self.status = AiStatus::default();
    }

    /// Rebuild the steering terms for a changed definition.
    pub fn set_definition(&mut self, def: &VehicleDefinition) {
        self.wheelbase = def.chassis.wheelbase;
        self.kus = linear_understeer_gradient(def);
        self.max_angle = def.max_wheel_angle();
    }

    fn n(&self) -> usize {
        self.x.len()
    }

    /// Segments are `i → i + 1`, and `n − 1 → 0` on a closed path.
    fn segment_count(&self) -> usize {
        if self.config.closed {
            self.n()
        } else {
            self.n() - 1
        }
    }

    fn next(&self, i: usize) -> Option<usize> {
        if i + 1 < self.n() {
            Some(i + 1)
        } else if self.config.closed {
            Some(0)
        } else {
            None
        }
    }

    /// Segment index and fraction along it of path distance `s`.
    fn locate(&self, s: f64) -> (usize, f64) {
        let n = self.n();
        let s = if self.config.closed {
            let r = s - m::floor(s / self.length) * self.length;
            if r < 0.0 || r >= self.length {
                0.0
            } else {
                r
            }
        } else {
            m::clamp(s, 0.0, self.length)
        };
        // Binary search for the last point at or before s.
        let mut lo = 0usize;
        let mut hi = n - 1;
        while lo < hi {
            let mid = (lo + hi).div_ceil(2);
            if self.s[mid] <= s {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }
        let i = if !self.config.closed && lo == n - 1 {
            n - 2
        } else {
            lo
        };
        let j = self.next(i).unwrap_or(i);
        let seg_len = if j == 0 {
            self.length - self.s[i]
        } else {
            self.s[j] - self.s[i]
        };
        let f = if seg_len > 0.0 {
            m::clamp((s - self.s[i]) / seg_len, 0.0, 1.0)
        } else {
            0.0
        };
        (i, f)
    }

    fn point_at(&self, s: f64) -> (f64, f64) {
        let (i, f) = self.locate(s);
        let j = self.next(i).unwrap_or(i);
        (
            self.x[i] + (self.x[j] - self.x[i]) * f,
            self.y[i] + (self.y[j] - self.y[i]) * f,
        )
    }

    /// Nearest point on segment `i` to `(px, py)`: squared distance, path
    /// distance and signed lateral offset (left positive).
    fn project(&self, i: usize, px: f64, py: f64) -> (f64, f64, f64) {
        let j = self.next(i).unwrap_or(i);
        let (ax, ay) = (self.x[i], self.y[i]);
        let (dx, dy) = (self.x[j] - ax, self.y[j] - ay);
        let l2 = dx * dx + dy * dy;
        let t = if l2 > 0.0 {
            m::clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0.0, 1.0)
        } else {
            0.0
        };
        let (qx, qy) = (ax + dx * t, ay + dy * t);
        let (ex, ey) = (px - qx, py - qy);
        let l = m::sqrt(l2);
        let lateral = if l > 0.0 {
            (dx * ey - dy * ex) / l
        } else {
            0.0
        };
        (ex * ex + ey * ey, self.s[i] + t * l, lateral)
    }

    /// Compute this step's steer, throttle and brake for `car` and write
    /// them into `input` (other fields untouched).
    pub fn drive(&mut self, car: &VehicleModel, dt: f64, input: &mut VehicleInput) {
        let (px, py, yaw) = car.pose2d();
        let vx = car.vx();
        if !(px.is_finite() && py.is_finite() && yaw.is_finite() && vx.is_finite()) {
            input.steer = 0.0;
            input.throttle = 0.0;
            input.brake = 1.0;
            return;
        }
        let segs = self.segment_count();
        // Nearest segment: a window around the last match, or everything.
        let (first, count) = match self.hint {
            Some(h) => {
                let back = SEARCH_AHEAD / 4;
                let first = if self.config.closed {
                    (h + segs - back.min(segs)) % segs
                } else {
                    h.saturating_sub(back)
                };
                (first, (SEARCH_AHEAD + back + 1).min(segs))
            }
            None => (0, segs),
        };
        let mut best = (f64::INFINITY, 0.0, 0.0, 0usize);
        for k in 0..count {
            let i = if self.config.closed {
                (first + k) % segs
            } else {
                first + k
            };
            if i >= segs {
                break;
            }
            let (d2, s, lat) = self.project(i, px, py);
            if d2 < best.0 {
                best = (d2, s, lat, i);
            }
        }
        let (_, s_car, lateral, seg) = best;
        // Lap counting: the match wrapped from the end of the path to its
        // start.
        if self.config.closed {
            if let Some(h) = self.hint {
                if seg < segs / 4 && h > 3 * segs / 4 {
                    self.status.laps += 1;
                } else if h < segs / 4 && seg > 3 * segs / 4 && self.status.laps > 0 {
                    self.status.laps -= 1;
                }
            }
        }
        self.hint = Some(seg);

        // Steering: pure pursuit on a point one look-ahead down the path.
        let speed = m::max(vx, 0.0);
        let preview = m::max(self.config.preview_time * speed, self.config.min_preview);
        let finished = !self.config.closed && s_car >= self.length - 0.5;
        let s_goal = s_car + preview;
        let (gx, gy) = if !self.config.closed && s_goal > self.length {
            // Past the end of an open path: aim along its last segment.
            let n = self.n();
            let (ex, ey) = (self.x[n - 1] - self.x[n - 2], self.y[n - 1] - self.y[n - 2]);
            let l = m::max(m::hypot(ex, ey), 1e-9);
            let over = s_goal - self.length;
            (self.x[n - 1] + ex / l * over, self.y[n - 1] + ey / l * over)
        } else {
            self.point_at(s_goal)
        };
        let (sy, cy) = (m::sin(yaw), m::cos(yaw));
        let (dx, dy) = (gx - px, gy - py);
        let ahead = dx * cy + dy * sy;
        let left = -dx * sy + dy * cy;
        let ld2 = m::max(dx * dx + dy * dy, 1e-6);
        // A goal behind the car (turned around) asks for full lock toward it.
        let curvature = if ahead > 0.0 {
            2.0 * left / ld2
        } else if left >= 0.0 {
            1.0 / self.wheelbase
        } else {
            -1.0 / self.wheelbase
        };
        let v_ff = m::max(speed, 1.0);
        let delta = m::clamp(
            m::atan(self.wheelbase * curvature) + self.kus * v_ff * v_ff * curvature,
            -self.max_angle,
            self.max_angle,
        );

        // Pedals: PI on the planned speed a little ahead.
        let target = if finished {
            0.0
        } else {
            self.planned_speed(s_car + self.config.speed_lead * speed)
        };
        let err = target - vx;
        self.speed_integral = m::clamp(
            self.speed_integral + self.config.speed_integral_gain * err * dt,
            -0.5,
            0.5,
        );
        let pedal = self.config.speed_gain * err + self.speed_integral;
        input.steer = -delta / self.max_angle;
        input.throttle = if finished {
            0.0
        } else {
            m::clamp(pedal, 0.0, 1.0)
        };
        input.brake = if finished {
            1.0
        } else {
            m::clamp(-pedal, 0.0, 1.0)
        };

        self.status.distance = s_car;
        self.status.lateral_error = lateral;
        self.status.target_speed = target;
        self.status.finished = finished;
    }
}

fn neighbours(i: usize, n: usize, closed: bool) -> (usize, usize) {
    let prev = if i > 0 {
        i - 1
    } else if closed {
        n - 1
    } else {
        i
    };
    let next = if i + 1 < n {
        i + 1
    } else if closed {
        0
    } else {
        i
    };
    (prev, next)
}

/// Unsigned curvature of the circle through three points, 1/m (zero when
/// they are collinear).
fn circumcurvature(ax: f64, ay: f64, bx: f64, by: f64, cx: f64, cy: f64) -> f64 {
    let ab = m::hypot(bx - ax, by - ay);
    let bc = m::hypot(cx - bx, cy - by);
    let ca = m::hypot(ax - cx, ay - cy);
    let cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    let denom = ab * bc * ca;
    if denom > 0.0 {
        2.0 * m::abs(cross) / denom
    } else {
        0.0
    }
}
