//! Closed-form references for the analytic tests: a "textbook car" whose
//! modes have exact answers, the linear single-track model with first-order
//! tire lag, and the signal fits that read frequency, damping, gain and phase
//! off a simulated trace.
//!
//! Sources: R. Rajamani, *Vehicle Dynamics and Control*, ch. 2 (linear
//! single-track model); H. B. Pacejka, *Tire and Vehicle Dynamics*, ch. 1
//! (relaxation length as a first-order lag `σ/V`); T. D. Gillespie,
//! *Fundamentals of Vehicle Dynamics*, ch. 5 (ride modes); Milliken &
//! Milliken, *Race Car Vehicle Dynamics*, ch. 5 (pneumatic trail moves the
//! force rearward).

use skidpad_core::{VehicleDefinition, GRAVITY};
use skidpad_math as m;

/// The default car with its ride modes decoupled and its non-textbook
/// effects removed: rear spring and damper rates set so `k_f·a = k_r·b`
/// (heave and pitch do not couple), equal bump and rebound damping, no
/// anti-roll bars, no Ackermann and no aero drag. Toe, camber, compliance
/// steer, jacking and roll-centre height are already zero in the default.
pub fn textbook_car() -> VehicleDefinition {
    let mut d = VehicleDefinition::default();
    let a = d.chassis.cg_to_front_axle;
    let b = d.cg_to_rear_axle();
    let (kf, cf) = (28_000.0, 2_500.0);
    for (i, (k, c)) in [(kf, cf), (kf * a / b, cf * a / b)].into_iter().enumerate() {
        let s = &mut d.axles[i].suspension;
        s.spring_rate = k;
        s.bump_damping = c;
        s.rebound_damping = c;
        s.anti_roll_stiffness = 0.0;
    }
    d.steering.ackermann = 0.0;
    d.aero.drag_coefficient = 0.0;
    let errors = d.validate();
    assert!(errors.is_ok(), "{errors:?}");
    d
}

/// Sum of the four corner spring rates and of the four damper rates.
pub fn heave_rates(d: &VehicleDefinition) -> (f64, f64) {
    let k = 2.0 * (d.axles[0].suspension.spring_rate + d.axles[1].suspension.spring_rate);
    let c = 2.0 * (d.axles[0].suspension.bump_damping + d.axles[1].suspension.bump_damping);
    (k, c)
}

/// Pitch stiffness and damping about the centre of mass, `Σ k x²` and
/// `Σ c x²`, less the `m g h` the contact patches add as the body tilts:
/// each ray tilts with the body, so every contact slides `h θ` past the
/// centre of mass and the static loads gain a moment `m g h θ` that helps
/// the rotation.
pub fn pitch_rates(d: &VehicleDefinition) -> (f64, f64) {
    let a = d.chassis.cg_to_front_axle;
    let b = d.cg_to_rear_axle();
    let (f, r) = (&d.axles[0].suspension, &d.axles[1].suspension);
    let k = 2.0 * (f.spring_rate * a * a + r.spring_rate * b * b);
    let c = 2.0 * (f.bump_damping * a * a + r.bump_damping * b * b);
    (k - d.chassis.mass * GRAVITY * d.chassis.cg_height, c)
}

/// Pitch inertia the body effectively carries: its own plus the wheels'.
/// As the body pitches by `θ` each contact slides `h θ` along the ground,
/// so each free-rolling wheel turns by `h θ / r`; its spin inertia adds
/// `I_w h² / r²` about the pitch axis.
pub fn pitch_inertia(d: &VehicleDefinition) -> f64 {
    let h = d.chassis.cg_height;
    let wheels: f64 = d
        .axles
        .iter()
        .map(|a| {
            let r = a.tire.unloaded_radius();
            2.0 * a.wheel_inertia * h * h / (r * r)
        })
        .sum();
    d.chassis.pitch_inertia + wheels
}

