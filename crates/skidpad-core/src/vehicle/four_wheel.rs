//! Four wheels on independent raycast suspension over a six-degree-of-freedom
//! chassis proxy (ADR-0002, ADR-0009).
//!
//! Sources: Milliken & Milliken, *Race Car Vehicle Dynamics*, ch. 16 and 18
//! (ride and roll rates, lateral load transfer through roll stiffness);
//! T. D. Gillespie, *Fundamentals of Vehicle Dynamics*, ch. 5 and 6;
//! Pacejka, *Tire and Vehicle Dynamics*, ch. 1 (vehicle-level load transfer).
//!
//! Each corner is a strut along the body's −z axis: a ray from the top of
//! travel finds the ground, the compression gives the spring force, the
//! compression rate the damper force, and the left-right travel difference
//! the anti-roll bar force. The tire sits at the ray hit with the corner's
//! total suspension force as its vertical load. There is no unsprung mass:
//! the wheel is massless and rigid, so the only vertical modes are the body's
//! heave, pitch and roll, which keeps every substep rate in the supported
//! range stable (stable beats accurate).
//!
//! The chassis is the proxy of ADR-0002. In the built-in host the proxy *is*
//! the vehicle and this struct integrates its pose on flat ground. Under an
//! external host (Rapier, Jolt) the host writes pose and velocities at the
//! start of each host step, contact planes once per host step, and reads the
//! accumulated impulses at the end; the proxy pose integrated here is only
//! used to move the rays between substeps and is discarded.

use crate::assists::{self, AssistTelemetry, WheelObs};
use crate::definition::{SuspensionKind, VehicleDefinition};
use crate::drivetrain::{Drivetrain, WheelDyn};
use crate::geom::{Quat, Vec3};
use crate::input::VehicleInput;
use crate::snapshot::Snapshottable;
use crate::surface::SurfaceTable;
use crate::telemetry as t;
use crate::tire::{
    clamp_to_friction, kinematic_slip, low_speed_fade, TireInput, TireOutput, TireTransient,
};
use crate::GRAVITY;
use skidpad_math as m;

pub const WHEEL_COUNT: usize = 4;
pub const FL: usize = 0;
pub const FR: usize = 1;
pub const RL: usize = 2;
pub const RR: usize = 3;

/// Who integrates the chassis pose.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum HostMode {
    /// The built-in minimal host: flat ground at z = 0, pose integrated here.
    #[default]
    Builtin,
    /// An external rigid-body engine owns the pose and applies the impulses
    /// this model accumulates.
    External,
}

/// Ground under one wheel for the current host step: a plane through
/// `point` with unit `normal`, moving at `surface_velocity`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WheelContact {
    pub hit: bool,
    pub point: Vec3,
    pub normal: Vec3,
    pub surface_velocity: Vec3,
    pub surface_id: u32,
}

impl Default for WheelContact {
    fn default() -> Self {
        WheelContact::flat_ground()
    }
}

impl WheelContact {
    /// Level ground at z = 0.
    pub const fn flat_ground() -> Self {
        WheelContact {
            hit: true,
            point: Vec3::ZERO,
            normal: Vec3::Z,
            surface_velocity: Vec3::ZERO,
            surface_id: 0,
        }
    }

    pub const fn none() -> Self {
        WheelContact {
            hit: false,
            point: Vec3::ZERO,
            normal: Vec3::Z,
            surface_velocity: Vec3::ZERO,
            surface_id: 0,
        }
    }
}

/// Fixed geometry of one corner, derived from the definition.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct WheelGeometry {
    /// Ray origin in the body frame (top of suspension travel).
    pub ray_origin: Vec3,
    /// Ray direction in the body frame (unit, −z).
    pub ray_direction: Vec3,
    /// Ray length beyond which the wheel is airborne.
    pub ray_length: f64,
    /// Tire unloaded radius, m.
    pub radius: f64,
    /// Static spring compression at ride height, m.
    pub static_compression: f64,
    /// Static vertical load, N.
    pub static_load: f64,
    /// +1 for left wheels, −1 for right.
    pub side: f64,
}

