//! Telemetry channel layout. Every value that influences the simulation is a
//! channel. The layout is a flat `f64` record per vehicle; the WASM layer
//! exposes the names so the TypeScript side never hard-codes indices.
//!
//! Channel names follow iRacing / Assetto Corsa export conventions where an
//! equivalent exists (`Speed`, `YawRate`, `LatAccel`, `LongAccel`,
//! `SteeringWheelAngle`, `Throttle`, `Brake`), so external tools can diff
//! exports directly.

/// One telemetry channel.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Channel {
    pub name: &'static str,
    pub unit: &'static str,
}

macro_rules! channels {
    ( $( $const:ident => ($name:literal, $unit:literal) ),* $(,)? ) => {
        channels!(@idx 0usize; $( $const ),*);
        pub const CHANNELS: &[Channel] = &[ $( Channel { name: $name, unit: $unit } ),* ];
    };
    (@idx $i:expr; $head:ident $(, $tail:ident)*) => {
        pub const $head: usize = $i;
        channels!(@idx $i + 1usize; $( $tail ),*);
    };
    (@idx $i:expr;) => {};
}

channels! {
    TIME => ("Time", "s"),
    POS_X => ("PosX", "m"),
    POS_Y => ("PosY", "m"),
    YAW => ("Yaw", "rad"),
    VEL_X => ("VelX", "m/s"),
    VEL_Y => ("VelY", "m/s"),
    YAW_RATE => ("YawRate", "rad/s"),
    SPEED => ("Speed", "m/s"),
    LONG_ACCEL => ("LongAccel", "m/s^2"),
    LAT_ACCEL => ("LatAccel", "m/s^2"),
    BODY_SLIP => ("BodySlipAngle", "rad"),
    STEERING_WHEEL_ANGLE => ("SteeringWheelAngle", "rad"),
    STEER_ANGLE => ("SteerAngle", "rad"),
    THROTTLE => ("Throttle", "-"),
    BRAKE => ("Brake", "-"),
    HANDBRAKE => ("Handbrake", "-"),
    STEERING_TORQUE => ("SteeringTorque", "N*m"),
    DRAG_FORCE => ("DragForce", "N"),
    // Per-axle channels (front = F, rear = R). Forces and moments are axle
    // sums; speeds, slips and trail are axle means.
    WHEEL_SPEED_F => ("WheelSpeed_F", "rad/s"),
    WHEEL_SPEED_R => ("WheelSpeed_R", "rad/s"),
    LOAD_F => ("TireLoad_F", "N"),
    LOAD_R => ("TireLoad_R", "N"),
    SLIP_RATIO_F => ("SlipRatio_F", "-"),
    SLIP_RATIO_R => ("SlipRatio_R", "-"),
    SLIP_ANGLE_F => ("SlipAngle_F", "rad"),
    SLIP_ANGLE_R => ("SlipAngle_R", "rad"),
    FX_F => ("TireFx_F", "N"),
    FX_R => ("TireFx_R", "N"),
    FY_F => ("TireFy_F", "N"),
    FY_R => ("TireFy_R", "N"),
    MZ_F => ("TireMz_F", "N*m"),
    MZ_R => ("TireMz_R", "N*m"),
    FMAX_F => ("TireFmax_F", "N"),
    FMAX_R => ("TireFmax_R", "N"),
    TRAIL_F => ("PneumaticTrail_F", "m"),
    TRAIL_R => ("PneumaticTrail_R", "m"),
    DRIVE_TORQUE_F => ("DriveTorque_F", "N*m"),
    DRIVE_TORQUE_R => ("DriveTorque_R", "N*m"),
    BRAKE_TORQUE_F => ("BrakeTorque_F", "N*m"),
    BRAKE_TORQUE_R => ("BrakeTorque_R", "N*m"),
    WHEEL_LOCKED_F => ("WheelLocked_F", "-"),
    WHEEL_LOCKED_R => ("WheelLocked_R", "-"),
    // Body pose and rates beyond the plane (four-wheel model; the
    // single-track model reports ride height and zero roll and pitch).
    POS_Z => ("PosZ", "m"),
    ROLL => ("Roll", "rad"),
    PITCH => ("Pitch", "rad"),
    ROLL_RATE => ("RollRate", "rad/s"),
    PITCH_RATE => ("PitchRate", "rad/s"),
    // World-frame vertical (heave) velocity; VelX and VelY are body-frame.
    VEL_Z => ("VelZ", "m/s"),
    VERT_ACCEL => ("VertAccel", "m/s^2"),
    QUAT_X => ("QuatX", "-"),
    QUAT_Y => ("QuatY", "-"),
    QUAT_Z => ("QuatZ", "-"),
    QUAT_W => ("QuatW", "-"),
    // Per-wheel channels, front-left, front-right, rear-left, rear-right.
    WHEEL_SPEED_FL => ("WheelSpeed_FL", "rad/s"),
    WHEEL_SPEED_FR => ("WheelSpeed_FR", "rad/s"),
    WHEEL_SPEED_RL => ("WheelSpeed_RL", "rad/s"),
    WHEEL_SPEED_RR => ("WheelSpeed_RR", "rad/s"),
    LOAD_FL => ("TireLoad_FL", "N"),
    LOAD_FR => ("TireLoad_FR", "N"),
    LOAD_RL => ("TireLoad_RL", "N"),
    LOAD_RR => ("TireLoad_RR", "N"),
    SLIP_RATIO_FL => ("SlipRatio_FL", "-"),
    SLIP_RATIO_FR => ("SlipRatio_FR", "-"),
    SLIP_RATIO_RL => ("SlipRatio_RL", "-"),
    SLIP_RATIO_RR => ("SlipRatio_RR", "-"),
    SLIP_ANGLE_FL => ("SlipAngle_FL", "rad"),
    SLIP_ANGLE_FR => ("SlipAngle_FR", "rad"),
    SLIP_ANGLE_RL => ("SlipAngle_RL", "rad"),
    SLIP_ANGLE_RR => ("SlipAngle_RR", "rad"),
    FX_FL => ("TireFx_FL", "N"),
    FX_FR => ("TireFx_FR", "N"),
    FX_RL => ("TireFx_RL", "N"),
    FX_RR => ("TireFx_RR", "N"),
    FY_FL => ("TireFy_FL", "N"),
    FY_FR => ("TireFy_FR", "N"),
    FY_RL => ("TireFy_RL", "N"),
    FY_RR => ("TireFy_RR", "N"),
    MZ_FL => ("TireMz_FL", "N*m"),
    MZ_FR => ("TireMz_FR", "N*m"),
    MZ_RL => ("TireMz_RL", "N*m"),
    MZ_RR => ("TireMz_RR", "N*m"),
    CAMBER_FL => ("Camber_FL", "rad"),
    CAMBER_FR => ("Camber_FR", "rad"),
    CAMBER_RL => ("Camber_RL", "rad"),
    CAMBER_RR => ("Camber_RR", "rad"),
    SUSP_TRAVEL_FL => ("SuspTravel_FL", "m"),
    SUSP_TRAVEL_FR => ("SuspTravel_FR", "m"),
    SUSP_TRAVEL_RL => ("SuspTravel_RL", "m"),
    SUSP_TRAVEL_RR => ("SuspTravel_RR", "m"),
    SUSP_RATE_FL => ("SuspRate_FL", "m/s"),
    SUSP_RATE_FR => ("SuspRate_FR", "m/s"),
    SUSP_RATE_RL => ("SuspRate_RL", "m/s"),
    SUSP_RATE_RR => ("SuspRate_RR", "m/s"),
    SUSP_FORCE_FL => ("SuspForce_FL", "N"),
    SUSP_FORCE_FR => ("SuspForce_FR", "N"),
    SUSP_FORCE_RL => ("SuspForce_RL", "N"),
    SUSP_FORCE_RR => ("SuspForce_RR", "N"),
    WHEEL_STEER_FL => ("WheelSteer_FL", "rad"),
    WHEEL_STEER_FR => ("WheelSteer_FR", "rad"),
    WHEEL_STEER_RL => ("WheelSteer_RL", "rad"),
    WHEEL_STEER_RR => ("WheelSteer_RR", "rad"),
    WHEEL_CONTACT_FL => ("WheelContact_FL", "-"),
    WHEEL_CONTACT_FR => ("WheelContact_FR", "-"),
    WHEEL_CONTACT_RL => ("WheelContact_RL", "-"),
    WHEEL_CONTACT_RR => ("WheelContact_RR", "-"),
    WHEEL_LOCKED_FL => ("WheelLocked_FL", "-"),
    WHEEL_LOCKED_FR => ("WheelLocked_FR", "-"),
    WHEEL_LOCKED_RL => ("WheelLocked_RL", "-"),
    WHEEL_LOCKED_RR => ("WheelLocked_RR", "-"),
    SPIN_ANGLE_FL => ("SpinAngle_FL", "rad"),
    SPIN_ANGLE_FR => ("SpinAngle_FR", "rad"),
    SPIN_ANGLE_RL => ("SpinAngle_RL", "rad"),
    SPIN_ANGLE_RR => ("SpinAngle_RR", "rad"),
    // Drivetrain (ADR-0011).
    ENGINE_RPM => ("EngineRpm", "rpm"),
    ENGINE_TORQUE => ("EngineTorque", "N*m"),
    GEAR => ("Gear", "-"),
    CLUTCH_SLIP => ("ClutchSlip", "rad/s"),
    CLUTCH_TORQUE => ("ClutchTorque", "N*m"),
    DIFF_LOCK_TORQUE_F => ("DiffLockTorque_F", "N*m"),
    DIFF_LOCK_TORQUE_R => ("DiffLockTorque_R", "N*m"),
    CENTER_LOCK_TORQUE => ("CenterLockTorque", "N*m"),
    CLUTCH => ("Clutch", "-"),
}

