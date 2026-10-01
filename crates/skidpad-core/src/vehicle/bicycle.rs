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
use crate::drivetrain::{Drivetrain, WheelDyn};
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
    /// Power unit, clutch, gearbox and centre differential (ADR-0011); one
    /// wheel per axle, so the axle differentials do not apply.
    pub drivetrain: Drivetrain,
    // Derived outputs of the last substep.
    pub steer_angle: f64,
    pub long_accel: f64,
    pub lat_accel: f64,
    pub drag_force: f64,
    pub steering_torque: f64,
    /// Ground slope under the built-in host as the rise per metre along
    /// world +x (grade) and world +y (cross slope). Not part of the
    /// definition or the snapshot: it is the environment, set by the
    /// scenario or the application. See `set_ground_slope`.
    pub ground_slope: [f64; 2],
}

const FRONT: usize = 0;
const REAR: usize = 1;

impl BicycleVehicle {
    /// Build from a validated definition.
    pub fn new(def: VehicleDefinition) -> Self {
        let drivetrain = Drivetrain::new(def.drivetrain.clone(), def.driven_axles(), 2);
        let mut v = Self {
            drivetrain,
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
            ground_slope: [0.0, 0.0],
        };
        v.compute_static_loads();
        v
    }

    /// Set the ground slope of the built-in flat world as the rise per
    /// metre along world +x (`grade`, 0.1 for a 10 % grade) and world +y
    /// (`cross`). Gravity then has a component along the ground, and the
    /// wheel loads carry `cos θ` of the weight. A car heading +x faces
    /// uphill on a positive grade.
    pub fn set_ground_slope(&mut self, grade: f64, cross: f64) {
        self.ground_slope = [grade, cross];
        self.compute_static_loads();
    }

    /// `cos θ` of the ground slope and the along-ground gravity in the
    /// world frame, m/s². With the plane normal `n = (−gx, −gy, 1) / N`,
    /// `N² = 1 + gx² + gy²`, gravity projected onto the plane is
    /// `g (−gx, −gy, −(gx² + gy²)) / N²`; its planar part is used here.
    fn slope_terms(&self) -> (f64, f64, f64) {
        let [gx, gy] = self.ground_slope;
        let n2 = 1.0 + gx * gx + gy * gy;
        let cos_theta = 1.0 / m::sqrt(n2);
        (cos_theta, -GRAVITY * gx / n2, -GRAVITY * gy / n2)
    }

    pub fn definition(&self) -> &VehicleDefinition {
        &self.def
    }

    /// Replace the definition while keeping the state. Used by the live
    /// tuning editor.
    pub fn set_definition(&mut self, def: VehicleDefinition) {
        self.drivetrain
            .set_definition(def.drivetrain.clone(), def.driven_axles());
        self.def = def;
    }

    fn compute_static_loads(&mut self) {
        let c = &self.def.chassis;
        let a = c.cg_to_front_axle;
        let b = self.def.cg_to_rear_axle();
        let l = c.wheelbase;
        let (cos_theta, _, _) = self.slope_terms();
        let mg = c.mass * GRAVITY * cos_theta;
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
        self.drivetrain.reset();
    }