/// Dynamic state and last outputs of one wheel.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct WheelState {
    /// Wheel angular velocity, rad/s.
    pub omega: f64,
    /// Transient slip state (ADR-0005).
    pub transient: TireTransient,
    /// Wheel spin angle for rendering, rad, wrapped to (−π, π].
    pub spin_angle: f64,
    // --- derived per substep, not part of the snapshot ---
    pub in_contact: bool,
    /// Suspension compression from the static ride position, m (+ bump).
    pub travel: f64,
    /// Compression rate, m/s.
    pub travel_rate: f64,
    /// Total suspension force along the strut, N.
    pub susp_force: f64,
    /// Tire vertical load, N.
    pub load: f64,
    /// Road-wheel steer angle, rad (+ toward +y).
    pub steer: f64,
    /// Inclination angle at the contact, rad (ISO camber).
    pub camber: f64,
    pub kinematic_ratio: f64,
    pub kinematic_angle: f64,
    pub out: TireOutput,
    pub drive_torque: f64,
    pub brake_torque: f64,
    pub locked: bool,
    /// Hub centre, world frame.
    pub hub: Vec3,
    /// Contact point, world frame.
    pub contact_point: Vec3,
    /// Surface id of the contact this substep ran on (ADR-0014).
    pub surface_id: u32,
    /// Grip scale of that surface.
    pub surface_grip: f64,
    /// Ploughing drag the surface put on the chassis at this contact, N.
    pub surface_drag: f64,
    /// Geometric lateral load transfer on this wheel through its axle's
    /// roll centre, N (ADR-0016). Positive adds load.
    pub geometric_load: f64,
    /// Vertical force this wheel's links put on the body from its axle's
    /// longitudinal tire force, N (anti-dive, anti-squat; ADR-0018).
    /// Positive adds load and pushes the body up.
    pub pitch_load: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct FourWheelVehicle {
    def: VehicleDefinition,
    geometry: [WheelGeometry; WHEEL_COUNT],
    pub host_mode: HostMode,
    pub contacts: [WheelContact; WHEEL_COUNT],
    // --- simulation state (everything in the snapshot) ---
    pub time: f64,
    /// Centre of mass, world frame.
    pub pos: Vec3,
    /// Body orientation (body → world).
    pub orient: Quat,
    /// Linear velocity of the centre of mass, world frame.
    pub vel: Vec3,
    /// Angular velocity, body frame.
    pub omega: Vec3,
    pub wheels: [WheelState; WHEEL_COUNT],
    /// Power unit, clutch, gearbox and differentials (ADR-0011); its state
    /// is in the snapshot.
    pub drivetrain: Drivetrain,
    // --- host-step accumulators (external host mode) ---
    /// Net impulse of everything except gravity over the host step, world
    /// frame, N·s.
    pub impulse: Vec3,
    /// Net angular impulse over the host step, world frame, N·m·s.
    pub angular_impulse: Vec3,
    // --- derived outputs of the last substep ---
    pub steer_angle: f64,
    /// Body-frame acceleration from forces other than gravity, m/s².
    pub accel_body: Vec3,
    pub drag_force: f64,
    /// Hand-wheel torque in the sign of the steer input, N·m (ADR-0012).
    pub steering_torque: f64,
    /// Force on the steering rack, N.
    pub rack_force: f64,
    /// What the assists did this substep (ADR-0013).
    pub assist_telemetry: AssistTelemetry,
    /// Aero lift at the front and rear axle this substep, N, positive up
    /// (ADR-0015).
    pub aero_lift: [f64; 2],
    /// Lateral tire force of each axle in the body frame at the end of the
    /// last substep, N: the input to the next substep's geometric load
    /// transfer through the roll centres (ADR-0016). Lagging one substep
    /// keeps the load–force loop explicit; the loop gain `h_rc / t` times
    /// the load sensitivity is far below one. In the snapshot.
    pub axle_fy_prev: [f64; 2],
    /// Longitudinal tire force of each axle in the body frame over the last
    /// substep, N: the input to the next substep's anti-dive and anti-squat
    /// (ADR-0018), lagged one substep like `axle_fy_prev`. In the snapshot.
    pub axle_fx_prev: [f64; 2],
    /// Surface id the built-in flat ground carries under every wheel
    /// (ADR-0014). An external host tags each contact itself.
    pub builtin_surface_id: u32,
    /// Ground slope under the built-in host as the rise per metre along
    /// world +x (grade) and world +y (cross slope). The built-in ground
    /// stays the plane z = 0 and gravity is tilted instead, which is the
    /// same physics; an external host has real geometry and its own
    /// gravity, so the slope is ignored in external mode. Not part of the
    /// definition or the snapshot.
    pub ground_slope: [f64; 2],
}

impl FourWheelVehicle {
    pub fn new(def: VehicleDefinition) -> Self {
        let drivetrain = Drivetrain::new(def.drivetrain.clone(), def.driven_axles(), WHEEL_COUNT);
        let mut v = Self {
            geometry: [WheelGeometry::default(); WHEEL_COUNT],
            drivetrain,
            def,
            host_mode: HostMode::Builtin,
            contacts: [WheelContact::flat_ground(); WHEEL_COUNT],
            time: 0.0,
            pos: Vec3::ZERO,
            orient: Quat::IDENTITY,
            vel: Vec3::ZERO,
            omega: Vec3::ZERO,
            wheels: [WheelState::default(); WHEEL_COUNT],
            impulse: Vec3::ZERO,
            angular_impulse: Vec3::ZERO,
            steer_angle: 0.0,
            accel_body: Vec3::ZERO,
            drag_force: 0.0,
            steering_torque: 0.0,
            rack_force: 0.0,
            assist_telemetry: AssistTelemetry::default(),
            aero_lift: [0.0, 0.0],
            axle_fy_prev: [0.0, 0.0],
            axle_fx_prev: [0.0, 0.0],
            builtin_surface_id: 0,
            ground_slope: [0.0, 0.0],
        };
        v.compute_geometry();
        v.reset(0.0, 0.0, 0.0);
        v
    }

    /// Set the ground slope of the built-in flat world as the rise per
    /// metre along world +x (`grade`, 0.1 for a 10 % grade) and world +y
    /// (`cross`). A car heading +x faces uphill on a positive grade.
    pub fn set_ground_slope(&mut self, grade: f64, cross: f64) {
        self.ground_slope = [grade, cross];
    }

    /// Surface id of the built-in flat ground under every wheel (ADR-0014).
    /// Ignored in external host mode, where the host tags each contact.
    pub fn set_surface(&mut self, id: u32) {
        self.builtin_surface_id = id;
        if self.host_mode == HostMode::Builtin {
            for c in &mut self.contacts {
                c.surface_id = id;
            }
        }
    }

    /// Gravity vector in the world frame, m/s². In the built-in host the
    /// ground is the plane z = 0 and a slope is represented by tilting
    /// gravity: `g (−gx, −gy, −1) / N` with `N² = 1 + gx² + gy²`, which has
    /// `g cos θ` into the ground and `g sin θ` along it.
    fn gravity(&self) -> Vec3 {
        if self.host_mode == HostMode::External {
            return Vec3::new(0.0, 0.0, -GRAVITY);
        }
        let [gx, gy] = self.ground_slope;
        let n = m::sqrt(1.0 + gx * gx + gy * gy);
        Vec3::new(-gx, -gy, -1.0) * (GRAVITY / n)
    }

    pub fn definition(&self) -> &VehicleDefinition {
        &self.def
    }