/// Each axle's roll stiffness, N·m/rad: two springs at half the track and
/// the anti-roll bar, which pushes each wheel by `k_arb` times the travel
/// difference `t φ`.
pub fn axle_roll_stiffness(d: &VehicleDefinition) -> [f64; 2] {
    [0, 1].map(|i| {
        let t = d.axle_track(i);
        let s = &d.axles[i].suspension;
        2.0 * s.spring_rate * (0.5 * t) * (0.5 * t) + s.anti_roll_stiffness * t * t
    })
}

/// Undamped natural frequency (Hz) and damping ratio of `m x'' + c x' + k x`.
pub fn mode(mass: f64, k: f64, c: f64) -> (f64, f64) {
    (m::sqrt(k / mass) / m::TAU, c / (2.0 * m::sqrt(k * mass)))
}

/// Natural frequency (Hz) and damping ratio of a free decay, from the
/// spacing and the logarithmic decrement of its extrema about the final
/// value. Each extremum is refined with a parabola through its neighbours.
pub fn free_decay(dt: f64, x: &[f64]) -> (f64, f64) {
    let rest = x[x.len() - 1];
    let mut ext: Vec<(f64, f64)> = Vec::new();
    for i in 1..x.len() - 1 {
        let (p, q, r) = (x[i - 1] - rest, x[i] - rest, x[i + 1] - rest);
        let peak = q > p && q >= r && q > 0.0;
        let trough = q < p && q <= r && q < 0.0;
        if peak || trough {
            let den = p - 2.0 * q + r;
            let s = if den != 0.0 { 0.5 * (p - r) / den } else { 0.0 };
            ext.push(((i as f64 + s) * dt, m::abs(q - 0.25 * (p - r) * s)));
        }
    }
    assert!(ext.len() >= 3, "only {} extrema", ext.len());
    // One full period between every other extremum; the decrement over the
    // first full period, where the amplitude is still well above noise.
    let period = ext[2].0 - ext[0].0;
    let delta = m::ln(ext[0].1 / ext[2].1);
    let zeta = delta / m::sqrt(m::TAU * m::TAU + delta * delta);
    let wd = m::TAU / period;
    (wd / m::sqrt(1.0 - zeta * zeta) / m::TAU, zeta)
}

/// A complex number, just enough for transfer functions.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Cx {
    pub re: f64,
    pub im: f64,
}

impl Cx {
    pub const fn new(re: f64, im: f64) -> Self {
        Cx { re, im }
    }
    pub fn add(self, o: Cx) -> Cx {
        Cx::new(self.re + o.re, self.im + o.im)
    }
    pub fn sub(self, o: Cx) -> Cx {
        Cx::new(self.re - o.re, self.im - o.im)
    }
    pub fn mul(self, o: Cx) -> Cx {
        Cx::new(
            self.re * o.re - self.im * o.im,
            self.re * o.im + self.im * o.re,
        )
    }
    pub fn div(self, o: Cx) -> Cx {
        let d = o.re * o.re + o.im * o.im;
        Cx::new(
            (self.re * o.re + self.im * o.im) / d,
            (self.im * o.re - self.re * o.im) / d,
        )
    }
    pub fn abs(self) -> f64 {
        m::hypot(self.re, self.im)
    }
    /// Phase, degrees.
    pub fn arg_deg(self) -> f64 {
        m::rad_to_deg(m::atan2(self.im, self.re))
    }
}

/// Difference of two phases in degrees, wrapped to (−180, 180].
pub fn phase_diff(a: f64, b: f64) -> f64 {
    let mut d = a - b;
    while d > 180.0 {
        d -= 360.0;
    }
    while d <= -180.0 {
        d += 360.0;
    }
    d
}

