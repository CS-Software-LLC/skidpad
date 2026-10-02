//! Minimized valid definitions from the two 2026-10-02 CI failures. Keep
//! these explicit cases so changes to the proptest strategy cannot lose them.
//! https://github.com/CS-Software-LLC/skidpad/actions/runs/37073232373
//! https://github.com/CS-Software-LLC/skidpad/actions/runs/37070652376
use skidpad_core::drivetrain::{DirectDriveDef, PowerUnitDef};
use skidpad_core::tire::{FeelTireParams, TireModel};
use skidpad_core::vehicle::FourWheelVehicle;
use skidpad_core::{VehicleDefinition, VehicleInput};

fn latest_definition() -> VehicleDefinition {
    let mut d = VehicleDefinition::default();
    d.chassis.mass = 1852.1851577933257;
    d.chassis.yaw_inertia = 1500.2699778125939;
    d.chassis.wheelbase = 1.8;
    d.chassis.cg_to_front_axle = 0.54;
    d.chassis.cg_height = 0.7855532548451177;
    d.axles[0].tire = TireModel::Feel(FeelTireParams {
        radius: 0.2,
        nominal_load: 7042.19259717969,
        peak_friction: 1.7466379224473119,
        load_sensitivity: 0.0,
        peak_slip_ratio: 0.05,
        peak_slip_angle_deg: 3.0,
        longitudinal_stiffness: 5.0,
        cornering_stiffness: 37.69151322983585,
        stiffness_peak_load: 8000.0,
        falloff_long: 0.4727462864826644,
        falloff_lat: 0.4727462864826644,
        camber_stiffness: 0.8,
        pneumatic_trail: 0.03,
        trail_zero_crossing: 1.0,
        trail_reversal: 0.1,
        fx_moment_arm: 0.0,
        rolling_resistance: 0.012,
        relaxation_length_long: 0.25,
        relaxation_length_lat: 0.35,
        low_speed_floor: 0.5,
        low_speed_damping: 0.7,
        low_speed_damping_fade: 2.0,
    });
    d.axles[1].tire = TireModel::Feel(FeelTireParams {
        radius: 0.2,
        nominal_load: 1000.0,
        peak_friction: 0.4344799108661427,
        load_sensitivity: 0.0,
        peak_slip_ratio: 0.05,
        peak_slip_angle_deg: 3.0,
        longitudinal_stiffness: 38.51278360244221,
        cornering_stiffness: 5.0,
        stiffness_peak_load: 8000.0,
        falloff_long: 0.3,
        falloff_lat: 0.3,
        camber_stiffness: 0.8,
        pneumatic_trail: 0.03,
        trail_zero_crossing: 1.0,
        trail_reversal: 0.1,
        fx_moment_arm: 0.0,
        rolling_resistance: 0.012,
        relaxation_length_long: 0.25,
        relaxation_length_lat: 0.35,
        low_speed_floor: 0.5,
        low_speed_damping: 0.7,
        low_speed_damping_fade: 2.0,
    });
    d.drivetrain.power_unit = PowerUnitDef::Direct(DirectDriveDef {
        max_wheel_torque: 4863.0865454779005,
        ..Default::default()
    });
    d.simulation.substep_rate_hz = 240.0;
    d
}

#[test]
fn rapid_full_lock_latest_ci_regression() {
    run_case(
        latest_definition(),
        11.999238181778528,
        167,
        &[
            true, true, true, true, true, false, false, false, false, false, false, false, false,
            false,
        ],
    );
}

