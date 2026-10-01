//! A world holds many vehicles and steps them in one batched call. All
//! per-vehicle inputs and telemetry live in flat `f64` buffers so the WASM
//! layer can expose them as typed-array views with no copying.

use crate::definition::VehicleDefinition;
use crate::geom::{Quat, Vec3};
use crate::input::VehicleInput;
use crate::snapshot::{SnapshotError, Snapshottable};
use crate::surface::{Surface, SurfaceTable};
use crate::telemetry;
use crate::vehicle::{HostMode, VehicleModel, WheelContact, WHEEL_COUNT};
use skidpad_math as m;

/// Largest state any vehicle type can have, in `f64` values.
pub const MAX_STATE_LEN: usize = 256;

/// Host-sync input record, one per vehicle (external host mode, ADR-0002):
/// `[pos xyz, quat xyzw, linear velocity xyz, angular velocity xyz (world)]`
/// followed by [`HOST_CONTACT_STRIDE`] values per wheel.
pub const HOST_IN_BODY_LEN: usize = 13;
/// Per-wheel contact record inside the host-sync input:
/// `[hit, point xyz, normal xyz, surface velocity xyz, surface id]`.
pub const HOST_CONTACT_STRIDE: usize = 11;
pub const HOST_IN_STRIDE: usize = HOST_IN_BODY_LEN + WHEEL_COUNT * HOST_CONTACT_STRIDE;
/// Host-sync output record, one per vehicle: `[impulse xyz, angular impulse
/// xyz]` (world frame, over the last host step) followed by
/// `[hub xyz, contact xyz]` per wheel in world coordinates.
pub const HOST_OUT_BODY_LEN: usize = 6;
pub const HOST_OUT_WHEEL_STRIDE: usize = 6;
pub const HOST_OUT_STRIDE: usize = HOST_OUT_BODY_LEN + WHEEL_COUNT * HOST_OUT_WHEEL_STRIDE;
/// Wheel ray record: `[origin xyz, direction xyz, length, radius]`, body
/// frame.
pub const WHEEL_RAY_STRIDE: usize = 8;

#[derive(Clone, Debug, PartialEq)]
pub struct Vehicle {
    pub model: VehicleModel,
    pub substep_rate_hz: f64,
}

#[derive(Clone, Debug)]
pub struct World {
    capacity: usize,
    vehicles: Vec<Vehicle>,
    inputs: Vec<f64>,
    telemetry: Vec<f64>,
    host_in: Vec<f64>,
    host_out: Vec<f64>,
    scratch: Vec<f64>,
    /// What each contact surface id means (ADR-0014).
    surfaces: SurfaceTable,
    /// Number of host steps taken.
    pub step_count: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WorldError {
    Full {
        capacity: usize,
    },
    Invalid(Vec<String>),
    NoSuchVehicle(usize),
    Snapshot(SnapshotError),
    /// The operation needs the four-wheel model.
    WrongModel(usize),
}

impl core::fmt::Display for WorldError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            WorldError::Full { capacity } => write!(f, "world is full ({capacity} vehicles)"),
            WorldError::Invalid(errs) => {
                write!(f, "invalid vehicle definition: {}", errs.join("; "))
            }
            WorldError::NoSuchVehicle(i) => write!(f, "no vehicle at index {i}"),
            WorldError::Snapshot(e) => write!(f, "snapshot error: {e}"),
            WorldError::WrongModel(i) => write!(
                f,
                "vehicle {i} runs the single-track model; host sync needs simulation.model = \"fourWheel\""
            ),
        }
    }
}

impl World {
    /// Create a world with room for `capacity` vehicles. All buffers are
    /// allocated here; nothing allocates during `step`.
    pub fn new(capacity: usize) -> Self {
        let capacity = capacity.max(1);
        Self {
            capacity,
            vehicles: Vec::with_capacity(capacity),
            inputs: vec![0.0; capacity * VehicleInput::STRIDE],
            telemetry: vec![0.0; capacity * telemetry::STRIDE],
            host_in: vec![0.0; capacity * HOST_IN_STRIDE],
            host_out: vec![0.0; capacity * HOST_OUT_STRIDE],
            scratch: vec![0.0; MAX_STATE_LEN],
            surfaces: SurfaceTable::REFERENCE,
            step_count: 0,
        }
    }

    /// The surface table every vehicle's contacts index (ADR-0014).
    pub fn surfaces(&self) -> &SurfaceTable {
        &self.surfaces
    }