/// Solve `M x = y` by Gaussian elimination with partial pivoting.
pub fn solve(mut a: Vec<Vec<Cx>>, mut y: Vec<Cx>) -> Vec<Cx> {
    let n = y.len();
    for k in 0..n {
        let p = (k..n)
            .max_by(|&i, &j| a[i][k].abs().total_cmp(&a[j][k].abs()))
            .unwrap();
        a.swap(k, p);
        y.swap(k, p);
        for i in k + 1..n {
            let f = a[i][k].div(a[k][k]);
            let pivot = a[k].clone();
            for (aij, &v) in a[i].iter_mut().zip(&pivot).skip(k) {
                *aij = aij.sub(f.mul(v));
            }
            let v = y[k];
            y[i] = y[i].sub(f.mul(v));
        }
    }
    let mut x = vec![Cx::new(0.0, 0.0); n];
    for i in (0..n).rev() {
        let mut s = y[i];
        for j in i + 1..n {
            s = s.sub(a[i][j].mul(x[j]));
        }
        x[i] = s.div(a[i][i]);
    }
    x
}

/// Complex amplitude `Y` of the component of `y` at `w` rad/s, in the
/// convention `y(t) = Re(Y e^{iwt})`: a least-squares fit of
/// `p cos wt + q sin wt + c`, so `Y = p − i q`.
pub fn phasor(t: &[f64], y: &[f64], w: f64) -> Cx {
    let mut s = vec![vec![Cx::new(0.0, 0.0); 3]; 3];
    let mut r = vec![Cx::new(0.0, 0.0); 3];
    for (&ti, &yi) in t.iter().zip(y) {
        let v = [m::cos(w * ti), m::sin(w * ti), 1.0];
        for j in 0..3 {
            r[j].re += v[j] * yi;
            for k in 0..3 {
                s[j][k].re += v[j] * v[k];
            }
        }
    }
    let x = solve(s, r);
    Cx::new(x[0].re, -x[1].re)
}

/// One axle of the linear single-track model.
#[derive(Clone, Copy, Debug)]
pub struct LinearAxle {
    /// Axle cornering stiffness, N/rad: two tires at half the static axle load.
    pub c: f64,
    /// Static pneumatic trail, m.
    pub trail: f64,
    /// Lateral relaxation length, m.
    pub sigma: f64,
}

/// Front and rear axles of `d` linearised at their static loads.
pub fn linear_axles(d: &VehicleDefinition) -> [LinearAxle; 2] {
    let c = &d.chassis;
    let l = c.wheelbase;
    let loads = [
        c.mass * GRAVITY * d.cg_to_rear_axle() / l,
        c.mass * GRAVITY * c.cg_to_front_axle / l,
    ];
    [0, 1].map(|i| {
        let tire = &d.axles[i].tire;
        LinearAxle {
            c: 2.0 * tire.cornering_stiffness(0.5 * loads[i]),
            trail: tire.static_trail(0.5 * loads[i]),
            sigma: tire.relaxation_lengths().1,
        }
    })
}

/// State matrix and steer input vector of the linear single-track model at
/// speed `v`, states `[v_y, r, y_f, y_r]`. `y` is each axle's contact-patch
/// lateral deflection, which lags the contact's lateral velocity with time
/// constant `σ/V` (the core's `TireTransient`), so the transient slip angle
/// is `y/σ` and the axle force `F_y = −C y/σ` (ISO: positive slip angle,
/// negative force). The steer angle `δ` is the road-wheel angle, positive
/// left, and the trail moves each axle's force rearward.
pub fn single_track(d: &VehicleDefinition, v: f64) -> ([[f64; 4]; 4], [f64; 4]) {
    let c = &d.chassis;
    let (mass, iz, a, b) = (
        c.mass,
        c.yaw_inertia,
        c.cg_to_front_axle,
        d.cg_to_rear_axle(),
    );
    let [f, r] = linear_axles(d);
    let (kf, kr) = (-f.c / f.sigma, -r.c / r.sigma);
    (
        [
            [0.0, -v, kf / mass, kr / mass],
            [0.0, 0.0, (a - f.trail) * kf / iz, -(b + r.trail) * kr / iz],
            [1.0, a, -v / f.sigma, 0.0],
            [1.0, -b, 0.0, -v / r.sigma],
        ],
        [0.0, 0.0, -v, 0.0],
    )
}