    /// Replace the definition while keeping the state (live tuning).
    pub fn set_definition(&mut self, def: VehicleDefinition) {
        self.drivetrain
            .set_definition(def.drivetrain.clone(), def.driven_axles());
        self.def = def;
        self.compute_geometry();
    }

    pub fn geometry(&self) -> &[WheelGeometry; WHEEL_COUNT] {
        &self.geometry
    }

    fn compute_geometry(&mut self) {
        let c = &self.def.chassis;
        for i in 0..WHEEL_COUNT {
            let axle = i / 2;
            let half_track = 0.5 * self.def.axle_track(axle);
            let a = &self.def.axles[axle];
            let x = if axle == 0 {
                c.cg_to_front_axle
            } else {
                -self.def.cg_to_rear_axle()
            };
            let side = if i % 2 == 0 { 1.0 } else { -1.0 };
            let radius = a.tire.unloaded_radius();
            let s = &a.suspension;
            let static_load = self.def.static_wheel_load(axle);
            self.geometry[i] = WheelGeometry {
                // At ride height the hub sits at z = radius above ground and
                // the centre of mass at z = cg_height; the ray starts a full
                // bump travel above the hub.
                ray_origin: Vec3::new(x, side * half_track, radius - c.cg_height + s.travel_bump),
                ray_direction: Vec3::new(0.0, 0.0, -1.0),
                ray_length: radius + s.travel_bump + s.travel_droop,
                radius,
                static_compression: static_load / s.spring_rate,
                static_load,
                side,
            };
        }
    }

    /// Place the vehicle level at ride height, at rest.
    pub fn reset(&mut self, x: f64, y: f64, yaw: f64) {
        self.time = 0.0;
        self.pos = Vec3::new(x, y, self.def.chassis.cg_height);
        self.orient = Quat::from_yaw(yaw);
        self.vel = Vec3::ZERO;
        self.omega = Vec3::ZERO;
        self.impulse = Vec3::ZERO;
        self.angular_impulse = Vec3::ZERO;
        self.accel_body = Vec3::ZERO;
        self.drag_force = 0.0;
        self.steering_torque = 0.0;
        self.rack_force = 0.0;
        self.steer_angle = 0.0;
        self.aero_lift = [0.0, 0.0];
        self.axle_fy_prev = [0.0, 0.0];
        self.axle_fx_prev = [0.0, 0.0];
        for (i, w) in self.wheels.iter_mut().enumerate() {
            let g = self.geometry[i];
            *w = WheelState {
                in_contact: true,
                load: g.static_load,
                susp_force: g.static_load,
                surface_grip: 1.0,
                ..WheelState::default()
            };
        }
        if self.host_mode == HostMode::Builtin {
            let mut ground = WheelContact::flat_ground();
            ground.surface_id = self.builtin_surface_id;
            self.contacts = [ground; WHEEL_COUNT];
        }
        self.drivetrain.reset();
    }

    /// Set a forward speed with the wheels rolling to match.
    pub fn set_speed(&mut self, vx: f64) {
        self.vel = self.orient.rotate(Vec3::new(vx, 0.0, 0.0));
        for (i, w) in self.wheels.iter_mut().enumerate() {
            w.omega = vx / self.geometry[i].radius;
            w.transient = TireTransient::default();
        }
        let mut carrier = 0.0;
        let driven = self.def.driven_axles();
        let mut n = 0.0;
        for (i, w) in self.wheels.iter().enumerate() {
            if driven[i / 2] {
                carrier += w.omega;
                n += 1.0;
            }
        }
        self.drivetrain
            .match_speed(if n > 0.0 { carrier / n } else { 0.0 });
    }

    /// Velocity in the body frame.
    #[inline]
    pub fn vel_body(&self) -> Vec3 {
        self.orient.inverse_rotate(self.vel)
    }

    /// Forward speed component, m/s.
    #[inline]
    pub fn vx(&self) -> f64 {
        self.vel_body().x
    }

    /// Speed over ground (horizontal), m/s.
    #[inline]
    pub fn speed(&self) -> f64 {
        m::hypot(self.vel.x, self.vel.y)
    }

    #[inline]
    pub fn yaw_rate(&self) -> f64 {
        self.omega.z
    }

    /// Hand the proxy the host body's state at the start of a host step and
    /// clear the impulse accumulators.
    pub fn begin_host_step(&mut self, pos: Vec3, orient: Quat, vel: Vec3, angvel_world: Vec3) {
        if pos.is_finite() && orient.is_finite() && vel.is_finite() && angvel_world.is_finite() {
            self.pos = pos;
            self.orient = orient.normalized();
            self.vel = vel;
            self.omega = self.orient.inverse_rotate(angvel_world);
        }
        self.impulse = Vec3::ZERO;
        self.angular_impulse = Vec3::ZERO;
    }

    /// Road-wheel steer angle for wheel `i` given the reference angle at the
    /// wheelbase midline, with the definition's Ackermann fraction. Ideal
    /// Ackermann: `tan δ_i = L / (R ∓ w/2)` with `R = L / tan δ`
    /// (Gillespie ch. 8, Milliken ch. 19).
    fn wheel_steer(&self, i: usize, delta: f64) -> f64 {
        let axle = i / 2;
        if !self.def.axles[axle].steered {
            return 0.0;
        }
        let ack = self.def.steering.ackermann;
        if ack <= 0.0 || m::abs(delta) < 1e-9 {
            return delta;
        }
        let l = self.def.chassis.wheelbase;
        let half = 0.5 * self.def.axle_track(axle);
        let td = m::tan(delta);
        let denom = m::max(l - self.geometry[i].side * half * td, 0.1 * l);
        let ideal = m::atan(l * td / denom);
        delta + ack * (ideal - delta)
    }

    /// Static toe of wheel `i` as a road-wheel angle about +z, rad: toe-in
    /// points the left wheel right (negative) and the right wheel left.
    #[inline]
    fn toe(&self, i: usize) -> f64 {
        -self.geometry[i].side * m::deg_to_rad(self.def.axles[i / 2].static_toe_deg)
    }

