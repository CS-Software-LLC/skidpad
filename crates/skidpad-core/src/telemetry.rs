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
    // Per-axle channels (front = F, rear = R).
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
}

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
        assert_eq!(STRIDE, WHEEL_LOCKED_R + 1);
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
