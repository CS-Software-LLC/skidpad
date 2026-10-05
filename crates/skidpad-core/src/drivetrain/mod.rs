//! The drivetrain (ADR-0011): a power unit, a clutch, a gearbox with a final
//! drive, and differentials, solved each substep as one constrained
//! rotational system in the wheel speeds plus the engine speed. The tire
//! torques are the boundary conditions; the brakes are bounded constraints
//! solved in the same system so a wheel within its brake's capacity stops
//! exactly.

// The wheel loops index several arrays in lock step.
#![allow(clippy::needless_range_loop)]

pub mod def;
pub mod solver;

pub use def::{
    CenterDifferentialDef, CombustionEngineDef, DifferentialDef, DifferentialKind, DirectDriveDef,
    DrivetrainDef, ElectricMotorDef, PowerUnitDef, TransmissionDef, TransmissionMode, MAX_GEARS,
    RAD_TO_RPM, RPM_TO_RAD,
};

use crate::input::VehicleInput;
use skidpad_math as m;
use solver::{Constraint, System, MAX_CONSTRAINTS, MAX_DOF};

/// Rounds of the projected block solve per substep. Fixed for determinism;
/// the active set settles in two or three rounds in practice.
pub const SOLVER_ROUNDS: usize = 8;
/// Carrier speed below which the automatic may change direction, rad/s.
pub const DIRECTION_CHANGE_SPEED: f64 = 5.0;
/// Share of the clutch's capacity an automatic lets the engine make while
/// the clutch re-engages after a shift and the engine is still above the
/// new gear's speed. Below one, so the clutch always pulls the engine down.
pub const SYNC_TORQUE_FRACTION: f64 = 0.7;
/// Hysteresis of the automatic's part-throttle schedule (ADR-0025): an
/// upshift must land the gearbox input at least this factor above the
/// next gear's downshift point.
pub const UPSHIFT_MARGIN: f64 = 1.15;
/// Brake input above which the automatic shifts on its full-throttle
/// points, so lifting to brake does not upshift and downshifts come at the
/// usual speed.
pub const SHIFT_BRAKE_THRESHOLD: f64 = 0.05;
/// Number of `f64` values of drivetrain state in a snapshot.
pub const STATE_LEN: usize = 4;

/// One wheel (or one axle on the single-track model) as the solver sees it.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct WheelDyn {
    /// In: speed at the start of the substep. Out: speed at the end.
    pub omega: f64,
    /// Effective spin inertia including the implicit tire term (ADR-0010).
    pub inertia: f64,
    /// Explicit torque on the wheel this substep (tire, rolling resistance).
    pub torque: f64,
    /// Brake torque capacity, N·m (service plus handbrake).
    pub brake_capacity: f64,
    /// 0 front, 1 rear.
    pub axle: usize,
    /// Out: held by the brake at exactly zero speed.
    pub locked: bool,
    /// Out: torque the half-shaft applied to the wheel, N·m.
    pub shaft_torque: f64,
}

/// What the drivetrain reports after a substep.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct DrivetrainTelemetry {
    pub engine_rpm: f64,
    /// Net torque the power unit produced, N·m (zero for the direct drive;
    /// its carrier torque is in `carrier_torque`).
    pub engine_torque: f64,
    /// Torque at the carrier, N·m.
    pub carrier_torque: f64,
    pub gear: i32,
    /// Gearbox input speed minus engine speed, rad/s.
    pub clutch_slip: f64,
    /// Torque through the clutch, engine side, N·m.
    pub clutch_torque: f64,
    pub diff_lock_front: f64,
    pub diff_lock_rear: f64,
    pub center_lock: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Drivetrain {
    def: DrivetrainDef,
    wheel_count: usize,
    driven: [bool; 2],
    // --- state (in the snapshot) ---
    /// Engine or motor speed, rad/s (zero for the direct drive).
    pub engine_omega: f64,
    /// Engaged gear: −1 reverse, 0 neutral, 1 … n.
    pub gear: i32,
    /// Counts down through the torque interruption and the hold after a
    /// shift, s.
    pub shift_timer: f64,
    /// Automatic clutch re-engagement after a shift, 0 … 1.
    pub clutch_engagement: f64,
    // --- derived ---
    pub telemetry: DrivetrainTelemetry,
}