    /// One substep of the pipeline on the reference surface everywhere.
    #[inline]
    pub fn substep(&mut self, dt: f64, input: &VehicleInput) {
        self.substep_on(dt, input, &SurfaceTable::REFERENCE);
    }

    /// One substep of the pipeline with the contacts' surface ids looked
    /// up in `surfaces` (ADR-0014).
    pub fn substep_on(&mut self, dt: f64, input: &VehicleInput, surfaces: &SurfaceTable) {
        let input = input.clamped();
        let mass = self.def.chassis.mass;
        let orient = self.orient;
        let omega_world = orient.rotate(self.omega);
        let down = orient.rotate(Vec3::new(0.0, 0.0, -1.0));
        let up = -down;
        let vb = self.vel_body();

        // --- steering ----------------------------------------------------
        // Positive input steers right (toward −y): a negative angle about +z.
        // The steering assist (ADR-0013) caps the angle at speed.
        let steer_scale = assists::steer_scale(
            &self.def.assists.steering_assist,
            self.vx(),
            self.def.chassis.wheelbase,
            self.def.max_wheel_angle(),
        );
        self.assist_telemetry.steer_assist_scale = steer_scale;
        let delta = -input.steer * steer_scale * self.def.max_wheel_angle();
        self.steer_angle = delta;
        // Steering angle of each wheel, then its static toe on top.
        let steers = [
            self.wheel_steer(FL, delta),
            self.wheel_steer(FR, delta),
            self.wheel_steer(RL, delta),
            self.wheel_steer(RR, delta),
        ];
        let toes = [self.toe(FL), self.toe(FR), self.toe(RL), self.toe(RR)];

        // --- contacts: ray from the top of travel to the contact plane ------
        // --- suspension travel and rate ---------------------------------------
        for (i, &steer) in steers.iter().enumerate() {
            let g = self.geometry[i];
            let c = self.contacts[i];
            let origin = self.pos + orient.rotate(g.ray_origin);
            let w = &mut self.wheels[i];
            w.steer = steer + toes[i];
            let dn = down.dot(c.normal);
            let hit_t = if c.hit && dn < -1e-6 {
                let tt = (c.point - origin).dot(c.normal) / dn;
                if tt.is_finite() {
                    Some(tt)
                } else {
                    None
                }
            } else {
                None
            };
            // Jacking (ADR-0012): with steer, the inner wheel's contact moves
            // down the ray and the outer's up, as caster and kingpin
            // inclination do; the spring sees it as compression. It follows
            // the steering angle only: static toe is set at ride height.
            let jack = g.side * steer * self.def.steering.jacking_rate;
            match hit_t {
                // A ray is a finite forward segment, not an infinite line.
                // Behind-origin hits during rollover otherwise acquire an
                // unbounded lever arm as the strut becomes parallel to the
                // plane (ADR-0024).
                Some(tt) if tt >= 0.0 && tt <= g.ray_length => {
                    w.in_contact = true;
                    // At the static position the hit is one bump travel plus
                    // one radius down the ray; shorter hits are compression.
                    w.travel =
                        g.ray_length - self.def.axles[i / 2].suspension.travel_droop - tt + jack;
                    let v_origin = self.vel + omega_world.cross(origin - self.pos);
                    w.travel_rate = (v_origin - c.surface_velocity).dot(c.normal) / dn;
                    w.contact_point = origin + down * tt;
                    w.hub = origin + down * (tt - g.radius);
                }
                _ => {
                    w.in_contact = false;
                    w.travel = -self.def.axles[i / 2].suspension.travel_droop;
                    w.travel_rate = 0.0;
                    w.hub = origin + down * (g.ray_length - g.radius);
                    w.contact_point = origin + down * g.ray_length;
                }
            }
        }

        // --- wheel loads: spring, damper, anti-roll bar, bump stop -----------
        let mut force = Vec3::ZERO; // everything except gravity, world frame
        let mut torque = Vec3::ZERO; // world frame, about the centre of mass
        for i in 0..WHEEL_COUNT {
            let g = self.geometry[i];
            let s = &self.def.axles[i / 2].suspension;
            let other = self.wheels[i ^ 1].travel;
            let w = &mut self.wheels[i];
            if !w.in_contact {
                w.susp_force = 0.0;
                w.load = 0.0;
                continue;
            }
            let spring = s.spring_rate * (g.static_compression + w.travel);
            let damper = if w.travel_rate > 0.0 {
                s.bump_damping * w.travel_rate
            } else {
                s.rebound_damping * w.travel_rate
            };
            let arb = s.anti_roll_stiffness * (w.travel - other);
            let stop = if w.travel > s.travel_bump {
                s.bump_stop_stiffness * (w.travel - s.travel_bump)
            } else {
                0.0
            };
            // The ground can push but not pull.
            w.susp_force = m::max(spring + damper + arb + stop, 0.0);
            let n = self.contacts[i].normal;
            w.load = w.susp_force * m::max(-down.dot(n), 0.0);
            // Roll centre (ADR-0016): the part of this axle's lateral load
            // transfer that the links carry straight to the ground, as a
            // couple on the body through the two contacts. Left wheels
            // (`side` +1) lose load when the axle pushes toward +y (a left
            // turn, outer wheel on the right). Milliken & Milliken ch. 18,
            // geometric load transfer `F_y · h_rc / t`.
            let rc = s.roll_center_height;
            w.geometric_load = if rc != 0.0 {
                -g.side * self.axle_fy_prev[i / 2] * rc / self.def.axle_track(i / 2)
            } else {
                0.0
            };
            // Anti-dive and anti-squat (ADR-0018): the share of the load
            // transfer caused by this axle's longitudinal force that its
            // links carry straight to the tires, `anti · F_x · h / L` for
            // the axle, split between its wheels. Braking at the front
            // (F_x < 0) lifts the nose; driving at the rear lifts the tail.
            // The force's sign picks the braking or the drive geometry, so
            // the load goes through zero continuously.
            let axle = i / 2;
            let fx = self.axle_fx_prev[axle];
            let anti = if fx < 0.0 { s.anti_brake } else { s.anti_drive };
            w.pitch_load = if anti != 0.0 {
                let front = if axle == 0 { -1.0 } else { 1.0 };
                0.5 * front * anti * fx * self.def.chassis.cg_height / self.def.chassis.wheelbase
            } else {
                0.0
            };
            w.load = m::max(w.load + w.geometric_load + w.pitch_load, 0.0);
            let f = n * w.load;
            force = force + f;
            torque = torque + (w.contact_point - self.pos).cross(f);
        }

        // --- aero lift (ADR-0015): at each axle, along the body's up axis ---
        // Lift follows the forward airspeed squared through the frontal
        // area; it reaches the tires through the springs, as it does on a
        // real car, so the raycast suspension needs no special case.
        {
            let aero = &self.def.aero;
            let q = aero.q_area() * vb.x * vb.x;
            let c = &self.def.chassis;
            let xs = [c.cg_to_front_axle, -self.def.cg_to_rear_axle()];
            let cls = [aero.lift_coefficient_front, aero.lift_coefficient_rear];
            for axle in 0..2 {
                let lift = cls[axle] * q;
                self.aero_lift[axle] = lift;
                if lift != 0.0 {
                    let f = up * lift;
                    let r = orient.rotate(Vec3::new(xs[axle], 0.0, 0.0));
                    force = force + f;
                    torque = torque + r.cross(f);
                }
            }
        }

        // --- tires, then the drivetrain solve (ADR-0011) ---------------------
        // Each wheel's tire force is evaluated at the start-of-step state and
        // becomes a boundary torque on the drivetrain system; the implicit
        // tire stiffness goes into the wheel's effective inertia (ADR-0010).
        let mut dyn_wheels = [WheelDyn::default(); WHEEL_COUNT];
        let mut tire_forces = [(Vec3::ZERO, Vec3::ZERO, 0.0); WHEEL_COUNT];
        // Solid axles (ADR-0016): the wheels stand on the beam, the line
        // through the axle's two contacts, not on the body. Each axle's
        // lateral axis (pointing left) is that line while both wheels touch.
        let mut beam_lat = [None; 2];
        for (axle, beam) in beam_lat.iter_mut().enumerate() {
            if self.def.axles[axle].suspension.kind == SuspensionKind::Solid {
                let l = &self.wheels[2 * axle];
                let r = &self.wheels[2 * axle + 1];
                if l.in_contact && r.in_contact {
                    let d = l.contact_point - r.contact_point;
                    if d.length() > 1e-6 {
                        *beam = Some(d.normalized());
                    }
                }
            }
        }
        let mut axle_fy = [0.0; 2];
        let mut axle_fx = [0.0; 2];
        for i in 0..WHEEL_COUNT {
            let axle = i / 2;
            let adef = &self.def.axles[axle];
            let tire = &adef.tire;
            let g = self.geometry[i];
            let radius = g.radius;
            let floor = tire.low_speed_floor();
            let (sigma_x, sigma_y) = tire.relaxation_lengths();
            let c = self.contacts[i];
            let surface = surfaces.get(c.surface_id);
            let w = &mut self.wheels[i];
            w.surface_id = c.surface_id;
            w.surface_grip = surface.grip;

            // Wheel axes at the contact: lateral axis from the steer angle,
            // forward and lateral in the contact plane from the normal.
            let (sd, cd) = (m::sin(w.steer), m::cos(w.steer));
            let n = c.normal;
            let y_w = match beam_lat[axle] {
                // The beam's lateral axis, steered about the contact normal
                // (Rodrigues; the beam lies in the contact plane, so the
                // axial term vanishes).
                Some(b) => b * cd + n.cross(b) * sd,
                None => orient.rotate(Vec3::new(-sd, cd, 0.0)),
            };
            let fwd = y_w.cross(n).normalized();
            let lat = n.cross(fwd);
            // Static camber is quoted as negative = top toward the centreline;
            // in the ISO frame that is negative on the left wheel and
            // positive on the right.
            w.camber = -m::asin(m::clamp(y_w.dot(n), -1.0, 1.0))
                + g.side * m::deg_to_rad(adef.static_camber_deg);

            let v_contact =
                self.vel + omega_world.cross(w.contact_point - self.pos) - c.surface_velocity;
            let wx = v_contact.dot(fwd);
            let wy = v_contact.dot(lat);

            let (kappa, alpha) = kinematic_slip(wx, wy, w.omega, radius, floor);
            w.kinematic_ratio = kappa;
            w.kinematic_angle = alpha;
            // Contact-patch deflection transient (ADR-0010), bounded at
            // standstill by the force peak or the floored kinematic slip.
            let (kappa_peak, tan_alpha_peak) = tire.static_slip_bounds();
            let slip_vx = w.omega * radius - wx;
            w.transient.update(
                slip_vx,
                wy,
                wx,
                dt,
                sigma_x,
                sigma_y,
                m::max(kappa_peak, m::abs(kappa)),
                m::max(tan_alpha_peak, m::abs(wy) / m::max(m::abs(wx), floor)),
            );
            // Low-speed damping (ADR-0010): a viscous term on the contact
            // slip velocities that fades out with rolling speed, with its
            // longitudinal part treated implicitly in the wheel equation.
            let fade = low_speed_fade(wx, tire.low_speed_damping_fade());
            let (c_x, c_y) = if fade > 0.0 && w.in_contact && w.load > 0.0 {
                let (cx, cy) = tire.low_speed_damping_coefficients(w.load, dt);
                (cx * fade, cy * fade)
            } else {
                (0.0, 0.0)
            };
            let out = if w.in_contact && w.load > 0.0 {
                let mut o = tire.eval(&TireInput {
                    fz: w.load,
                    slip_ratio: w.transient.slip_ratio,
                    slip_angle: w.transient.slip_angle,
                    camber: w.camber,
                    vx: wx,
                    grip: surface.grip,
                    rolling_resistance: surface.rolling_resistance,
                });
                let fx = o.fx + c_x * slip_vx;
                let fy = o.fy - c_y * wy;
                // Curve plus damping may not exceed what the curve allows:
                // the peak below it, the sliding force past it.
                let bound = m::max(m::hypot(o.fx, o.fy), m::max(o.fx_slide, o.fy_slide));
                let (fx, fy) = clamp_to_friction(fx, fy, bound);
                o.fx = fx;
                o.fy = fy;
                o
            } else {
                TireOutput::default()
            };
            w.out = out;

            let mut brake_cap = 0.5 * input.brake * adef.max_brake_torque;
            if axle == 1 {
                brake_cap += 0.5 * input.handbrake * self.def.brakes.handbrake_torque;
            }
            w.brake_torque = brake_cap;

            // Implicit wheel spin (ADR-0005 item 3 as re-derived in
            // ADR-0010), one wheel: the force sensitivity to wheel speed is
            // `Cκ·R·dt / (σx + dt·|Vx|)` plus the damping `c_x·R`.
            let gain = TireTransient::deflection_gain(wx, dt, sigma_x);
            let dfx_domega = tire.longitudinal_stiffness(w.load) * radius * gain + c_x * radius;
            dyn_wheels[i] = WheelDyn {
                omega: w.omega,
                inertia: adef.wheel_inertia + dt * radius * dfx_domega,
                torque: -radius * out.fx + out.my,
                brake_capacity: brake_cap,
                axle,
                ..WheelDyn::default()
            };
            // Ploughing drag of the surface (ADR-0014): on the chassis at
            // the contact, against the contact-patch motion in the plane.
            let v_plane = v_contact - n * v_contact.dot(n);
            let v_mag = v_plane.length();
            w.surface_drag = if w.in_contact && w.load > 0.0 {
                surface.drag_force(w.load, v_mag, floor)
            } else {
                0.0
            };
            let drag = if w.surface_drag > 0.0 && v_mag > 1e-9 {
                v_plane * (-w.surface_drag / v_mag)
            } else {
                Vec3::ZERO
            };
            let f_tire = fwd * out.fx + lat * out.fy;
            // Lateral force of the axle in the body frame, for the roll
            // centre of the next substep.
            let f_body = orient.inverse_rotate(f_tire);
            axle_fy[axle] += f_body.y;
            axle_fx[axle] += f_body.x;
            tire_forces[i] = (f_tire + drag, n, out.mz);
        }
        self.axle_fy_prev = axle_fy;
        self.axle_fx_prev = axle_fx;

        // --- assists (ADR-0013): scale brakes, throttle for this substep ----
        let mut drive_input = input;
        if self.def.assists.any_enabled() {
            let mut obs = [WheelObs::default(); WHEEL_COUNT];
            let mut caps = [0.0; WHEEL_COUNT];
            let (mut fy_max, mut load) = (0.0, 0.0);
            for i in 0..WHEEL_COUNT {
                let w = &self.wheels[i];
                obs[i] = WheelObs {
                    kappa: w.kinematic_ratio,
                    driven: self.def.axles[i / 2].driven,
                    front: i < 2,
                    side: self.geometry[i].side,
                };
                caps[i] = dyn_wheels[i].brake_capacity;
                if i < 2 {
                    fy_max += w.out.fy_max;
                    load += w.load;
                }
            }
            let mu = if load > 0.0 { fy_max / load } else { 1.0 };
            drive_input.throttle = assists::apply(
                &self.def.assists,
                &obs,
                &mut caps,
                self.vx(),
                self.omega.z,
                self.steer_angle,
                self.def.chassis.wheelbase,
                mu,
                input.throttle,
                &mut self.assist_telemetry,
            );
            for i in 0..WHEEL_COUNT {
                dyn_wheels[i].brake_capacity = caps[i];
                self.wheels[i].brake_torque = caps[i];
            }
        } else {
            self.assist_telemetry.throttle_effective = input.throttle;
        }

        self.drivetrain
            .step_with_pedal(dt, &drive_input, input.throttle, &mut dyn_wheels);

        for i in 0..WHEEL_COUNT {
            let d = dyn_wheels[i];
            let w = &mut self.wheels[i];
            w.omega = d.omega;
            w.locked = d.locked;
            w.drive_torque = d.shaft_torque;
            w.spin_angle += w.omega * dt;
            if w.spin_angle > m::PI {
                w.spin_angle -= m::TAU;
            } else if w.spin_angle < -m::PI {
                w.spin_angle += m::TAU;
            }

            // --- tire forces into the world frame at the contact point ------
            if w.in_contact {
                let (f, n, mz) = tire_forces[i];
                force = force + f;
                torque = torque + (w.contact_point - self.pos).cross(f) + n * mz;
            }
        }

        // --- aero drag (ADR-0015) ----------------------------------------------
        // Against the velocity, on a line `dragHeightAboveCg` above the
        // centre of mass, so drag high on the body lifts the nose.
        let aero = &self.def.aero;
        let speed = self.vel.length();
        let q = aero.q_area() * aero.drag_coefficient * speed;
        self.drag_force = q * speed;
        let f_drag = -self.vel * q;
        force = force + f_drag;
        if aero.drag_height_above_cg != 0.0 {
            torque = torque + (up * aero.drag_height_above_cg).cross(f_drag);
        }

        // --- chassis proxy integration (semi-implicit Euler) ------------------
        self.impulse = self.impulse + force * dt;
        self.angular_impulse = self.angular_impulse + torque * dt;
        let accel = force * (1.0 / mass);
        self.accel_body = orient.inverse_rotate(accel);
        let gravity = self.gravity();
        self.vel = self.vel + (accel + gravity) * dt;

        let c = &self.def.chassis;
        let inertia = Vec3::new(c.roll_inertia, c.pitch_inertia, c.yaw_inertia);
        let torque_body = orient.inverse_rotate(torque);
        let iw = Vec3::new(
            inertia.x * self.omega.x,
            inertia.y * self.omega.y,
            inertia.z * self.omega.z,
        );
        let gyro = self.omega.cross(iw);
        let net = torque_body - gyro;
        self.omega = self.omega
            + Vec3::new(
                net.x / inertia.x * dt,
                net.y / inertia.y * dt,
                net.z / inertia.z * dt,
            );

        // --- pose integration (the minimal host, or the proxy's own copy) -----
        self.pos = self.pos + self.vel * dt;
        self.orient = self.orient.integrate(self.omega, dt);
        self.time += dt;

        // Kingpin torque of the steered wheels (ADR-0012): aligning moment,
        // mechanical trail and scrub radius, through the ratio and the assist
        // to the hand wheel, and over the knuckle arm to the rack.
        let mut kingpin = 0.0;
        for i in 0..WHEEL_COUNT {
            if self.def.axles[i / 2].steered {
                let o = &self.wheels[i].out;
                kingpin += self
                    .def
                    .kingpin_torque(o.mz, o.fy, o.fx, self.geometry[i].side);
            }
        }
        self.steering_torque = self.def.hand_wheel_torque(kingpin);
        self.rack_force = kingpin / self.def.steering.steering_arm;
    }