    /// Set a forward speed with wheels rolling to match.
    pub fn set_speed(&mut self, vx: f64) {
        self.vx = vx;
        for (i, ax) in self.axles.iter_mut().enumerate() {
            let r = self.def.axles[i].tire.unloaded_radius();
            ax.omega = vx / r;
            ax.transient = TireTransient::default();
        }
        let driven = self.def.driven_axles();
        let mut carrier = 0.0;
        let mut n = 0.0;
        for (i, ax) in self.axles.iter().enumerate() {
            if driven[i] {
                carrier += ax.omega;
                n += 1.0;
            }
        }
        self.drivetrain
            .match_speed(if n > 0.0 { carrier / n } else { 0.0 });
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
        // On a slope the weight on the wheels is `m g cos θ`, and the
        // transfer follows the ground-plane forces on the body (tire and
        // aero), which is what `ax_prev` holds: at rest on a grade the
        // tires push the car uphill and that force at ground level moves
        // load to the downhill axle, the same as accelerating uphill
        // (Gillespie ch. 1, loads on a grade).
        let (cos_theta, grav_x_world, grav_y_world) = self.slope_terms();
        let mg = mass * GRAVITY * cos_theta;
        let transfer = mass * self.ax_prev * h / l;
        self.axles[FRONT].load = m::max(mg * b / l - transfer, 0.0);
        self.axles[REAR].load = m::max(mg * a / l + transfer, 0.0);

        // --- steering ------------------------------------------------------
        // Positive input steers right (toward −y), which is a negative road
        // wheel angle about +z.
        let delta = -input.steer * self.def.max_wheel_angle();
        self.steer_angle = delta;
        let (sin_d, cos_d) = (m::sin(delta), m::cos(delta));

        // --- tires, then the drivetrain solve (ADR-0011) --------------------
        // One wheel per axle, representing the pair; tire forces are the
        // boundary torques of the drivetrain system and the implicit tire
        // stiffness goes into the axle's effective inertia (ADR-0010).
        let mut body_fx = 0.0;
        let mut body_fy = 0.0;
        let mut body_mz = 0.0;
        let mut dyn_wheels = [WheelDyn::default(); 2];
        let mut outs = [TireOutput::default(); 2];

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

            // Kinematic slip (telemetry and the standstill bound), then the
            // contact-patch deflection transient (ADR-0010), then the tire.
            let (kappa, alpha) = kinematic_slip(wx, wy, st.omega, radius, floor);
            st.kinematic_ratio = kappa;
            st.kinematic_angle = alpha;
            let (kappa_peak, tan_alpha_peak) = tire.static_slip_bounds();
            let slip_vx = st.omega * radius - wx;
            st.transient.update(
                slip_vx,
                wy,
                wx,
                dt,
                sigma_x,
                sigma_y,
                m::max(kappa_peak, m::abs(kappa)),
                m::max(tan_alpha_peak, m::abs(wy) / m::max(m::abs(wx), floor)),
            );
            let mut one = tire.eval(&TireInput {
                fz: fz_tire,
                slip_ratio: st.transient.slip_ratio,
                slip_angle: st.transient.slip_angle,
                camber,
                vx: wx,
            });
            // Low-speed damping on the contact slip velocities (ADR-0010),
            // per tire, faded out with rolling speed. The total, curve plus
            // damping, is bounded by what the curve allows: the peak while
            // the spring is below it, the sliding force once past it.
            let fade = low_speed_fade(wx, tire.low_speed_damping_fade());
            let (c_x, c_y) = if fade > 0.0 {
                let (cx, cy) = tire.low_speed_damping_coefficients(fz_tire, dt);
                (cx * fade, cy * fade)
            } else {
                (0.0, 0.0)
            };
            {
                let fx = one.fx + c_x * slip_vx;
                let fy = one.fy - c_y * wy;
                let bound = m::max(m::hypot(one.fx, one.fy), m::max(one.fx_slide, one.fy_slide));
                let (fx, fy) = clamp_to_friction(fx, fy, bound);
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
                fx_slide: 2.0 * one.fx_slide,
                fy_slide: 2.0 * one.fy_slide,
            };
            st.out = out;
            outs[i] = out;

            // Brake capacity (service brake plus handbrake on the rear).
            let mut brake_cap = input.brake * axle_def.max_brake_torque;
            if i == REAR {
                brake_cap += input.handbrake * self.def.brakes.handbrake_torque;
            }
            st.brake_torque = brake_cap;

            // Implicit wheel spin (ADR-0005 item 3, re-derived in ADR-0010):
            // the tire force's sensitivity to wheel speed within one step is
            // `Cκ·R·dt / (σx + dt·|Vx|)` from the deflection update plus
            // `c_x·R` from the damping, and both go into the effective
            // inertia so the stiff wheel–tire mode is unconditionally
            // stable. The stiffness is the slope at the origin, an upper
            // bound at large slip. Two wheels per axle.
            let gain = TireTransient::deflection_gain(wx, dt, sigma_x);
            let dfx_domega =
                2.0 * (tire.longitudinal_stiffness(fz_tire) * radius * gain + c_x * radius);
            dyn_wheels[i] = WheelDyn {
                omega: st.omega,
                inertia: 2.0 * axle_def.wheel_inertia + dt * radius * dfx_domega,
                torque: -radius * out.fx + out.my,
                brake_capacity: brake_cap,
                axle: i,
                ..WheelDyn::default()
            };
        }

        self.drivetrain.step(dt, &input, &mut dyn_wheels);

        for i in 0..2 {
            let d = dyn_wheels[i];
            let st = &mut self.axles[i];
            st.omega = d.omega;
            st.locked = d.locked;
            st.drive_torque = d.shaft_torque;
            st.spin_angle += st.omega * dt;
            if st.spin_angle > m::PI {
                st.spin_angle -= m::TAU;
            } else if st.spin_angle < -m::PI {
                st.spin_angle += m::TAU;
            }

            // --- tire forces into the body frame -----------------------------
            let out = outs[i];
            let steered = self.def.axles[i].steered;
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
        // `ax_body`, `ay_body` are the accelerations from forces other than
        // gravity (what an accelerometer reads); gravity along the ground is
        // added to the velocity update separately.
        let ax_body = body_fx / mass;
        let ay_body = body_fy / mass;
        let (sy0, cy0) = (m::sin(self.yaw), m::cos(self.yaw));
        let grav_x = grav_x_world * cy0 + grav_y_world * sy0;
        let grav_y = -grav_x_world * sy0 + grav_y_world * cy0;
        let vx_old = self.vx;
        self.vx += (ax_body + grav_x + self.vy * self.yaw_rate) * dt;
        self.vy += (ay_body + grav_y - vx_old * self.yaw_rate) * dt;
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
        super::four_wheel::write_drivetrain_telemetry(&self.drivetrain, input, rec);
    }
}

const BICYCLE_STATE_LEN: usize = 8 + 2 * 4;

impl Snapshottable for BicycleVehicle {
    fn state_len(&self) -> usize {
        BICYCLE_STATE_LEN + crate::drivetrain::STATE_LEN
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
        self.drivetrain.write_state(
            &mut out[BICYCLE_STATE_LEN..BICYCLE_STATE_LEN + crate::drivetrain::STATE_LEN],
        );
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
        self.drivetrain
            .read_state(&v[BICYCLE_STATE_LEN..BICYCLE_STATE_LEN + crate::drivetrain::STATE_LEN]);
        self.compute_static_loads();
    }
}
