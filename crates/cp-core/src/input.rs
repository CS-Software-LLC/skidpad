//! Normalised driver input to a vehicle. Filtering (ramps, deadzones) happens
//! upstream in `@contactpatch/input` so that recorded inputs are device
//! independent.

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct VehicleInput {
    /// Steering, −1 (full left lock) … +1 (full right lock). Positive steers
    /// the wheels toward −y (right) in the ISO frame.
    pub steer: f64,
    /// Throttle, 0 … 1.
    pub throttle: f64,
    /// Brake, 0 … 1.
    pub brake: f64,
    /// Handbrake, 0 … 1 (rear axle only).
    pub handbrake: f64,
}

impl VehicleInput {
    /// Number of `f64` slots this input occupies in the shared input buffer.
    pub const STRIDE: usize = 4;

    pub fn clamped(self) -> Self {
        Self {
            steer: cp_math::clamp(self.steer, -1.0, 1.0),
            throttle: cp_math::clamp(self.throttle, 0.0, 1.0),
            brake: cp_math::clamp(self.brake, 0.0, 1.0),
            handbrake: cp_math::clamp(self.handbrake, 0.0, 1.0),
        }
    }

    pub fn from_slice(s: &[f64]) -> Self {
        Self {
            steer: s.first().copied().unwrap_or(0.0),
            throttle: s.get(1).copied().unwrap_or(0.0),
            brake: s.get(2).copied().unwrap_or(0.0),
            handbrake: s.get(3).copied().unwrap_or(0.0),
        }
        .clamped()
    }

    pub fn write_slice(&self, s: &mut [f64]) {
        if s.len() >= Self::STRIDE {
            s[0] = self.steer;
            s[1] = self.throttle;
            s[2] = self.brake;
            s[3] = self.handbrake;
        }
    }
}