    /// Write the telemetry record for the current state.
    pub fn write_telemetry(&self, input: &VehicleInput, rec: &mut [f64]) {
        if rec.len() < t::STRIDE {
            return;
        }
        let vb = self.vel_body();
        let (yaw, pitch, roll) = self.orient.to_yaw_pitch_roll();
        let floor = self.def.axles[0].tire.low_speed_floor();
        rec[t::TIME] = self.time;
        rec[t::POS_X] = self.pos.x;
        rec[t::POS_Y] = self.pos.y;
        rec[t::POS_Z] = self.pos.z;
        rec[t::YAW] = yaw;
        rec[t::PITCH] = pitch;
        rec[t::ROLL] = roll;
        rec[t::QUAT_X] = self.orient.x;
        rec[t::QUAT_Y] = self.orient.y;
        rec[t::QUAT_Z] = self.orient.z;
        rec[t::QUAT_W] = self.orient.w;
        rec[t::VEL_X] = vb.x;
        rec[t::VEL_Y] = vb.y;
        rec[t::VEL_Z] = self.vel.z;
        rec[t::YAW_RATE] = self.omega.z;
        rec[t::PITCH_RATE] = self.omega.y;
        rec[t::ROLL_RATE] = self.omega.x;
        rec[t::SPEED] = self.speed();
        rec[t::LONG_ACCEL] = self.accel_body.x;
        rec[t::LAT_ACCEL] = self.accel_body.y;
        rec[t::VERT_ACCEL] = self.accel_body.z;
        rec[t::BODY_SLIP] = m::atan2(vb.y, m::max(m::abs(vb.x), floor));
        rec[t::STEERING_WHEEL_ANGLE] = self.steer_angle * self.def.steering.ratio;
        rec[t::STEER_ANGLE] = self.steer_angle;
        rec[t::THROTTLE] = input.throttle;
        rec[t::BRAKE] = input.brake;
        rec[t::HANDBRAKE] = input.handbrake;
        rec[t::STEERING_TORQUE] = self.steering_torque;
        rec[t::RACK_FORCE] = self.rack_force;
        rec[t::DRAG_FORCE] = self.drag_force;

        for axle in 0..2 {
            let l = &self.wheels[2 * axle];
            let r = &self.wheels[2 * axle + 1];
            let o = axle; // _F channels come first, _R second
            rec[t::WHEEL_SPEED_F + o] = 0.5 * (l.omega + r.omega);
            rec[t::LOAD_F + o] = l.load + r.load;
            rec[t::SLIP_RATIO_F + o] = 0.5 * (l.transient.slip_ratio + r.transient.slip_ratio);
            rec[t::SLIP_ANGLE_F + o] = 0.5 * (l.transient.slip_angle + r.transient.slip_angle);
            rec[t::FX_F + o] = l.out.fx + r.out.fx;
            rec[t::FY_F + o] = l.out.fy + r.out.fy;
            rec[t::MZ_F + o] = l.out.mz + r.out.mz;
            rec[t::FMAX_F + o] = l.out.fy_max + r.out.fy_max;
            rec[t::TRAIL_F + o] = 0.5 * (l.out.trail + r.out.trail);
            rec[t::DRIVE_TORQUE_F + o] = l.drive_torque + r.drive_torque;
            rec[t::BRAKE_TORQUE_F + o] = l.brake_torque + r.brake_torque;
            rec[t::WHEEL_LOCKED_F + o] = if l.locked || r.locked { 1.0 } else { 0.0 };
        }
        for (i, w) in self.wheels.iter().enumerate() {
            rec[t::WHEEL_SPEED_FL + i] = w.omega;
            rec[t::LOAD_FL + i] = w.load;
            rec[t::SLIP_RATIO_FL + i] = w.transient.slip_ratio;
            rec[t::SLIP_ANGLE_FL + i] = w.transient.slip_angle;
            rec[t::FX_FL + i] = w.out.fx;
            rec[t::FY_FL + i] = w.out.fy;
            rec[t::MZ_FL + i] = w.out.mz;
            rec[t::CAMBER_FL + i] = w.camber;
            rec[t::SUSP_TRAVEL_FL + i] = w.travel;
            rec[t::SUSP_RATE_FL + i] = w.travel_rate;
            rec[t::SUSP_FORCE_FL + i] = w.susp_force;
            rec[t::WHEEL_STEER_FL + i] = w.steer;
            rec[t::WHEEL_CONTACT_FL + i] = if w.in_contact { 1.0 } else { 0.0 };
            rec[t::WHEEL_LOCKED_FL + i] = if w.locked { 1.0 } else { 0.0 };
            rec[t::SPIN_ANGLE_FL + i] = w.spin_angle;
            rec[t::SURFACE_ID_FL + i] = w.surface_id as f64;
            rec[t::SURFACE_GRIP_FL + i] = w.surface_grip;
        }
        rec[t::AERO_LIFT_F] = self.aero_lift[0];
        rec[t::AERO_LIFT_R] = self.aero_lift[1];
        // Outer-wheel gain through the links, as a positive number.
        for axle in 0..2 {
            let l = self.wheels[2 * axle].geometric_load;
            let r = self.wheels[2 * axle + 1].geometric_load;
            rec[t::GEOMETRIC_TRANSFER_F + axle] = m::max(m::abs(l), m::abs(r));
            rec[t::PITCH_LINK_LOAD_F + axle] =
                self.wheels[2 * axle].pitch_load + self.wheels[2 * axle + 1].pitch_load;
        }
        write_drivetrain_telemetry(&self.drivetrain, input, rec);
        write_assist_telemetry(&self.assist_telemetry, rec);
    }
}