impl Drivetrain {
    /// `wheel_count` is 4 for the four-wheel model (FL, FR, RL, RR) and 2
    /// for the single-track model (front axle, rear axle).
    pub fn new(def: DrivetrainDef, driven: [bool; 2], wheel_count: usize) -> Self {
        let mut d = Self {
            def,
            wheel_count,
            driven,
            engine_omega: 0.0,
            gear: 0,
            shift_timer: 0.0,
            clutch_engagement: 1.0,
            telemetry: DrivetrainTelemetry::default(),
        };
        d.reset();
        d
    }

    pub fn definition(&self) -> &DrivetrainDef {
        &self.def
    }

    /// Swap the definition, keeping the state where it still makes sense.
    pub fn set_definition(&mut self, def: DrivetrainDef, driven: [bool; 2]) {
        self.def = def;
        self.driven = driven;
        let n = self.def.transmission.gears.len() as i32;
        self.gear = self.gear.clamp(
            if self.def.transmission.reverse > 0.0 {
                -1
            } else {
                0
            },
            n,
        );
        if !self.def.has_engine() {
            self.engine_omega = 0.0;
        }
    }

    /// Engine at idle, first gear (automatic) or neutral (manual), clutch
    /// engaged.
    pub fn reset(&mut self) {
        self.engine_omega = self.def.idle();
        self.gear = match self.def.transmission.mode {
            TransmissionMode::Automatic => 1,
            TransmissionMode::Manual => 0,
        };
        self.shift_timer = 0.0;
        self.clutch_engagement = 1.0;
        self.telemetry = DrivetrainTelemetry::default();
        self.telemetry.engine_rpm = self.engine_omega * RAD_TO_RPM;
        self.telemetry.gear = self.gear;
    }

    /// Make the drivetrain consistent with a carrier speed set from
    /// outside: an automatic picks the lowest gear that keeps the gearbox
    /// input below its upshift point (the top gear failing that), and the
    /// engine turns at the gearbox input speed, or idle if that is higher.
    pub fn match_speed(&mut self, carrier_omega: f64) {
        let t = &self.def.transmission;
        if t.mode == TransmissionMode::Automatic && self.gear > 0 && carrier_omega > 0.0 {
            let limit = t.shift_up_at * self.def.redline();
            let n = t.gears.len() as i32;
            let mut gear = n;
            for g in 1..=n {
                if self.ratio(g) * carrier_omega <= limit {
                    gear = g;
                    break;
                }
            }
            self.gear = gear;
            self.shift_timer = 0.0;
            self.clutch_engagement = 1.0;
        }
        if self.def.has_engine() {
            let r = self.ratio(self.gear);
            self.engine_omega = m::max(r * carrier_omega, self.def.idle());
        }
        self.telemetry.gear = self.gear;
        self.telemetry.engine_rpm = self.engine_omega * RAD_TO_RPM;
    }

    pub fn write_state(&self, out: &mut [f64]) {
        out[0] = self.engine_omega;
        out[1] = self.gear as f64;
        out[2] = self.shift_timer;
        out[3] = self.clutch_engagement;
    }

    pub fn read_state(&mut self, v: &[f64]) {
        self.engine_omega = v[0];
        self.gear = m::round(v[1]) as i32;
        self.shift_timer = v[2];
        self.clutch_engagement = v[3];
    }

    fn awd(&self) -> bool {
        self.driven[0] && self.driven[1]
    }

    /// Kinematic weights of the carrier speed over the wheel speeds.
    fn weights(&self) -> [f64; MAX_DOF] {
        let mut a = [0.0; MAX_DOF];
        let f = if self.awd() {
            self.def.center.front_torque_fraction
        } else if self.driven[0] {
            1.0
        } else {
            0.0
        };
        let share = [f, 1.0 - f];
        if self.wheel_count == 4 {
            for i in 0..4 {
                a[i] = 0.5 * share[i / 2];
            }
        } else {
            a[0] = share[0];
            a[1] = share[1];
        }
        a
    }

    /// Signed overall ratio (gearbox input turns per carrier turn) of a
    /// gear; zero in neutral.
    pub fn ratio(&self, gear: i32) -> f64 {
        let t = &self.def.transmission;
        if gear > 0 {
            t.gears
                .get((gear - 1) as usize)
                .map_or(0.0, |g| g * t.final_drive)
        } else if gear < 0 {
            -t.reverse * t.final_drive
        } else {
            0.0
        }
    }

