//! Vehicle models behind one dispatching enum. Both read the same definition
//! and write the same telemetry record; the world and the validation
//! scenarios never care which one is running.

pub mod bicycle;
pub mod four_wheel;

pub use bicycle::BicycleVehicle;
pub use four_wheel::{
    FourWheelVehicle, HostMode, WheelContact, WheelGeometry, FL, FR, RL, RR, WHEEL_COUNT,
};

use crate::definition::{VehicleDefinition, VehicleModelKind};
use crate::input::VehicleInput;
use crate::snapshot::Snapshottable;
use crate::surface::SurfaceTable;

// The four-wheel state is a few times larger than the single-track state;
// both are stepped in place inside the world's vehicle list, and boxing the
// large variant would put the hot state behind a pointer for nothing.
#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug, PartialEq)]
pub enum VehicleModel {
    SingleTrack(BicycleVehicle),
    FourWheel(FourWheelVehicle),
}

impl VehicleModel {
    /// Build the model the definition asks for.
    pub fn new(def: VehicleDefinition) -> Self {
        match def.simulation.model {
            VehicleModelKind::SingleTrack => VehicleModel::SingleTrack(BicycleVehicle::new(def)),
            VehicleModelKind::FourWheel => VehicleModel::FourWheel(FourWheelVehicle::new(def)),
        }
    }

    /// Number of snapshot values of a model kind; the snapshot of each
    /// kind has its own fixed length.
    pub fn state_len_of(kind: VehicleModelKind) -> usize {
        match kind {
            VehicleModelKind::SingleTrack => bicycle::STATE_LEN,
            VehicleModelKind::FourWheel => four_wheel::STATE_LEN,
        }
    }

    /// Rebuild the vehicle as the other model, carrying its motion over
    /// (ADR-0019): planar pose and velocity, yaw rate, wheel speeds and
    /// transient slips (an axle's mean on the way down to the single-track
    /// model; each wheel's share of the yaw rate on the way up), the
    /// drivetrain state, the clock, the built-in surface id and the ground
    /// slope. Going up, the body starts level at ride height and settles
    /// into its roll and pitch over the next few hundred milliseconds.
    /// `def` is the definition to build from; its `simulation.model` is
    /// overridden by `kind`. Does nothing if the vehicle already is `kind`.
    pub fn convert_to(&mut self, kind: VehicleModelKind, def: &VehicleDefinition) {
        if kind == self.kind() {
            return;
        }
        let mut def = def.clone();
        def.simulation.model = kind;
        let mut dt_state = [0.0; crate::drivetrain::STATE_LEN];
        let fresh = match self {
            VehicleModel::FourWheel(f) => {
                f.drivetrain.write_state(&mut dt_state);
                let mut b = BicycleVehicle::new(def);
                b.set_surface(f.builtin_surface_id);
                b.set_ground_slope(f.ground_slope[0], f.ground_slope[1]);
                let (yaw, _, _) = f.orient.to_yaw_pitch_roll();
                b.reset(f.pos.x, f.pos.y, yaw);
                b.time = f.time;
                let (sy, cy) = (skidpad_math::sin(yaw), skidpad_math::cos(yaw));
                b.vx = f.vel.x * cy + f.vel.y * sy;
                b.vy = -f.vel.x * sy + f.vel.y * cy;
                b.yaw_rate = f.omega.z;
                b.ax_prev = f.accel_body.x;
                for (a, ax) in b.axles.iter_mut().enumerate() {
                    let (l, r) = (&f.wheels[2 * a], &f.wheels[2 * a + 1]);
                    ax.omega = 0.5 * (l.omega + r.omega);
                    ax.transient.slip_ratio =
                        0.5 * (l.transient.slip_ratio + r.transient.slip_ratio);
                    ax.transient.slip_angle =
                        0.5 * (l.transient.slip_angle + r.transient.slip_angle);
                    ax.spin_angle = l.spin_angle;
                }
                b.drivetrain.read_state(&dt_state);
                VehicleModel::SingleTrack(b)
            }
            VehicleModel::SingleTrack(b) => {
                b.drivetrain.write_state(&mut dt_state);
                let mut f = FourWheelVehicle::new(def);
                f.set_surface(b.surface_id);
                f.set_ground_slope(b.ground_slope[0], b.ground_slope[1]);
                f.reset(b.x, b.y, b.yaw);
                f.time = b.time;
                let (sy, cy) = (skidpad_math::sin(b.yaw), skidpad_math::cos(b.yaw));
                f.vel = crate::geom::Vec3::new(b.vx * cy - b.vy * sy, b.vx * sy + b.vy * cy, 0.0);
                f.omega = crate::geom::Vec3::new(0.0, 0.0, b.yaw_rate);
                let geometry = *f.geometry();
                let half_tracks = [
                    0.5 * f.definition().axle_track(0),
                    0.5 * f.definition().axle_track(1),
                ];
                for (i, w) in f.wheels.iter_mut().enumerate() {
                    let ax = &b.axles[i / 2];
                    let g = geometry[i];
                    let half_track = half_tracks[i / 2];
                    // A left wheel (side +1) runs slower than the axle centre
                    // by the yaw rate times its half track.
                    w.omega = ax.omega - g.side * b.yaw_rate * half_track / g.radius;
                    w.transient = ax.transient;
                    w.spin_angle = ax.spin_angle;
                }
                f.drivetrain.read_state(&dt_state);
                VehicleModel::FourWheel(f)
            }
        };
        *self = fresh;
    }