/// The assist channels, shared by both models.
pub(crate) fn write_assist_telemetry(a: &AssistTelemetry, rec: &mut [f64]) {
    rec[t::ABS_ACTIVITY] = a.abs_activity;
    rec[t::TC_ACTIVITY] = a.tc_activity;
    rec[t::ESC_YAW_ERROR] = a.esc_yaw_error;
    rec[t::ESC_BRAKE_TORQUE] = a.esc_brake_torque;
    rec[t::STEER_ASSIST_SCALE] = a.steer_assist_scale;
    rec[t::THROTTLE_EFFECTIVE] = a.throttle_effective;
}

/// The drivetrain channels, shared by both models.
pub(crate) fn write_drivetrain_telemetry(d: &Drivetrain, input: &VehicleInput, rec: &mut [f64]) {
    let tel = &d.telemetry;
    rec[t::ENGINE_RPM] = tel.engine_rpm;
    rec[t::ENGINE_TORQUE] = tel.engine_torque;
    rec[t::GEAR] = tel.gear as f64;
    rec[t::CLUTCH_SLIP] = tel.clutch_slip;
    rec[t::CLUTCH_TORQUE] = tel.clutch_torque;
    rec[t::DIFF_LOCK_TORQUE_F] = tel.diff_lock_front;
    rec[t::DIFF_LOCK_TORQUE_R] = tel.diff_lock_rear;
    rec[t::CENTER_LOCK_TORQUE] = tel.center_lock;
    rec[t::CLUTCH] = input.clutch;
}