    fn begin_shift(&mut self, target: i32) {
        let t = &self.def.transmission;
        self.gear = target;
        self.shift_timer = t.shift_time + t.shift_hold;
        if t.shift_time > 0.0 || t.clutch_engage_time > 0.0 {
            self.clutch_engagement = 0.0;
        }
    }

    // The part-throttle schedule follows the shift maps of production
    // automatics: upshift and downshift lines over pedal position, kept
    // apart by a hysteresis, with the downshift line rising toward full
    // pedal for the kickdown (Naunheimer, Bertsche, Ryborz and Novak,
    // Automotive Transmissions, 2nd ed., Springer 2011, ch. 8).

    /// Automatic downshift point as a fraction of redline at a throttle of
    /// `pedal` (ADR-0025): from `shift_light_factor` of `shift_down_at` on
    /// a closed throttle to `shift_down_at` at full throttle. Pressing the
    /// pedal raises it, which is the kickdown.
    pub fn downshift_point(&self, pedal: f64) -> f64 {
        let t = &self.def.transmission;
        schedule(t.shift_down_at, t.shift_light_factor, pedal)
    }

    /// Automatic upshift point out of `gear` as a fraction of redline at a
    /// throttle of `pedal` (ADR-0025): from `shift_light_factor` of
    /// `shift_up_at` on a closed throttle to `shift_up_at` at full throttle,
    /// but never so low that the gearbox input after the shift lands within
    /// `UPSHIFT_MARGIN` of the downshift point. That point is taken at the
    /// throttle the next gear needs for the same wheel torque, so a driver
    /// holding a speed does not hunt. Full throttle gives exactly
    /// `shift_up_at`.
    pub fn upshift_point(&self, gear: i32, pedal: f64) -> f64 {
        let t = &self.def.transmission;
        let step = self.ratio(gear) / self.ratio(gear + 1);
        let floor = UPSHIFT_MARGIN * step * self.downshift_point(m::min(pedal * step, 1.0));
        let up = schedule(t.shift_up_at, t.shift_light_factor, pedal);
        m::min(m::max(up, floor), t.shift_up_at)
    }

    fn update_shift(&mut self, dt: f64, input: &VehicleInput, pedal: f64, carrier_omega: f64) {
        let t = &self.def.transmission;
        let n_gears = t.gears.len() as i32;
        let lowest = if t.reverse > 0.0 { -1 } else { 0 };
        if self.shift_timer > 0.0 {
            self.shift_timer = m::max(self.shift_timer - dt, 0.0);
        }
        let request = m::round(input.gear) as i32;
        match t.mode {
            TransmissionMode::Manual => {
                let target = request.clamp(lowest, n_gears);
                if target != self.gear {
                    self.begin_shift(target);
                }
            }
            TransmissionMode::Automatic => {
                if self.shift_timer > 0.0 {
                    return;
                }
                let slow = m::abs(carrier_omega) < DIRECTION_CHANGE_SPEED;
                if request < 0 && lowest < 0 {
                    if self.gear != -1 && slow {
                        self.begin_shift(-1);
                    }
                } else if request < 0 {
                    // No reverse ratio: a reverse request is neutral, not
                    // drive.
                    if self.gear != 0 {
                        self.begin_shift(0);
                    }
                } else if self.gear <= 0 {
                    if self.gear == 0 || slow {
                        self.begin_shift(1);
                    }
                } else {
                    let w_in = self.ratio(self.gear) * carrier_omega;
                    let redline = self.def.redline();
                    let pedal = if input.brake > SHIFT_BRAKE_THRESHOLD {
                        1.0
                    } else {
                        pedal
                    };
                    if self.gear < n_gears && w_in > self.upshift_point(self.gear, pedal) * redline
                    {
                        self.begin_shift(self.gear + 1);
                    } else if self.gear > 1 && w_in < self.downshift_point(pedal) * redline {
                        self.begin_shift(self.gear - 1);
                    }
                }
            }
        }
    }

    /// Throttle the rev limiter lets through at `omega` for a redline of
    /// `red` (both rad/s): 1 up to redline, cut linearly to 0 over the next
    /// 2 %.
    #[inline]
    fn limiter(red: f64, omega: f64) -> f64 {
        m::clamp((1.02 * red - omega) / (0.02 * red), 0.0, 1.0)
    }