    /// Replace the surface table: entry `i` is surface id `i`. Validates
    /// every entry first and leaves the table unchanged on error.
    pub fn set_surfaces(&mut self, list: &[Surface]) -> Result<(), WorldError> {
        SurfaceTable::validate(list).map_err(WorldError::Invalid)?;
        self.surfaces = SurfaceTable::from_slice(list);
        Ok(())
    }

    /// Surface id of the built-in flat ground under vehicle `i`. An
    /// external host tags each wheel contact itself.
    pub fn set_surface(&mut self, i: usize, id: u32) -> Result<(), WorldError> {
        let v = self
            .vehicles
            .get_mut(i)
            .ok_or(WorldError::NoSuchVehicle(i))?;
        v.model.set_surface(id);
        Ok(())
    }

    pub fn capacity(&self) -> usize {
        self.capacity
    }

    pub fn len(&self) -> usize {
        self.vehicles.len()
    }

    pub fn is_empty(&self) -> bool {
        self.vehicles.is_empty()
    }

    /// Validate and add a vehicle. Returns its index.
    pub fn add_vehicle(&mut self, def: VehicleDefinition) -> Result<usize, WorldError> {
        if self.vehicles.len() >= self.capacity {
            return Err(WorldError::Full {
                capacity: self.capacity,
            });
        }
        def.validate().map_err(WorldError::Invalid)?;
        let rate = def.simulation.substep_rate_hz;
        let idx = self.vehicles.len();
        self.vehicles.push(Vehicle {
            model: VehicleModel::new(def),
            substep_rate_hz: rate,
        });
        self.clear_host_records(idx);
        let rec = &mut self.telemetry[idx * telemetry::STRIDE..(idx + 1) * telemetry::STRIDE];
        self.vehicles[idx]
            .model
            .write_telemetry(&VehicleInput::default(), rec);
        Ok(idx)
    }

    pub fn vehicle(&self, i: usize) -> Result<&Vehicle, WorldError> {
        self.vehicles.get(i).ok_or(WorldError::NoSuchVehicle(i))
    }

    pub fn vehicle_mut(&mut self, i: usize) -> Result<&mut Vehicle, WorldError> {
        self.vehicles.get_mut(i).ok_or(WorldError::NoSuchVehicle(i))
    }

    /// Flat input buffer, `capacity × VehicleInput::STRIDE`.
    pub fn inputs(&self) -> &[f64] {
        &self.inputs
    }

    pub fn inputs_mut(&mut self) -> &mut [f64] {
        &mut self.inputs
    }

    pub fn set_input(&mut self, i: usize, input: VehicleInput) -> Result<(), WorldError> {
        if i >= self.vehicles.len() {
            return Err(WorldError::NoSuchVehicle(i));
        }
        let s = &mut self.inputs[i * VehicleInput::STRIDE..(i + 1) * VehicleInput::STRIDE];
        input.write_slice(s);
        Ok(())
    }

    /// Flat telemetry buffer, `capacity × telemetry::STRIDE`.
    pub fn telemetry(&self) -> &[f64] {
        &self.telemetry
    }

    pub fn telemetry_of(&self, i: usize) -> &[f64] {
        &self.telemetry[i * telemetry::STRIDE..(i + 1) * telemetry::STRIDE]
    }

    /// Flat host-sync input buffer, `capacity × HOST_IN_STRIDE`. An external
    /// host writes its body state and wheel contacts here before `step`.
    pub fn host_in(&self) -> &[f64] {
        &self.host_in
    }

    pub fn host_in_mut(&mut self) -> &mut [f64] {
        &mut self.host_in
    }

    /// Flat host-sync output buffer, `capacity × HOST_OUT_STRIDE`: the
    /// impulses to apply after `step`, plus wheel positions for debug drawing.
    pub fn host_out(&self) -> &[f64] {
        &self.host_out
    }

    fn clear_host_records(&mut self, i: usize) {
        let rec = &mut self.host_in[i * HOST_IN_STRIDE..(i + 1) * HOST_IN_STRIDE];
        rec.fill(0.0);
        rec[6] = 1.0; // identity quaternion w
        for w in 0..WHEEL_COUNT {
            let o = HOST_IN_BODY_LEN + w * HOST_CONTACT_STRIDE;
            rec[o] = 1.0; // hit
            rec[o + 6] = 1.0; // normal +z
        }
        self.host_out[i * HOST_OUT_STRIDE..(i + 1) * HOST_OUT_STRIDE].fill(0.0);
    }

