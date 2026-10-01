//! Planar single-track ("bicycle") vehicle on flat ground.
//!
//! Sources: T. D. Gillespie, *Fundamentals of Vehicle Dynamics*, ch. 6;
//! R. Rajamani, *Vehicle Dynamics and Control*, ch. 2; Milliken & Milliken,
//! *Race Car Vehicle Dynamics*, ch. 5 (steady-state cornering).
//!
//! Each axle carries one tire that sees the whole axle load. Longitudinal load
//! transfer comes from the centre-of-mass height; there is no lateral load
//! transfer in a single-track model. The chassis is the proxy of ADR-0002: the
//! substep integrates velocities, the "host" (this struct) integrates the
//! pose. Since milestone 2 this is the level-of-detail model; the four-wheel
//! model in `four_wheel.rs` is the default.

use crate::definition::VehicleDefinition;
use crate::input::VehicleInput;
use crate::snapshot::Snapshottable;
use crate::telemetry as t;
use crate::tire::{
    clamp_to_friction, kinematic_slip, low_speed_fade, TireInput, TireOutput, TireTransient,
};
use crate::GRAVITY;
use skidpad_math as m;

/// Per-axle dynamic state and last outputs.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct AxleState {
    /// Wheel angular velocity, rad/s.
    pub omega: f64,
    /// Transient slip state (ADR-0005).
    pub transient: TireTransient,
    /// Wheel spin angle for rendering, rad, wrapped to (−π, π].
    pub spin_angle: f64,
    // --- derived per substep, not part of the snapshot ---
    pub load: f64,
    pub kinematic_ratio: f64,
    pub kinematic_angle: f64,
    pub out: TireOutput,
    pub drive_torque: f64,
    pub brake_torque: f64,
    pub locked: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct BicycleVehicle {
    def: VehicleDefinition,
    // Simulation state (everything in the snapshot).
    pub time: f64,
    pub x: f64,
    pub y: f64,
    pub yaw: f64,
    pub vx: f64,
    pub vy: f64,
    pub yaw_rate: f64,
    /// Longitudinal acceleration from the previous substep, used for load
    /// transfer. Lagging one substep keeps the load/force loop explicit; its
    /// gain `μ·h/L` is well below one so it converges.
    pub ax_prev: f64,
    pub axles: [AxleState; 2],
    // Derived outputs of the last substep.
    pub steer_angle: f64,
    pub long_accel: f64,
    pub lat_accel: f64,
    pub drag_force: f64,
    pub steering_torque: f64,
}

const FRONT: usize = 0;
const REAR: usize = 1;

impl BicycleVehicle {
    /// Build from a validated definition.
    pub fn new(def: VehicleDefinition) -> Self {
        let mut v = Self {
            def,
            time: 0.0,
            x: 0.0,
            y: 0.0,
            yaw: 0.0,
            vx: 0.0,
            vy: 0.0,
            yaw_rate: 0.0,
            ax_prev: 0.0,
            axles: [AxleState::default(); 2],
            steer_angle: 0.0,
            long_accel: 0.0,
            lat_accel: 0.0,
            drag_force: 0.0,
            steering_torque: 0.0,
        };
        v.compute_static_loads();
        v
    }

    pub fn definition(&self) -> &VehicleDefinition {
        &self.def
    }

    /// Replace the definition while keeping the state. Used by the live
    /// tuning editor.
    pub fn set_definition(&mut self, def: VehicleDefinition) {
        self.def = def;
    }

    fn compute_static_loads(&mut self) {
        let c = &self.def.chassis;
        let a = c.cg_to_front_axle;
        let b = self.def.cg_to_rear_axle();
        let l = c.wheelbase;
        let mg = c.mass * GRAVITY;
        self.axles[FRONT].load = mg * b / l;
        self.axles[REAR].load = mg * a / l;
    }