    /// How far the engine is into its rev limiter, 0 … 1 (the share of the
    /// throttle it cuts); 0 without a combustion engine.
    pub fn rev_limiter_cut(&self) -> f64 {
        match &self.def.power_unit {
            PowerUnitDef::Combustion(c) => {
                1.0 - Self::limiter(c.redline_rpm * RPM_TO_RAD, self.engine_omega)
            }
            _ => 0.0,
        }
    }

    /// Full-throttle torque of the combustion curve at `rpm`.
    fn curve_torque(curve: &[[f64; 2]], rpm: f64) -> f64 {
        let Some(first) = curve.first() else {
            return 0.0;
        };
        if rpm <= first[0] {
            return first[1];
        }
        for k in 1..curve.len() {
            let (p0, p1) = (curve[k - 1], curve[k]);
            if rpm <= p1[0] {
                let t = (rpm - p0[0]) / m::max(p1[0] - p0[0], 1e-9);
                return m::lerp(p0[1], p1[1], t);
            }
        }
        curve[curve.len() - 1][1]
    }

    /// Slope of a `[rpm, value]` curve at `rpm`, per rpm; zero beyond the
    /// ends, where the curve is held flat.
    fn curve_slope(curve: &[[f64; 2]], rpm: f64) -> f64 {
        for k in 1..curve.len() {
            let (p0, p1) = (curve[k - 1], curve[k]);
            if rpm > p0[0] && rpm <= p1[0] {
                return (p1[1] - p0[1]) / m::max(p1[0] - p0[0], 1e-9);
            }
        }
        0.0
    }

    /// Explicit power-unit torque at the start-of-step speed and the
    /// positive damping coefficient to treat implicitly.
    fn power_unit_torque(&self, omega: f64, throttle: f64) -> (f64, f64) {
        match &self.def.power_unit {
            PowerUnitDef::Direct(_) => (0.0, 0.0),
            PowerUnitDef::Combustion(c) => {
                let idle = c.idle_rpm * RPM_TO_RAD;
                let red = c.redline_rpm * RPM_TO_RAD;
                let limiter = Self::limiter(red, omega);
                let thr = throttle * limiter;
                let wot = Self::curve_torque(&c.torque_curve, omega * RAD_TO_RPM);
                let (braking, k_brake) = if c.engine_braking_curve.is_empty() {
                    let span = m::max(red - idle, 1e-9);
                    let s = m::clamp((omega - idle) / span, 0.0, 1.0);
                    let k = if omega > idle && omega < red {
                        (c.engine_braking_redline - c.engine_braking_idle) / span
                    } else {
                        0.0
                    };
                    (
                        m::lerp(c.engine_braking_idle, c.engine_braking_redline, s),
                        k,
                    )
                } else {
                    // Measured map (ADR-0011 amendment): drag and its slope
                    // in N·m per rad/s, for the implicit damping term.
                    let rpm = omega * RAD_TO_RPM;
                    (
                        Self::curve_torque(&c.engine_braking_curve, rpm),
                        Self::curve_slope(&c.engine_braking_curve, rpm) * RAD_TO_RPM,
                    )
                };
                let mut torque = thr * wot - (1.0 - thr) * braking;
                let mut k = (1.0 - thr) * m::max(k_brake, 0.0);
                if omega < idle && c.idle_torque_max > 0.0 {
                    let k_gov = c.idle_torque_max / (0.1 * idle);
                    let gov = m::min(k_gov * (idle - omega), c.idle_torque_max);
                    torque += gov;
                    if gov < c.idle_torque_max {
                        k += k_gov;
                    }
                }
                (torque, k)
            }
            PowerUnitDef::Electric(e) => {
                let wmax = e.max_rpm * RPM_TO_RAD;
                let aw = m::abs(omega);
                let fade = m::clamp((wmax - aw) / (0.05 * wmax), 0.0, 1.0);
                let drive = throttle * m::min(e.max_torque, e.max_power / m::max(aw, 1.0)) * fade;
                let walk = 0.05 * wmax;
                let regen_scale = m::clamp(aw / walk, 0.0, 1.0);
                let regen = (1.0 - throttle) * e.regen_torque * regen_scale * m::signum(omega);
                let k = if aw < walk {
                    (1.0 - throttle) * e.regen_torque / walk
                } else {
                    0.0
                };
                (drive - regen, k)
            }
        }
    }