/// Lateral acceleration of the single-track state, `ΣF_y / m`.
fn lat_accel(d: &VehicleDefinition, s: &[f64; 4]) -> f64 {
    let [f, r] = linear_axles(d);
    (-f.c * s[2] / f.sigma - r.c * s[3] / r.sigma) / d.chassis.mass
}

/// Steady sinusoidal response of the linear single-track model at `w`
/// rad/s: yaw rate and lateral acceleration per unit road-wheel angle.
pub fn single_track_frequency_response(d: &VehicleDefinition, v: f64, w: f64) -> (Cx, Cx) {
    let (a, b) = single_track(d, v);
    let mat = (0..4)
        .map(|i| {
            (0..4)
                .map(|j| Cx::new(-a[i][j], if i == j { w } else { 0.0 }))
                .collect()
        })
        .collect();
    let x = solve(mat, b.iter().map(|&bi| Cx::new(bi, 0.0)).collect());
    let [f, r] = linear_axles(d);
    let mass = d.chassis.mass;
    let ay = x[2]
        .mul(Cx::new(-f.c / (f.sigma * mass), 0.0))
        .add(x[3].mul(Cx::new(-r.c / (r.sigma * mass), 0.0)));
    (x[1], ay)
}

/// The linear single-track model driven through the recorded road-wheel
/// angle and speed, integrated with RK4 between samples (inputs linear in
/// between). Returns yaw rate and lateral acceleration at every sample.
pub fn single_track_response(
    d: &VehicleDefinition,
    t: &[f64],
    delta: &[f64],
    speed: &[f64],
) -> Vec<(f64, f64)> {
    let deriv = |s: &[f64; 4], dl: f64, v: f64| -> [f64; 4] {
        let (a, b) = single_track(d, v);
        let mut out = [0.0; 4];
        for i in 0..4 {
            out[i] = b[i] * dl + (0..4).map(|j| a[i][j] * s[j]).sum::<f64>();
        }
        out
    };
    let add =
        |s: &[f64; 4], k: &[f64; 4], h: f64| -> [f64; 4] { [0, 1, 2, 3].map(|i| s[i] + h * k[i]) };
    let mut s = [0.0; 4];
    let mut out = vec![(0.0, 0.0)];
    for i in 1..t.len() {
        let h = t[i] - t[i - 1];
        let (d0, d1) = (delta[i - 1], delta[i]);
        let (v0, v1) = (speed[i - 1], speed[i]);
        let (dm, vm) = (0.5 * (d0 + d1), 0.5 * (v0 + v1));
        let k1 = deriv(&s, d0, v0);
        let k2 = deriv(&add(&s, &k1, 0.5 * h), dm, vm);
        let k3 = deriv(&add(&s, &k2, 0.5 * h), dm, vm);
        let k4 = deriv(&add(&s, &k3, h), d1, v1);
        s = [0, 1, 2, 3].map(|j| s[j] + h / 6.0 * (k1[j] + 2.0 * k2[j] + 2.0 * k3[j] + k4[j]));
        out.push((s[1], lat_accel(d, &s)));
    }
    out
}

/// Observed order of convergence `p` from the errors of two runs against a
/// much finer reference: with `e(h) = C (h^p − h_ref^p)`, solve
/// `e1 / e2 = (h1^p − h_ref^p) / (h2^p − h_ref^p)` for `p` by bisection.
pub fn convergence_order(h1: f64, e1: f64, h2: f64, e2: f64, h_ref: f64) -> f64 {
    let ratio = |p: f64| (m::pow(h1, p) - m::pow(h_ref, p)) / (m::pow(h2, p) - m::pow(h_ref, p));
    let target = e1 / e2;
    let (mut lo, mut hi) = (0.1, 4.0);
    for _ in 0..100 {
        let mid = 0.5 * (lo + hi);
        if ratio(mid) < target {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    0.5 * (lo + hi)
}