    /// Place the vehicle and zero its velocities and transients.
    pub fn reset(&mut self, x: f64, y: f64, yaw: f64) {
        self.time = 0.0;
        self.x = x;
        self.y = y;
        self.yaw = yaw;
        self.vx = 0.0;
        self.vy = 0.0;
        self.yaw_rate = 0.0;
        self.ax_prev = 0.0;
        for ax in &mut self.axles {
            *ax = AxleState::default();
        }
        self.compute_static_loads();
    }

    /// Set a forward speed with wheels rolling to match.
    pub fn set_speed(&mut self, vx: f64) {
        self.vx = vx;
        for (i, ax) in self.axles.iter_mut().enumerate() {
            let r = self.def.axles[i].tire.unloaded_radius();
            ax.omega = vx / r;
            ax.transient = TireTransient::default();
        }
    }

    /// Speed over ground, m/s.
    #[inline]
    pub fn speed(&self) -> f64 {
        m::hypot(self.vx, self.vy)
    }

    /// One substep of the pipeline.
    pub fn substep(&mut self, dt: f64, input: &VehicleInput) {
        let input = input.clamped();
        let c = &self.def.chassis;
        let a = c.cg_to_front_axle;
        let b = self.def.cg_to_rear_axle();
        let l = c.wheelbase;
        let mass = c.mass;
        let h = c.cg_height;

        // --- contacts: flat ground, both wheels in contact, normal +z ------
        // --- suspension: rigid in the single-track model -------------------
        // --- wheel loads: static split plus longitudinal transfer ----------
        let mg = mass * GRAVITY;
        let transfer = mass * self.ax_prev * h / l;
        self.axles[FRONT].load = m::max(mg * b / l - transfer, 0.0);
        self.axles[REAR].load = m::max(mg * a / l + transfer, 0.0);

        // --- steering ------------------------------------------------------
        // Positive input steers right (toward −y), which is a negative road
        // wheel angle about +z.
        let delta = -input.steer * self.def.max_wheel_angle();
        self.steer_angle = delta;
        let (sin_d, cos_d) = (m::sin(delta), m::cos(delta));

        // --- drivetrain solve with tire forces as boundary conditions ------
        // Milestone 1: one wheel per axle, implicit slip stiffness, brakes as
        // bounded impulse constraints. The drivetrain graph replaces this in
        // milestone 4 without changing the surrounding pipeline.
        let driven_count = self.def.axles.iter().filter(|x| x.driven).count().max(1) as f64;
        let mut body_fx = 0.0;
        let mut body_fy = 0.0;
        let mut body_mz = 0.0;

        for i in 0..2 {
            let axle_def = &self.def.axles[i];
            let tire = &axle_def.tire;
            let radius = tire.unloaded_radius();
            let floor = tire.low_speed_floor();
            let (sigma_x, sigma_y) = tire.relaxation_lengths();
            // Static camber is mirrored left to right on a real axle, so its
            // thrust cancels. The single-track tire represents both wheels and
            // therefore runs at zero camber; camber effects return with the
            // four-wheel model in milestone 2.
            let _ = axle_def.static_camber_deg;
            let camber = 0.0;

            // Contact velocity in the wheel frame.
            let (bx, by, steered) = if i == FRONT {
                (self.vx, self.vy + a * self.yaw_rate, axle_def.steered)
            } else {
                (self.vx, self.vy - b * self.yaw_rate, axle_def.steered)
            };
            let (wx, wy) = if steered {
                (bx * cos_d + by * sin_d, -bx * sin_d + by * cos_d)
            } else {
                (bx, by)
            };

            let st = &mut self.axles[i];
            // An axle is two tires sharing the load. Evaluating one tire at
            // half the axle load and doubling the result keeps per-tire
            // parameters (load sensitivity, stiffness saturation) correct and
            // lets definitions carry over unchanged to the four-wheel model.
            let fz_tire = 0.5 * st.load;

            // Kinematic slip → relaxation → tire forces.
            let (kappa, alpha) = kinematic_slip(wx, wy, st.omega, radius, floor);
            st.kinematic_ratio = kappa;
            st.kinematic_angle = alpha;
            st.transient
                .relax(kappa, alpha, wx, dt, sigma_x, sigma_y, floor);
            let mut one = tire.eval(&TireInput {
                fz: fz_tire,
                slip_ratio: st.transient.slip_ratio,
                slip_angle: st.transient.slip_angle,
                camber,
                vx: wx,
            });
            // Low-speed damping (ADR-0005), per tire, fading out at the floor.
            let fade = low_speed_fade(wx, floor);
            let k_low = tire.low_speed_damping_coefficient(fz_tire, axle_def.wheel_inertia) * fade;
            {
                let fx = one.fx + k_low * (st.omega * radius - wx);
                let fy = one.fy - k_low * wy;
                let (fx, fy) = clamp_to_friction(fx, fy, m::max(one.fx_max, one.fy_max));
                one.fx = fx;
                one.fy = fy;
            }
            let out = TireOutput {
                fx: 2.0 * one.fx,
                fy: 2.0 * one.fy,
                mz: 2.0 * one.mz,
                mx: 2.0 * one.mx,
                my: 2.0 * one.my,
                trail: one.trail,
                fx_max: 2.0 * one.fx_max,
                fy_max: 2.0 * one.fy_max,
            };
            st.out = out;

            // Drive torque with a linear fade toward the speed limit.
            let drive = if axle_def.driven {
                let fade = m::clamp(
                    1.0 - m::abs(st.omega) / self.def.drive.max_wheel_speed,
                    0.0,
                    1.0,
                );
                input.throttle * self.def.drive.max_wheel_torque / driven_count * fade
            } else {
                0.0
            };
            st.drive_torque = drive;

            // Brake capacity (service brake plus handbrake on the rear).
            let mut brake_cap = input.brake * axle_def.max_brake_torque;
            if i == REAR {
                brake_cap += input.handbrake * self.def.brakes.handbrake_torque;
            }
            st.brake_torque = brake_cap;

            // Implicit wheel spin: the tire's longitudinal stiffness is
            // treated implicitly through the fraction of a kinematic slip
            // change that reaches the transient state within this step. This
            // makes the stiff tire–wheel mode unconditionally stable
            // (ADR-0005).
            // Two wheels per axle.
            let inertia = 2.0 * axle_def.wheel_inertia;
            let v_eff = m::max(m::abs(wx), floor);
            let frac = TireTransient::response_fraction(wx, dt, sigma_x, floor);
            let dfx_domega = 2.0
                * (tire.longitudinal_stiffness(fz_tire) * radius / v_eff * frac + k_low * radius);
            let i_eff = inertia + dt * radius * dfx_domega;
            let net = drive - radius * out.fx + out.my;
            let omega_free = st.omega + dt * net / i_eff;

            // Brake as a bounded friction constraint: it can remove at most
            // `brake_cap·dt` of angular momentum this step. If that is enough
            // to stop the wheel, it stays exactly locked with no chatter.
            let impulse_cap = brake_cap * dt;
            if m::abs(omega_free) * i_eff <= impulse_cap {
                st.omega = 0.0;
                st.locked = brake_cap > 0.0;
            } else {
                st.omega = omega_free - m::signum(omega_free) * impulse_cap / i_eff;
                st.locked = false;
            }

            st.spin_angle += st.omega * dt;
            if st.spin_angle > m::PI {
                st.spin_angle -= m::TAU;
            } else if st.spin_angle < -m::PI {
                st.spin_angle += m::TAU;
            }

            // --- tire forces into the body frame -----------------------------
            let (fxb, fyb) = if steered {
                (
                    out.fx * cos_d - out.fy * sin_d,
                    out.fx * sin_d + out.fy * cos_d,
                )
            } else {
                (out.fx, out.fy)
            };
            body_fx += fxb;
            body_fy += fyb;
            body_mz += out.mz;
            if i == FRONT {
                body_mz += a * fyb;
            } else {
                body_mz -= b * fyb;
            }
        }

        // --- aero ----------------------------------------------------------
        let aero = &self.def.aero;
        let speed = self.speed();
        let q = 0.5 * aero.air_density * aero.drag_coefficient * aero.frontal_area * speed;
        self.drag_force = q * speed;
        body_fx -= q * self.vx;
        body_fy -= q * self.vy;

        // --- chassis proxy integration (semi-implicit Euler) ---------------
        let ax_body = body_fx / mass;
        let ay_body = body_fy / mass;
        let vx_old = self.vx;
        self.vx += (ax_body + self.vy * self.yaw_rate) * dt;
        self.vy += (ay_body - vx_old * self.yaw_rate) * dt;
        self.yaw_rate += body_mz / c.yaw_inertia * dt;
        self.ax_prev = ax_body;
        self.long_accel = ax_body;
        self.lat_accel = ay_body;

        // --- pose integration (the minimal host) ---------------------------
        let (sy, cy) = (m::sin(self.yaw), m::cos(self.yaw));
        self.x += (self.vx * cy - self.vy * sy) * dt;
        self.y += (self.vx * sy + self.vy * cy) * dt;
        self.yaw += self.yaw_rate * dt;
        if self.yaw > m::PI {
            self.yaw -= m::TAU;
        } else if self.yaw < -m::PI {
            self.yaw += m::TAU;
        }
        self.time += dt;

        // Steering torque at the hand wheel from the front aligning moment
        // (rack geometry and power assist arrive in milestone 5).
        self.steering_torque = -self.axles[FRONT].out.mz / self.def.steering.ratio;
    }