    /// Clutch torque capacity this substep, N·m (infinite for a rigid
    /// coupling). The automatic law bites with engine speed above idle and,
    /// like a driver stopping, opens the clutch with the brake once the
    /// gearbox input has fallen below idle speed, so the engine does not
    /// drag against locked wheels.
    fn clutch_capacity(&self, input: &VehicleInput, gearbox_input_omega: f64) -> f64 {
        let t = &self.def.transmission;
        match &self.def.power_unit {
            PowerUnitDef::Electric(_) | PowerUnitDef::Direct(_) => f64::INFINITY,
            PowerUnitDef::Combustion(c) => {
                let idle = c.idle_rpm * RPM_TO_RAD;
                let auto = if t.clutch_bite_rpm > 0.0 {
                    let bite = m::clamp(
                        (self.engine_omega - idle) / (t.clutch_bite_rpm * RPM_TO_RAD),
                        0.0,
                        1.0,
                    );
                    let stopping = if m::abs(gearbox_input_omega) < idle {
                        1.0 - input.brake
                    } else {
                        1.0
                    };
                    bite * stopping
                } else {
                    1.0
                };
                t.clutch_max_torque * self.clutch_engagement * auto * (1.0 - input.clutch)
            }
        }
    }

    /// Throttle ceiling an automatic applies while its clutch re-engages
    /// after a shift and the engine is still above the gearbox input speed:
    /// enough for the engine to make a fraction of what the clutch can
    /// carry, so the clutch keeps pulling it down instead of it flaring up,
    /// opening fully again over the last few per cent of redline. Launches
    /// (input below idle) and downshifts (engine below input) are untouched.
    fn sync_throttle_limit(&self, input: &VehicleInput, gearbox_input_omega: f64) -> f64 {
        let PowerUnitDef::Combustion(c) = &self.def.power_unit else {
            return 1.0;
        };
        if self.clutch_engagement >= 1.0 || gearbox_input_omega < c.idle_rpm * RPM_TO_RAD {
            return 1.0;
        }
        let band = 0.03 * c.redline_rpm * RPM_TO_RAD;
        let synced = m::clamp(
            1.0 - (self.engine_omega - gearbox_input_omega) / band,
            0.0,
            1.0,
        );
        let wot = Self::curve_torque(&c.torque_curve, self.engine_omega * RAD_TO_RPM);
        let held = SYNC_TORQUE_FRACTION * self.clutch_capacity(input, gearbox_input_omega)
            / m::max(wot, 1.0);
        m::clamp(m::max(synced, held), 0.0, 1.0)
    }

    /// Locking torque an LSD may transfer at a given carrier torque, N·m;
    /// infinite for a locked differential.
    fn lock_capacity(
        kind: DifferentialKind,
        preload: f64,
        bias_drive: f64,
        bias_coast: f64,
        carrier_torque: f64,
        drive: bool,
    ) -> f64 {
        match kind {
            DifferentialKind::Open => 0.0,
            DifferentialKind::Locked => f64::INFINITY,
            DifferentialKind::Lsd => {
                let b = if drive { bias_drive } else { bias_coast };
                preload + m::abs(carrier_torque) * (b - 1.0) / (2.0 * (b + 1.0))
            }
        }
    }

    /// Advance the drivetrain and the wheels by one substep.
    pub fn step(&mut self, dt: f64, input: &VehicleInput, wheels: &mut [WheelDyn]) {
        self.step_with_pedal(dt, input, input.throttle, wheels);
    }