/// Index of the first channel in each per-wheel group; the four wheels follow
/// in order FL, FR, RL, RR.
pub const WHEEL_GROUPS: &[usize] = &[
    WHEEL_SPEED_FL,
    LOAD_FL,
    SLIP_RATIO_FL,
    SLIP_ANGLE_FL,
    FX_FL,
    FY_FL,
    MZ_FL,
    CAMBER_FL,
    SUSP_TRAVEL_FL,
    SUSP_RATE_FL,
    SUSP_FORCE_FL,
    WHEEL_STEER_FL,
    WHEEL_CONTACT_FL,
    WHEEL_LOCKED_FL,
    SPIN_ANGLE_FL,
];

/// Number of `f64` slots in one vehicle's telemetry record.
pub const STRIDE: usize = CHANNELS.len();

/// JSON description of the layout, for the WASM ABI.
pub fn layout_json() -> String {
    let mut s = String::from("[");
    for (i, c) in CHANNELS.iter().enumerate() {
        if i > 0 {
            s.push(',');
        }
        s.push_str(&format!(
            "{{\"name\":\"{}\",\"unit\":\"{}\"}}",
            c.name, c.unit
        ));
    }
    s.push(']');
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn indices_match_order() {
        assert_eq!(CHANNELS[TIME].name, "Time");
        assert_eq!(CHANNELS[SPEED].name, "Speed");
        assert_eq!(CHANNELS[WHEEL_LOCKED_R].name, "WheelLocked_R");
        assert_eq!(CHANNELS[SPIN_ANGLE_RR].name, "SpinAngle_RR");
        assert_eq!(CHANNELS[ENGINE_RPM].name, "EngineRpm");
        assert_eq!(STRIDE, CLUTCH + 1);
        for &g in WHEEL_GROUPS {
            let base = CHANNELS[g].name.trim_end_matches("_FL");
            for (k, side) in ["_FL", "_FR", "_RL", "_RR"].iter().enumerate() {
                assert_eq!(CHANNELS[g + k].name, format!("{base}{side}"));
            }
        }
    }

    #[test]
    fn names_are_unique() {
        for (i, a) in CHANNELS.iter().enumerate() {
            for b in &CHANNELS[i + 1..] {
                assert_ne!(a.name, b.name);
            }
        }
    }
}
