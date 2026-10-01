//! A world holds many vehicles and steps them in one batched call. All
//! per-vehicle inputs and telemetry live in flat `f64` buffers so the WASM
//! layer can expose them as typed-array views with no copying.

use crate::definition::VehicleDefinition;
use crate::input::VehicleInput;
use crate::snapshot::{SnapshotError, Snapshottable};
use crate::telemetry;
use crate::vehicle::BicycleVehicle;
use cp_math as m;

/// Largest state any vehicle type can have, in `f64` values. Sized for the
/// four-wheel model that lands in milestone 2.
pub const MAX_STATE_LEN: usize = 256;

#[derive(Clone, Debug, PartialEq)]
pub struct Vehicle {
    pub model: BicycleVehicle,
    pub substep_rate_hz: f64,
}

#[derive(Clone, Debug)]
pub struct World {
    capacity: usize,
    vehicles: Vec<Vehicle>,
    inputs: Vec<f64>,
    telemetry: Vec<f64>,
    scratch: Vec<f64>,
    /// Number of host steps taken.
    pub step_count: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WorldError {
    Full { capacity: usize },
    Invalid(Vec<String>),
    NoSuchVehicle(usize),
    Snapshot(SnapshotError),
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
            scratch: vec![0.0; MAX_STATE_LEN],
            step_count: 0,
        }
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
            model: BicycleVehicle::new(def),
            substep_rate_hz: rate,
        });
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
            let n = m::max(m::round(dt * v.substep_rate_hz), 1.0) as usize;
            let sub_dt = dt / n as f64;
            for _ in 0..n {
                v.model.substep(sub_dt, &input);
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
        let mut h = cp_math::StateHasher::new();
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
        Ok(())
    }
}