/// Snapshot values of the body, before the wheels.
pub const BODY_STATE_LEN: usize = 18;
/// Snapshot values per wheel.
pub const WHEEL_STATE_LEN: usize = 4;
/// Snapshot values of the whole four-wheel vehicle.
pub const STATE_LEN: usize =
    BODY_STATE_LEN + WHEEL_COUNT * WHEEL_STATE_LEN + crate::drivetrain::STATE_LEN;

impl Snapshottable for FourWheelVehicle {
    fn state_len(&self) -> usize {
        STATE_LEN
    }

    fn write_state(&self, out: &mut [f64]) {
        out[0] = self.time;
        out[1] = self.pos.x;
        out[2] = self.pos.y;
        out[3] = self.pos.z;
        out[4] = self.orient.x;
        out[5] = self.orient.y;
        out[6] = self.orient.z;
        out[7] = self.orient.w;
        out[8] = self.vel.x;
        out[9] = self.vel.y;
        out[10] = self.vel.z;
        out[11] = self.omega.x;
        out[12] = self.omega.y;
        out[13] = self.omega.z;
        out[14] = self.axle_fy_prev[0];
        out[15] = self.axle_fy_prev[1];
        out[16] = self.axle_fx_prev[0];
        out[17] = self.axle_fx_prev[1];
        for (i, w) in self.wheels.iter().enumerate() {
            let o = BODY_STATE_LEN + WHEEL_STATE_LEN * i;
            out[o] = w.omega;
            out[o + 1] = w.transient.slip_ratio;
            out[o + 2] = w.transient.slip_angle;
            out[o + 3] = w.spin_angle;
        }
        let o = BODY_STATE_LEN + WHEEL_STATE_LEN * WHEEL_COUNT;
        self.drivetrain
            .write_state(&mut out[o..o + crate::drivetrain::STATE_LEN]);
    }

    fn read_state(&mut self, v: &[f64]) {
        self.time = v[0];
        self.pos = Vec3::new(v[1], v[2], v[3]);
        self.orient = Quat::new(v[4], v[5], v[6], v[7]);
        self.vel = Vec3::new(v[8], v[9], v[10]);
        self.omega = Vec3::new(v[11], v[12], v[13]);
        self.axle_fy_prev = [v[14], v[15]];
        self.axle_fx_prev = [v[16], v[17]];
        for (i, w) in self.wheels.iter_mut().enumerate() {
            let o = BODY_STATE_LEN + WHEEL_STATE_LEN * i;
            w.omega = v[o];
            w.transient.slip_ratio = v[o + 1];
            w.transient.slip_angle = v[o + 2];
            w.spin_angle = v[o + 3];
        }
        let o = BODY_STATE_LEN + WHEEL_STATE_LEN * WHEEL_COUNT;
        self.drivetrain
            .read_state(&v[o..o + crate::drivetrain::STATE_LEN]);
    }
}