    pub fn kind(&self) -> VehicleModelKind {
        match self {
            VehicleModel::SingleTrack(_) => VehicleModelKind::SingleTrack,
            VehicleModel::FourWheel(_) => VehicleModelKind::FourWheel,
        }
    }

    pub fn definition(&self) -> &VehicleDefinition {
        match self {
            VehicleModel::SingleTrack(v) => v.definition(),
            VehicleModel::FourWheel(v) => v.definition(),
        }
    }

    /// Replace the definition in place. If the definition asks for a
    /// different model the vehicle is rebuilt at its current position and
    /// heading, at rest.
    pub fn set_definition(&mut self, def: VehicleDefinition) {
        if def.simulation.model != self.kind() {
            let (x, y, yaw) = self.pose2d();
            let mut fresh = VehicleModel::new(def);
            fresh.reset(x, y, yaw);
            *self = fresh;
            return;
        }
        match self {
            VehicleModel::SingleTrack(v) => v.set_definition(def),
            VehicleModel::FourWheel(v) => v.set_definition(def),
        }
    }

    /// One substep on the reference surface.
    #[inline]
    pub fn substep(&mut self, dt: f64, input: &VehicleInput) {
        self.substep_on(dt, input, &SurfaceTable::REFERENCE);
    }

    /// One substep with the contacts' surface ids looked up in `surfaces`.
    #[inline]
    pub fn substep_on(&mut self, dt: f64, input: &VehicleInput, surfaces: &SurfaceTable) {
        match self {
            VehicleModel::SingleTrack(v) => v.substep_on(dt, input, surfaces),
            VehicleModel::FourWheel(v) => v.substep_on(dt, input, surfaces),
        }
    }

    /// Surface id of the built-in flat ground (ADR-0014). An external host
    /// tags each contact itself and ignores this.
    pub fn set_surface(&mut self, id: u32) {
        match self {
            VehicleModel::SingleTrack(v) => v.set_surface(id),
            VehicleModel::FourWheel(v) => v.set_surface(id),
        }
    }

    pub fn write_telemetry(&self, input: &VehicleInput, rec: &mut [f64]) {
        match self {
            VehicleModel::SingleTrack(v) => v.write_telemetry(input, rec),
            VehicleModel::FourWheel(v) => v.write_telemetry(input, rec),
        }
    }

    pub fn reset(&mut self, x: f64, y: f64, yaw: f64) {
        match self {
            VehicleModel::SingleTrack(v) => v.reset(x, y, yaw),
            VehicleModel::FourWheel(v) => v.reset(x, y, yaw),
        }
    }

    pub fn set_speed(&mut self, vx: f64) {
        match self {
            VehicleModel::SingleTrack(v) => v.set_speed(vx),
            VehicleModel::FourWheel(v) => v.set_speed(vx),
        }
    }

    /// Ground slope of the built-in flat world: rise per metre along world
    /// +x (grade) and +y (cross slope). Ignored by an external host.
    pub fn set_ground_slope(&mut self, grade: f64, cross: f64) {
        match self {
            VehicleModel::SingleTrack(v) => v.set_ground_slope(grade, cross),
            VehicleModel::FourWheel(v) => v.set_ground_slope(grade, cross),
        }
    }

    /// Planar velocity in the world frame, m/s.
    pub fn planar_velocity(&self) -> (f64, f64) {
        match self {
            VehicleModel::SingleTrack(v) => {
                let (sy, cy) = (skidpad_math::sin(v.yaw), skidpad_math::cos(v.yaw));
                (v.vx * cy - v.vy * sy, v.vx * sy + v.vy * cy)
            }
            VehicleModel::FourWheel(v) => (v.vel.x, v.vel.y),
        }
    }