    /// Switch a vehicle between the built-in host and an external one. In
    /// external mode the vehicle reads the host-sync input record at the
    /// start of every step and writes the output record at the end. Switching
    /// back to the built-in host resets the vehicle at its current planar
    /// pose, since the external pose may be anywhere.
    pub fn set_host_mode(&mut self, i: usize, mode: HostMode) -> Result<(), WorldError> {
        let v = self
            .vehicles
            .get_mut(i)
            .ok_or(WorldError::NoSuchVehicle(i))?;
        let four = v
            .model
            .as_four_wheel_mut()
            .ok_or(WorldError::WrongModel(i))?;
        if four.host_mode != mode {
            four.host_mode = mode;
            if mode == HostMode::Builtin {
                let (x, y, yaw) = v.model.pose2d();
                v.model.reset(x, y, yaw);
            }
        }
        self.clear_host_records(i);
        Ok(())
    }

    /// Ground slope of the built-in flat world under vehicle `i`: rise per
    /// metre along world +x (grade, 0.1 for 10 %) and world +y (cross
    /// slope). Gravity then has a component along the ground. An external
    /// host has its own geometry and gravity and ignores this.
    pub fn set_ground_slope(&mut self, i: usize, grade: f64, cross: f64) -> Result<(), WorldError> {
        if !grade.is_finite() || !cross.is_finite() {
            return Err(WorldError::Invalid(vec![String::from(
                "ground slope must be finite",
            )]));
        }
        let v = self
            .vehicles
            .get_mut(i)
            .ok_or(WorldError::NoSuchVehicle(i))?;
        v.model.set_ground_slope(grade, cross);
        Ok(())
    }

    pub fn host_mode(&self, i: usize) -> Result<HostMode, WorldError> {
        let v = self.vehicles.get(i).ok_or(WorldError::NoSuchVehicle(i))?;
        let four = v.model.as_four_wheel().ok_or(WorldError::WrongModel(i))?;
        Ok(four.host_mode)
    }

    /// Wheel rays in the body frame, `WHEEL_COUNT × WHEEL_RAY_STRIDE` values.
    /// An external host casts these from its body pose each host step.
    pub fn wheel_rays(&self, i: usize, out: &mut [f64]) -> Result<usize, WorldError> {
        let v = self.vehicles.get(i).ok_or(WorldError::NoSuchVehicle(i))?;
        let four = v.model.as_four_wheel().ok_or(WorldError::WrongModel(i))?;
        let need = WHEEL_COUNT * WHEEL_RAY_STRIDE;
        if out.len() < need {
            return Ok(need);
        }
        for (w, g) in four.geometry().iter().enumerate() {
            let o = w * WHEEL_RAY_STRIDE;
            out[o] = g.ray_origin.x;
            out[o + 1] = g.ray_origin.y;
            out[o + 2] = g.ray_origin.z;
            out[o + 3] = g.ray_direction.x;
            out[o + 4] = g.ray_direction.y;
            out[o + 5] = g.ray_direction.z;
            out[o + 6] = g.ray_length;
            out[o + 7] = g.radius;
        }
        Ok(need)
    }

    /// Advance every vehicle by one host step of `dt` seconds.
    pub fn step(&mut self, dt: f64) {
        let dt = m::clamp(dt, 0.0, 1.0);
        if dt <= 0.0 {
            return;
        }
        for (i, v) in self.vehicles.iter_mut().enumerate() {
            let input = VehicleInput::from_slice(
                &self.inputs[i * VehicleInput::STRIDE..(i + 1) * VehicleInput::STRIDE],
            );
            let external =
                matches!(&v.model, VehicleModel::FourWheel(f) if f.host_mode == HostMode::External);
            if external {
                let rec = &self.host_in[i * HOST_IN_STRIDE..(i + 1) * HOST_IN_STRIDE];
                if let Some(f) = v.model.as_four_wheel_mut() {
                    read_host_in(f, rec);
                }
            }
            let n = m::max(m::round(dt * v.substep_rate_hz), 1.0) as usize;
            let sub_dt = dt / n as f64;
            for _ in 0..n {
                v.model.substep_on(sub_dt, &input, &self.surfaces);
            }
            if let Some(f) = v.model.as_four_wheel() {
                let out = &mut self.host_out[i * HOST_OUT_STRIDE..(i + 1) * HOST_OUT_STRIDE];
                write_host_out(f, out);
            }
            let rec = &mut self.telemetry[i * telemetry::STRIDE..(i + 1) * telemetry::STRIDE];
            v.model.write_telemetry(&input, rec);
        }
        self.step_count += 1;
    }

    pub fn state_hash(&mut self, i: usize) -> Result<u64, WorldError> {
        let v = self.vehicles.get(i).ok_or(WorldError::NoSuchVehicle(i))?;
        Ok(v.model.state_hash(&mut self.scratch))
    }

