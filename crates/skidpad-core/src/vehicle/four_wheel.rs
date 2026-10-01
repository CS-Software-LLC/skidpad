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

use crate::definition::VehicleDefinition;
use crate::geom::{Quat, Vec3};
use crate::input::VehicleInput;
use crate::snapshot::Snapshottable;
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
    pub steering_torque: f64,
}

impl FourWheelVehicle {
    pub fn new(def: VehicleDefinition) -> Self {
        let mut v = Self {
            geometry: [WheelGeometry::default(); WHEEL_COUNT],
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
        };
        v.compute_geometry();
        v.reset(0.0, 0.0, 0.0);
        v
    }

    pub fn definition(&self) -> &VehicleDefinition {
        &self.def
    }

    /// Replace the definition while keeping the state (live tuning).
    pub fn set_definition(&mut self, def: VehicleDefinition) {
        self.def = def;
        self.compute_geometry();
    }

    pub fn geometry(&self) -> &[WheelGeometry; WHEEL_COUNT] {
        &self.geometry
    }

    fn compute_geometry(&mut self) {
        let c = &self.def.chassis;
        let half_track = 0.5 * c.track_width;
        for i in 0..WHEEL_COUNT {
            let axle = i / 2;
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
        self.steer_angle = 0.0;
        for (i, w) in self.wheels.iter_mut().enumerate() {
            let g = self.geometry[i];
            *w = WheelState {
                in_contact: true,
                load: g.static_load,
                susp_force: g.static_load,
                ..WheelState::default()
            };
        }
        if self.host_mode == HostMode::Builtin {
            self.contacts = [WheelContact::flat_ground(); WHEEL_COUNT];
        }
    }

    /// Set a forward speed with the wheels rolling to match.
    pub fn set_speed(&mut self, vx: f64) {
        self.vel = self.orient.rotate(Vec3::new(vx, 0.0, 0.0));
        for (i, w) in self.wheels.iter_mut().enumerate() {
            w.omega = vx / self.geometry[i].radius;
            w.transient = TireTransient::default();
        }
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
        let half = 0.5 * self.def.chassis.track_width;
        let td = m::tan(delta);
        let denom = m::max(l - self.geometry[i].side * half * td, 0.1 * l);
        let ideal = m::atan(l * td / denom);
        delta + ack * (ideal - delta)
    }

    /// One substep of the pipeline.
    pub fn substep(&mut self, dt: f64, input: &VehicleInput) {
        let input = input.clamped();
        let mass = self.def.chassis.mass;
        let orient = self.orient;
        let omega_world = orient.rotate(self.omega);
        let down = orient.rotate(Vec3::new(0.0, 0.0, -1.0));

        // --- steering ----------------------------------------------------
        // Positive input steers right (toward −y): a negative angle about +z.
        let delta = -input.steer * self.def.max_wheel_angle();
        self.steer_angle = delta;
        let steers = [
            self.wheel_steer(FL, delta),
            self.wheel_steer(FR, delta),
            self.wheel_steer(RL, delta),
            self.wheel_steer(RR, delta),
        ];

        // --- contacts: ray from the top of travel to the contact plane ------
        // --- suspension travel and rate ---------------------------------------
        for (i, &steer) in steers.iter().enumerate() {
            let g = self.geometry[i];
            let c = self.contacts[i];
            let origin = self.pos + orient.rotate(g.ray_origin);
            let w = &mut self.wheels[i];
            w.steer = steer;
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
            match hit_t {
                Some(tt) if tt <= g.ray_length => {
                    w.in_contact = true;
                    // At the static position the hit is one bump travel plus
                    // one radius down the ray; shorter hits are compression.
                    w.travel = g.ray_length - self.def.axles[i / 2].suspension.travel_droop - tt;
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
            let f = n * w.load;
            force = force + f;
            torque = torque + (w.contact_point - self.pos).cross(f);
        }

        // --- drivetrain solve with tire forces as boundary conditions -------
        // Interim: equal torque to every driven wheel (an open differential
        // with no inertia). The drivetrain graph replaces this in milestone 4.
        let driven_wheels = 2.0 * self.def.axles.iter().filter(|a| a.driven).count().max(1) as f64;
        for i in 0..WHEEL_COUNT {
            let axle = i / 2;
            let adef = &self.def.axles[axle];
            let tire = &adef.tire;
            let g = self.geometry[i];
            let radius = g.radius;
            let floor = tire.low_speed_floor();
            let (sigma_x, sigma_y) = tire.relaxation_lengths();
            let c = self.contacts[i];
            let w = &mut self.wheels[i];

            // Wheel axes at the contact: lateral axis from the steer angle,
            // forward and lateral in the contact plane from the normal.
            let (sd, cd) = (m::sin(w.steer), m::cos(w.steer));
            let y_w = orient.rotate(Vec3::new(-sd, cd, 0.0));
            let n = c.normal;
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
            w.transient
                .relax(kappa, alpha, wx, dt, sigma_x, sigma_y, floor);
            // Low-speed damping (ADR-0005): a viscous term on the contact
            // slip velocities that fades out at the speed floor, with its
            // longitudinal part treated implicitly in the wheel equation.
            let fade = low_speed_fade(wx, floor);
            let k_low = if fade > 0.0 && w.in_contact {
                tire.low_speed_damping_coefficient(w.load, adef.wheel_inertia) * fade
            } else {
                0.0
            };
            let out = if w.in_contact && w.load > 0.0 {
                let mut o = tire.eval(&TireInput {
                    fz: w.load,
                    slip_ratio: w.transient.slip_ratio,
                    slip_angle: w.transient.slip_angle,
                    camber: w.camber,
                    vx: wx,
                });
                let fx = o.fx + k_low * (w.omega * radius - wx);
                let fy = o.fy - k_low * wy;
                let (fx, fy) = clamp_to_friction(fx, fy, m::max(o.fx_max, o.fy_max));
                o.fx = fx;
                o.fy = fy;
                o
            } else {
                TireOutput::default()
            };
            w.out = out;

            let drive = if adef.driven {
                let fade = m::clamp(
                    1.0 - m::abs(w.omega) / self.def.drive.max_wheel_speed,
                    0.0,
                    1.0,
                );
                input.throttle * self.def.drive.max_wheel_torque / driven_wheels * fade
            } else {
                0.0
            };
            w.drive_torque = drive;
            let mut brake_cap = 0.5 * input.brake * adef.max_brake_torque;
            if axle == 1 {
                brake_cap += 0.5 * input.handbrake * self.def.brakes.handbrake_torque;
            }
            w.brake_torque = brake_cap;

            // Implicit wheel spin (ADR-0005), one wheel.
            let inertia = adef.wheel_inertia;
            let v_eff = m::max(m::abs(wx), floor);
            let frac = TireTransient::response_fraction(wx, dt, sigma_x, floor);
            let dfx_domega =
                tire.longitudinal_stiffness(w.load) * radius / v_eff * frac + k_low * radius;
            let i_eff = inertia + dt * radius * dfx_domega;
            let net = drive - radius * out.fx + out.my;
            let omega_free = w.omega + dt * net / i_eff;
            let impulse_cap = brake_cap * dt;
            if m::abs(omega_free) * i_eff <= impulse_cap {
                w.omega = 0.0;
                w.locked = brake_cap > 0.0;
            } else {
                w.omega = omega_free - m::signum(omega_free) * impulse_cap / i_eff;
                w.locked = false;
            }
            w.spin_angle += w.omega * dt;
            if w.spin_angle > m::PI {
                w.spin_angle -= m::TAU;
            } else if w.spin_angle < -m::PI {
                w.spin_angle += m::TAU;
            }

            // --- tire forces into the world frame at the contact point ------
            if w.in_contact {
                let f = fwd * out.fx + lat * out.fy;
                force = force + f;
                torque = torque + (w.contact_point - self.pos).cross(f) + n * out.mz;
            }
        }

        // --- aero --------------------------------------------------------------
        let aero = &self.def.aero;
        let speed = self.vel.length();
        let q = 0.5 * aero.air_density * aero.drag_coefficient * aero.frontal_area * speed;
        self.drag_force = q * speed;
        force = force - self.vel * q;

        // --- chassis proxy integration (semi-implicit Euler) ------------------
        self.impulse = self.impulse + force * dt;
        self.angular_impulse = self.angular_impulse + torque * dt;
        let accel = force * (1.0 / mass);
        self.accel_body = orient.inverse_rotate(accel);
        let gravity = Vec3::new(0.0, 0.0, -GRAVITY);
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

        // Steering torque at the hand wheel from the front aligning moments
        // (rack geometry and power assist arrive in milestone 5).
        self.steering_torque =
            -(self.wheels[FL].out.mz + self.wheels[FR].out.mz) / self.def.steering.ratio;
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
        }
    }
}

const BODY_STATE_LEN: usize = 14;
const WHEEL_STATE_LEN: usize = 4;

impl Snapshottable for FourWheelVehicle {
    fn state_len(&self) -> usize {
        BODY_STATE_LEN + WHEEL_COUNT * WHEEL_STATE_LEN
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
        for (i, w) in self.wheels.iter().enumerate() {
            let o = BODY_STATE_LEN + WHEEL_STATE_LEN * i;
            out[o] = w.omega;
            out[o + 1] = w.transient.slip_ratio;
            out[o + 2] = w.transient.slip_angle;
            out[o + 3] = w.spin_angle;
        }
    }

    fn read_state(&mut self, v: &[f64]) {
        self.time = v[0];
        self.pos = Vec3::new(v[1], v[2], v[3]);
        self.orient = Quat::new(v[4], v[5], v[6], v[7]);
        self.vel = Vec3::new(v[8], v[9], v[10]);
        self.omega = Vec3::new(v[11], v[12], v[13]);
        for (i, w) in self.wheels.iter_mut().enumerate() {
            let o = BODY_STATE_LEN + WHEEL_STATE_LEN * i;
            w.omega = v[o];
            w.transient.slip_ratio = v[o + 1];
            w.transient.slip_angle = v[o + 2];
            w.spin_angle = v[o + 3];
        }
    }
}
