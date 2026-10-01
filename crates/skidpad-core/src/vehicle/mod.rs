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

    #[inline]
    pub fn substep(&mut self, dt: f64, input: &VehicleInput) {
        match self {
            VehicleModel::SingleTrack(v) => v.substep(dt, input),
            VehicleModel::FourWheel(v) => v.substep(dt, input),
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