    /// Hash of every vehicle's state plus the step count.
    pub fn world_hash(&mut self) -> u64 {
        let mut h = skidpad_math::StateHasher::new();
        h.write_u64(self.step_count);
        for v in &self.vehicles {
            h.write_u64(v.model.state_hash(&mut self.scratch));
        }
        h.finish()
    }

    pub fn snapshot_len(&self, i: usize) -> Result<usize, WorldError> {
        let v = self.vehicles.get(i).ok_or(WorldError::NoSuchVehicle(i))?;
        Ok(v.model.snapshot_len())
    }

    /// Encode a vehicle's snapshot into `out`. Returns bytes written, or the
    /// number needed if `out` is too small.
    pub fn snapshot(&mut self, i: usize, out: &mut [u8]) -> Result<usize, WorldError> {
        let v = self.vehicles.get(i).ok_or(WorldError::NoSuchVehicle(i))?;
        Ok(v.model.snapshot_into(out, &mut self.scratch))
    }

    pub fn restore(&mut self, i: usize, bytes: &[u8]) -> Result<(), WorldError> {
        let v = self
            .vehicles
            .get_mut(i)
            .ok_or(WorldError::NoSuchVehicle(i))?;
        v.model
            .restore_from(bytes, &mut self.scratch)
            .map_err(WorldError::Snapshot)
    }

    pub fn reset_vehicle(&mut self, i: usize, x: f64, y: f64, yaw: f64) -> Result<(), WorldError> {
        let v = self
            .vehicles
            .get_mut(i)
            .ok_or(WorldError::NoSuchVehicle(i))?;
        v.model.reset(x, y, yaw);
        let rec = &mut self.telemetry[i * telemetry::STRIDE..(i + 1) * telemetry::STRIDE];
        v.model.write_telemetry(&VehicleInput::default(), rec);
        Ok(())
    }

    /// Swap in a new definition for live tuning. State is preserved.
    pub fn set_definition(&mut self, i: usize, def: VehicleDefinition) -> Result<(), WorldError> {
        def.validate().map_err(WorldError::Invalid)?;
        let v = self
            .vehicles
            .get_mut(i)
            .ok_or(WorldError::NoSuchVehicle(i))?;
        v.substep_rate_hz = def.simulation.substep_rate_hz;
        v.model.set_definition(def);
        let rec = &mut self.telemetry[i * telemetry::STRIDE..(i + 1) * telemetry::STRIDE];
        v.model.write_telemetry(&VehicleInput::default(), rec);
        Ok(())
    }
}

fn read_host_in(f: &mut crate::vehicle::FourWheelVehicle, rec: &[f64]) {
    let pos = Vec3::new(rec[0], rec[1], rec[2]);
    let orient = Quat::new(rec[3], rec[4], rec[5], rec[6]);
    let vel = Vec3::new(rec[7], rec[8], rec[9]);
    let angvel = Vec3::new(rec[10], rec[11], rec[12]);
    f.begin_host_step(pos, orient, vel, angvel);
    for w in 0..WHEEL_COUNT {
        let o = HOST_IN_BODY_LEN + w * HOST_CONTACT_STRIDE;
        let normal = Vec3::new(rec[o + 4], rec[o + 5], rec[o + 6]).normalized();
        let point = Vec3::new(rec[o + 1], rec[o + 2], rec[o + 3]);
        let surface_velocity = Vec3::new(rec[o + 7], rec[o + 8], rec[o + 9]);
        let hit = rec[o] > 0.5
            && normal.length() > 0.5
            && point.is_finite()
            && surface_velocity.is_finite();
        f.contacts[w] = if hit {
            WheelContact {
                hit: true,
                point,
                normal,
                surface_velocity,
                surface_id: m::max(rec[o + 10], 0.0) as u32,
            }
        } else {
            WheelContact::none()
        };
    }
}

fn write_host_out(f: &crate::vehicle::FourWheelVehicle, out: &mut [f64]) {
    out[0] = f.impulse.x;
    out[1] = f.impulse.y;
    out[2] = f.impulse.z;
    out[3] = f.angular_impulse.x;
    out[4] = f.angular_impulse.y;
    out[5] = f.angular_impulse.z;
    for (w, ws) in f.wheels.iter().enumerate() {
        let o = HOST_OUT_BODY_LEN + w * HOST_OUT_WHEEL_STRIDE;
        out[o] = ws.hub.x;
        out[o + 1] = ws.hub.y;
        out[o + 2] = ws.hub.z;
        out[o + 3] = ws.contact_point.x;
        out[o + 4] = ws.contact_point.y;
        out[o + 5] = ws.contact_point.z;
    }
}