    pub fn set_yaw_rate(&mut self, r: f64) {
        match self {
            VehicleModel::SingleTrack(v) => v.yaw_rate = r,
            VehicleModel::FourWheel(v) => v.omega.z = r,
        }
    }

    /// Planar pose `(x, y, yaw)`.
    pub fn pose2d(&self) -> (f64, f64, f64) {
        match self {
            VehicleModel::SingleTrack(v) => (v.x, v.y, v.yaw),
            VehicleModel::FourWheel(v) => {
                let (yaw, _, _) = v.orient.to_yaw_pitch_roll();
                (v.pos.x, v.pos.y, yaw)
            }
        }
    }

    pub fn time(&self) -> f64 {
        match self {
            VehicleModel::SingleTrack(v) => v.time,
            VehicleModel::FourWheel(v) => v.time,
        }
    }

    /// Forward speed in the body frame, m/s.
    pub fn vx(&self) -> f64 {
        match self {
            VehicleModel::SingleTrack(v) => v.vx,
            VehicleModel::FourWheel(v) => v.vx(),
        }
    }

    pub fn speed(&self) -> f64 {
        match self {
            VehicleModel::SingleTrack(v) => v.speed(),
            VehicleModel::FourWheel(v) => v.speed(),
        }
    }

    pub fn yaw_rate(&self) -> f64 {
        match self {
            VehicleModel::SingleTrack(v) => v.yaw_rate,
            VehicleModel::FourWheel(v) => v.yaw_rate(),
        }
    }

    /// Body-frame lateral acceleration from forces other than gravity, m/s²
    /// (what an accelerometer on the body reads).
    pub fn lat_accel(&self) -> f64 {
        match self {
            VehicleModel::SingleTrack(v) => v.lat_accel,
            VehicleModel::FourWheel(v) => v.accel_body.y,
        }
    }

    /// Reference road-wheel steer angle, rad.
    pub fn steer_angle(&self) -> f64 {
        match self {
            VehicleModel::SingleTrack(v) => v.steer_angle,
            VehicleModel::FourWheel(v) => v.steer_angle,
        }
    }

    /// Mean transient slip angle of an axle (0 front, 1 rear), rad.
    pub fn axle_slip_angle(&self, axle: usize) -> f64 {
        match self {
            VehicleModel::SingleTrack(v) => v.axles[axle].transient.slip_angle,
            VehicleModel::FourWheel(v) => {
                0.5 * (v.wheels[2 * axle].transient.slip_angle
                    + v.wheels[2 * axle + 1].transient.slip_angle)
            }
        }
    }

    /// Whether any wheel of the axle is locked by its brakes.
    pub fn axle_locked(&self, axle: usize) -> bool {
        match self {
            VehicleModel::SingleTrack(v) => v.axles[axle].locked,
            VehicleModel::FourWheel(v) => {
                v.wheels[2 * axle].locked || v.wheels[2 * axle + 1].locked
            }
        }
    }

    /// Bit mask of the wheels currently held by their brakes: bits 0 and 1
    /// for the single-track axles, bits 0 to 3 in `FL, FR, RL, RR` order for
    /// the four-wheel model. Validation counts its transitions to detect
    /// lock chatter.
    pub fn locked_mask(&self) -> u32 {
        match self {
            VehicleModel::SingleTrack(v) => {
                (v.axles[0].locked as u32) | ((v.axles[1].locked as u32) << 1)
            }
            VehicleModel::FourWheel(v) => {
                let mut mask = 0;
                for (i, w) in v.wheels.iter().enumerate() {
                    mask |= (w.locked as u32) << i;
                }
                mask
            }
        }
    }

    pub fn as_four_wheel(&self) -> Option<&FourWheelVehicle> {
        match self {
            VehicleModel::FourWheel(v) => Some(v),
            VehicleModel::SingleTrack(_) => None,
        }
    }

    pub fn as_four_wheel_mut(&mut self) -> Option<&mut FourWheelVehicle> {
        match self {
            VehicleModel::FourWheel(v) => Some(v),
            VehicleModel::SingleTrack(_) => None,
        }
    }
}

impl Snapshottable for VehicleModel {
    fn state_len(&self) -> usize {
        match self {
            VehicleModel::SingleTrack(v) => v.state_len(),
            VehicleModel::FourWheel(v) => v.state_len(),
        }
    }

    fn write_state(&self, out: &mut [f64]) {
        match self {
            VehicleModel::SingleTrack(v) => v.write_state(out),
            VehicleModel::FourWheel(v) => v.write_state(out),
        }
    }

    fn read_state(&mut self, values: &[f64]) {
        match self {
            VehicleModel::SingleTrack(v) => v.read_state(values),
            VehicleModel::FourWheel(v) => v.read_state(values),
        }
    }
}