    /// Write the telemetry record for the current state.
    pub fn write_telemetry(&self, input: &VehicleInput, rec: &mut [f64]) {
        if rec.len() < t::STRIDE {
            return;
        }
        let f = &self.axles[FRONT];
        let r = &self.axles[REAR];
        let floor = self.def.axles[FRONT].tire.low_speed_floor();
        rec[t::TIME] = self.time;
        rec[t::POS_X] = self.x;
        rec[t::POS_Y] = self.y;
        rec[t::YAW] = self.yaw;
        rec[t::VEL_X] = self.vx;
        rec[t::VEL_Y] = self.vy;
        rec[t::YAW_RATE] = self.yaw_rate;
        rec[t::SPEED] = self.speed();
        rec[t::LONG_ACCEL] = self.long_accel;
        rec[t::LAT_ACCEL] = self.lat_accel;
        rec[t::BODY_SLIP] = m::atan2(self.vy, m::max(m::abs(self.vx), floor));
        rec[t::STEERING_WHEEL_ANGLE] = self.steer_angle * self.def.steering.ratio;
        rec[t::STEER_ANGLE] = self.steer_angle;
        rec[t::THROTTLE] = input.throttle;
        rec[t::BRAKE] = input.brake;
        rec[t::HANDBRAKE] = input.handbrake;
        rec[t::STEERING_TORQUE] = self.steering_torque;
        rec[t::DRAG_FORCE] = self.drag_force;
        rec[t::WHEEL_SPEED_F] = f.omega;
        rec[t::WHEEL_SPEED_R] = r.omega;
        rec[t::LOAD_F] = f.load;
        rec[t::LOAD_R] = r.load;
        rec[t::SLIP_RATIO_F] = f.transient.slip_ratio;
        rec[t::SLIP_RATIO_R] = r.transient.slip_ratio;
        rec[t::SLIP_ANGLE_F] = f.transient.slip_angle;
        rec[t::SLIP_ANGLE_R] = r.transient.slip_angle;
        rec[t::FX_F] = f.out.fx;
        rec[t::FX_R] = r.out.fx;
        rec[t::FY_F] = f.out.fy;
        rec[t::FY_R] = r.out.fy;
        rec[t::MZ_F] = f.out.mz;
        rec[t::MZ_R] = r.out.mz;
        rec[t::FMAX_F] = f.out.fy_max;
        rec[t::FMAX_R] = r.out.fy_max;
        rec[t::TRAIL_F] = f.out.trail;
        rec[t::TRAIL_R] = r.out.trail;
        rec[t::DRIVE_TORQUE_F] = f.drive_torque;
        rec[t::DRIVE_TORQUE_R] = r.drive_torque;
        rec[t::BRAKE_TORQUE_F] = f.brake_torque;
        rec[t::BRAKE_TORQUE_R] = r.brake_torque;
        rec[t::WHEEL_LOCKED_F] = if f.locked { 1.0 } else { 0.0 };
        rec[t::WHEEL_LOCKED_R] = if r.locked { 1.0 } else { 0.0 };
        // Out-of-plane channels: the planar model sits level at ride height.
        rec[t::POS_Z] = self.def.chassis.cg_height;
        rec[t::ROLL] = 0.0;
        rec[t::PITCH] = 0.0;
        rec[t::ROLL_RATE] = 0.0;
        rec[t::PITCH_RATE] = 0.0;
        rec[t::VEL_Z] = 0.0;
        rec[t::VERT_ACCEL] = 0.0;
        let q = crate::geom::Quat::from_yaw(self.yaw);
        rec[t::QUAT_X] = q.x;
        rec[t::QUAT_Y] = q.y;
        rec[t::QUAT_Z] = q.z;
        rec[t::QUAT_W] = q.w;
        // Per-wheel channels: each wheel of an axle carries half the axle.
        for i in 0..4 {
            let ax = &self.axles[i / 2];
            let steered = self.def.axles[i / 2].steered;
            rec[t::WHEEL_SPEED_FL + i] = ax.omega;
            rec[t::LOAD_FL + i] = 0.5 * ax.load;
            rec[t::SLIP_RATIO_FL + i] = ax.transient.slip_ratio;
            rec[t::SLIP_ANGLE_FL + i] = ax.transient.slip_angle;
            rec[t::FX_FL + i] = 0.5 * ax.out.fx;
            rec[t::FY_FL + i] = 0.5 * ax.out.fy;
            rec[t::MZ_FL + i] = 0.5 * ax.out.mz;
            rec[t::CAMBER_FL + i] = 0.0;
            rec[t::SUSP_TRAVEL_FL + i] = 0.0;
            rec[t::SUSP_RATE_FL + i] = 0.0;
            rec[t::SUSP_FORCE_FL + i] = 0.5 * ax.load;
            rec[t::WHEEL_STEER_FL + i] = if steered { self.steer_angle } else { 0.0 };
            rec[t::WHEEL_CONTACT_FL + i] = 1.0;
            rec[t::WHEEL_LOCKED_FL + i] = if ax.locked { 1.0 } else { 0.0 };
            rec[t::SPIN_ANGLE_FL + i] = ax.spin_angle;
        }
    }
}