    /// `step`, with the automatic's shift schedule read from `pedal`, the
    /// driver's throttle before the assists scaled it into
    /// `input.throttle`: a traction or stability cut must not upshift.
    pub fn step_with_pedal(
        &mut self,
        dt: f64,
        input: &VehicleInput,
        pedal: f64,
        wheels: &mut [WheelDyn],
    ) {
        let n_w = self.wheel_count.min(wheels.len());
        let has_engine = self.def.has_engine();
        let n = n_w + has_engine as usize;
        let e = n_w;
        let a = self.weights();
        let mut carrier_omega = 0.0;
        for i in 0..n_w {
            carrier_omega += a[i] * wheels[i].omega;
        }

        // --- shifting and the automatic clutch ---------------------------
        self.update_shift(dt, input, pedal, carrier_omega);
        let t = &self.def.transmission;
        let interrupted = self.shift_timer > t.shift_hold;
        if !interrupted && self.clutch_engagement < 1.0 {
            self.clutch_engagement = if t.clutch_engage_time > 0.0 {
                m::min(self.clutch_engagement + dt / t.clutch_engage_time, 1.0)
            } else {
                1.0
            };
        }
        let r = if interrupted {
            0.0
        } else {
            self.ratio(self.gear)
        };
        let direction = if self.gear < 0 {
            -1.0
        } else if self.gear > 0 {
            1.0
        } else {
            0.0
        };

        // --- mass matrix --------------------------------------------------
        let i_up = t.output_inertia
            + if r != 0.0 {
                t.input_inertia * r * r
            } else {
                0.0
            };
        let mut sys = System::new(n);
        for i in 0..n_w {
            for j in 0..n_w {
                sys.mass[i][j] = i_up * a[i] * a[j];
            }
            sys.mass[i][i] += wheels[i].inertia;
            sys.v[i] = wheels[i].omega;
        }
        // An automatic lifts the throttle while the clutch is open for a
        // shift, so the engine falls toward the next gear's speed instead of
        // revving to the limiter and dumping its inertia into the wheels on
        // re-engagement.
        // It keeps the torque reduced while the clutch re-engages until the
        // engine has come down to the new gear's speed; full throttle on a
        // barely-bitten clutch would flare the engine back up toward the
        // limiter before the clutch drags it down again.
        let engine_throttle = if t.mode != TransmissionMode::Automatic {
            input.throttle
        } else if interrupted {
            0.0
        } else {
            m::min(
                input.throttle,
                self.sync_throttle_limit(input, r * carrier_omega),
            )
        };
        let (engine_torque, k_engine) = if has_engine {
            self.power_unit_torque(self.engine_omega, engine_throttle)
        } else {
            (0.0, 0.0)
        };
        if has_engine {
            let mut i_e = self.def.engine_inertia();
            if r == 0.0 {
                i_e += t.input_inertia;
            }
            sys.mass[e][e] = i_e + dt * k_engine;
            sys.v[e] = self.engine_omega;
        }
        sys.invert();

        // --- explicit forces ---------------------------------------------
        let direct_torque = match &self.def.power_unit {
            PowerUnitDef::Direct(d) if !interrupted => {
                input.throttle
                    * d.max_wheel_torque
                    * m::clamp(1.0 - m::abs(carrier_omega) / d.max_wheel_speed, 0.0, 1.0)
                    * direction
            }
            _ => 0.0,
        };
        let mut q = [0.0; MAX_DOF];
        for i in 0..n_w {
            q[i] = wheels[i].torque + a[i] * direct_torque;
        }
        if has_engine {
            q[e] = engine_torque;
        }
        sys.apply_forces(&q, dt);

        // --- constraints --------------------------------------------------
        let mut cs = [Constraint::new([0.0; MAX_DOF], 0.0, 0.0); MAX_CONSTRAINTS];
        let mut count = 0;
        let mut clutch_idx = None;
        let mut center_idx = None;
        let mut lsd_idx = [None, None];
        let mut brake_idx = [None; 4];
        if has_engine && r != 0.0 {
            let mut j = [0.0; MAX_DOF];
            for i in 0..n_w {
                j[i] = r * a[i];
            }
            j[e] = -1.0;
            let cap = self.clutch_capacity(input, r * carrier_omega) * dt;
            cs[count] = Constraint::new(j, -cap, cap);
            clutch_idx = Some(count);
            count += 1;
        }
        if self.awd() && self.def.center.kind != DifferentialKind::Open {
            let mut j = [0.0; MAX_DOF];
            if n_w == 4 {
                j[0] = 0.5;
                j[1] = 0.5;
                j[2] = -0.5;
                j[3] = -0.5;
            } else {
                j[0] = 1.0;
                j[1] = -1.0;
            }
            cs[count] = Constraint::new(j, 0.0, 0.0);
            center_idx = Some(count);
            count += 1;
        }
        if n_w == 4 {
            for axle in 0..2 {
                let d = if axle == 0 {
                    &self.def.front
                } else {
                    &self.def.rear
                };
                if self.driven[axle] && d.kind != DifferentialKind::Open {
                    let mut j = [0.0; MAX_DOF];
                    j[2 * axle] = 1.0;
                    j[2 * axle + 1] = -1.0;
                    cs[count] = Constraint::new(j, 0.0, 0.0);
                    lsd_idx[axle] = Some(count);
                    count += 1;
                }
            }
        }
        for i in 0..n_w {
            if wheels[i].brake_capacity > 0.0 {
                let mut j = [0.0; MAX_DOF];
                j[i] = 1.0;
                let cap = wheels[i].brake_capacity * dt;
                cs[count] = Constraint::new(j, -cap, cap);
                brake_idx[i] = Some(count);
                count += 1;
            }
        }
        let cs = &mut cs[..count];
        if count > 0 {
            sys.prepare(cs);
        }

        let def = &self.def;
        let awd = self.awd();
        if count > 0 {
            sys.solve(
                cs,
                |cs| {
                    // Torque-sensing bounds from the current carrier torque.
                    let carrier_torque = match clutch_idx {
                        Some(ci) => cs[ci].torque(dt) * r,
                        None => direct_torque,
                    };
                    let drive = carrier_torque * carrier_omega >= 0.0;
                    if let Some(k) = center_idx {
                        let c = &def.center;
                        let cap = Self::lock_capacity(
                            c.kind,
                            c.preload,
                            c.bias_drive,
                            c.bias_coast,
                            carrier_torque,
                            drive,
                        ) * dt;
                        cs[k].lo = -cap;
                        cs[k].hi = cap;
                    }
                    for axle in 0..2 {
                        if let Some(k) = lsd_idx[axle] {
                            let d = if axle == 0 { &def.front } else { &def.rear };
                            let share = if awd {
                                if axle == 0 {
                                    def.center.front_torque_fraction
                                } else {
                                    1.0 - def.center.front_torque_fraction
                                }
                            } else {
                                1.0
                            };
                            let cap = Self::lock_capacity(
                                d.kind,
                                d.preload,
                                d.bias_drive,
                                d.bias_coast,
                                carrier_torque * share,
                                drive,
                            ) * dt;
                            cs[k].lo = -cap;
                            cs[k].hi = cap;
                        }
                    }
                },
                SOLVER_ROUNDS,
            );
        }

        // --- results ------------------------------------------------------
        for i in 0..n_w {
            let w = &mut wheels[i];
            let old = w.omega;
            let mut new = sys.v[i];
            let mut brake_impulse = 0.0;
            w.locked = false;
            if let Some(k) = brake_idx[i] {
                brake_impulse = cs[k].lambda;
                let cap = w.brake_capacity * dt;
                if m::abs(brake_impulse) < cap {
                    // Within capacity: the brake holds the wheel exactly.
                    new = 0.0;
                    w.locked = true;
                }
            }
            w.omega = new;
            w.shaft_torque = (w.inertia * (new - old) - dt * w.torque - brake_impulse) / dt;
        }
        if has_engine {
            self.engine_omega = match &self.def.power_unit {
                PowerUnitDef::Combustion(_) => m::max(sys.v[e], 0.0),
                _ => sys.v[e],
            };
        }
        let mut new_carrier = 0.0;
        for i in 0..n_w {
            new_carrier += a[i] * wheels[i].omega;
        }
        let tel = &mut self.telemetry;
        tel.engine_rpm = self.engine_omega * RAD_TO_RPM;
        tel.engine_torque = engine_torque;
        tel.gear = self.gear;
        tel.clutch_torque = clutch_idx.map_or(0.0, |k| cs[k].torque(dt));
        tel.carrier_torque = if clutch_idx.is_some() {
            tel.clutch_torque * r
        } else {
            direct_torque
        };
        tel.clutch_slip = if has_engine && r != 0.0 {
            r * new_carrier - self.engine_omega
        } else {
            0.0
        };
        tel.center_lock = center_idx.map_or(0.0, |k| cs[k].torque(dt));
        tel.diff_lock_front = lsd_idx[0].map_or(0.0, |k| cs[k].torque(dt));
        tel.diff_lock_rear = lsd_idx[1].map_or(0.0, |k| cs[k].torque(dt));
    }
}

/// Linear from `light_factor × full` on a closed throttle to `full` at
/// full throttle, exactly `full` at full throttle. The vehicles clamp the
/// pedal to 0 … 1.
fn schedule(full: f64, light_factor: f64, pedal: f64) -> f64 {
    if pedal >= 1.0 {
        full
    } else {
        full * m::lerp(light_factor, 1.0, pedal)
    }
}