fn earlier_definition() -> VehicleDefinition {
    let mut d = VehicleDefinition::default();
    d.chassis.mass = 2487.009948733285;
    d.chassis.yaw_inertia = 2014.478058473961;
    d.chassis.wheelbase = 1.8;
    d.chassis.cg_to_front_axle = 0.54;
    d.chassis.cg_height = 0.7449292046381701;
    d.axles[0].tire = TireModel::Feel(FeelTireParams {
        radius: 0.2,
        nominal_load: 5078.382935881569,
        peak_friction: 1.5292376921896926,
        load_sensitivity: 0.04919795031866397,
        peak_slip_ratio: 0.05,
        peak_slip_angle_deg: 3.0,
        longitudinal_stiffness: 5.0,
        cornering_stiffness: 5.0,
        stiffness_peak_load: 8000.0,
        falloff_long: 0.7529403184193917,
        falloff_lat: 0.7529403184193917,
        camber_stiffness: 0.8,
        pneumatic_trail: 0.03,
        trail_zero_crossing: 1.0,
        trail_reversal: 0.1,
        fx_moment_arm: 0.0,
        rolling_resistance: 0.012,
        relaxation_length_long: 0.25,
        relaxation_length_lat: 0.35,
        low_speed_floor: 0.5,
        low_speed_damping: 0.7,
        low_speed_damping_fade: 2.0,
    });
    d.axles[1].tire = TireModel::Feel(FeelTireParams {
        radius: 0.2,
        nominal_load: 1000.0,
        peak_friction: 0.3,
        load_sensitivity: 0.0,
        peak_slip_ratio: 0.05,
        peak_slip_angle_deg: 3.0,
        longitudinal_stiffness: 5.0,
        cornering_stiffness: 5.0,
        stiffness_peak_load: 8000.0,
        falloff_long: 0.3,
        falloff_lat: 0.3,
        camber_stiffness: 0.8,
        pneumatic_trail: 0.03,
        trail_zero_crossing: 1.0,
        trail_reversal: 0.1,
        fx_moment_arm: 0.0,
        rolling_resistance: 0.012,
        relaxation_length_long: 0.25,
        relaxation_length_lat: 0.35,
        low_speed_floor: 0.5,
        low_speed_damping: 0.7,
        low_speed_damping_fade: 2.0,
    });
    d.drivetrain.power_unit = PowerUnitDef::Direct(DirectDriveDef {
        max_wheel_torque: 500.0,
        ..Default::default()
    });
    d.simulation.substep_rate_hz = 240.0;
    d
}

#[test]
fn rapid_full_lock_earlier_ci_regression() {
    run_case(
        earlier_definition(),
        39.4274942064832,
        96,
        &[
            true, false, false, false, true, false, true, true, false, false, false, false, false,
            false, false, false, false, false, false, false, false,
        ],
    );
}

fn run_case(d: VehicleDefinition, speed: f64, period_ms: u32, brakes: &[bool]) {
    assert!(d.validate().is_ok());
    let dt = 1.0 / d.simulation.substep_rate_hz;
    let steps = ((period_ms as f64) * 1e-3 / dt).max(1.0) as usize;
    let mut car = FourWheelVehicle::new(d);
    car.set_speed(speed);
    for (i, &brake) in brakes.iter().enumerate() {
        let input = VehicleInput {
            steer: if i % 2 == 0 { 1.0 } else { -1.0 },
            throttle: if brake { 0.0 } else { 1.0 },
            brake: if brake { 1.0 } else { 0.0 },
            ..VehicleInput::default()
        };
        for j in 0..steps {
            car.substep(dt, &input);
            assert!(
                car.vel.is_finite() && car.omega.is_finite() && car.pos.is_finite(),
                "period {i} step {j}"
            );
            assert!(car.orient.is_finite());
            assert!(
                car.speed() < 120.0,
                "speed {} period {i} step {j}",
                car.speed()
            );
            assert!(
                car.omega.length() < 30.0,
                "omega {:?} period {i} step {j}",
                car.omega
            );
            for w in &car.wheels {
                assert!(w.omega.is_finite() && w.omega.abs() < 2000.0);
                assert!(w.transient.slip_ratio.is_finite() && w.transient.slip_angle.is_finite());
                assert!(w.out.fx.is_finite() && w.out.fy.is_finite() && w.out.mz.is_finite());
            }
        }
    }
}