impl Snapshottable for BicycleVehicle {
    fn state_len(&self) -> usize {
        8 + 2 * 4
    }

    fn write_state(&self, out: &mut [f64]) {
        out[0] = self.time;
        out[1] = self.x;
        out[2] = self.y;
        out[3] = self.yaw;
        out[4] = self.vx;
        out[5] = self.vy;
        out[6] = self.yaw_rate;
        out[7] = self.ax_prev;
        for (i, ax) in self.axles.iter().enumerate() {
            let o = 8 + 4 * i;
            out[o] = ax.omega;
            out[o + 1] = ax.transient.slip_ratio;
            out[o + 2] = ax.transient.slip_angle;
            out[o + 3] = ax.spin_angle;
        }
    }

    fn read_state(&mut self, v: &[f64]) {
        self.time = v[0];
        self.x = v[1];
        self.y = v[2];
        self.yaw = v[3];
        self.vx = v[4];
        self.vy = v[5];
        self.yaw_rate = v[6];
        self.ax_prev = v[7];
        for (i, ax) in self.axles.iter_mut().enumerate() {
            let o = 8 + 4 * i;
            ax.omega = v[o];
            ax.transient.slip_ratio = v[o + 1];
            ax.transient.slip_angle = v[o + 2];
            ax.spin_angle = v[o + 3];
        }
        self.compute_static_loads();
    }
}
