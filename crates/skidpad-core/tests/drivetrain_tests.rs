//! Drivetrain behaviour (ADR-0011): launch, shifting, clutch lock and slip,
//! limited-slip and locked differentials, the centre split, electric drive,
//! and the exact brake lock with a driven wheel, on both vehicle models.

use skidpad_core::definition::VehicleModelKind;
use skidpad_core::drivetrain::{
    CombustionEngineDef, DifferentialDef, DifferentialKind, Drivetrain, DrivetrainDef,
    ElectricMotorDef, PowerUnitDef, TransmissionDef, TransmissionMode, WheelDyn, RPM_TO_RAD,
};
use skidpad_core::telemetry as t;
use skidpad_core::vehicle::{FourWheelVehicle, FL, FR, RL, RR};
use skidpad_core::{VehicleDefinition, VehicleInput, World};
use skidpad_math as m;

fn combustion_def() -> VehicleDefinition {
    VehicleDefinition {
        drivetrain: DrivetrainDef {
            power_unit: PowerUnitDef::Combustion(CombustionEngineDef::default()),
            transmission: TransmissionDef {
                gears: vec![3.5, 2.1, 1.4, 1.0, 0.8],
                reverse: 3.2,
                final_drive: 4.0,
                ..TransmissionDef::default()
            },
            ..DrivetrainDef::default()
        },
        ..VehicleDefinition::default()
    }
}

fn electric_def() -> VehicleDefinition {
    VehicleDefinition {
        drivetrain: DrivetrainDef {
            // A motor the front tires can nearly hold: 180 N·m through 9:1.
            power_unit: PowerUnitDef::Electric(ElectricMotorDef {
                max_torque: 180.0,
                ..ElectricMotorDef::default()
            }),
            transmission: TransmissionDef {
                gears: vec![9.0],
                reverse: 9.0,
                final_drive: 1.0,
                shift_time: 0.0,
                ..TransmissionDef::default()
            },
            ..DrivetrainDef::default()
        },
        ..VehicleDefinition::default()
    }
}

fn throttle(v: f64) -> VehicleInput {
    VehicleInput {
        throttle: v,
        ..VehicleInput::default()
    }
}

fn drive(w: &mut World, input: VehicleInput, seconds: f64) {
    w.set_input(0, input).unwrap();
    let n = (seconds * 100.0) as usize;
    for _ in 0..n {
        w.step(0.01);
    }
}

// ------------------------------------------------------------ unit level ----

/// Four free wheels, no brakes, no tire torque: a plain spin-up test rig.
fn rig(mut def: DrivetrainDef, driven: [bool; 2]) -> (Drivetrain, [WheelDyn; 4]) {
    // No driveline inertia of its own, so torque splits come out exact.
    def.transmission.input_inertia = 0.0;
    def.transmission.output_inertia = 0.0;
    let d = Drivetrain::new(def, driven, 4);
    let wheels = [WheelDyn {
        inertia: 1.5,
        ..WheelDyn::default()
    }; 4];
    (d, wheels)
}

#[test]
fn an_engine_in_neutral_revs_to_the_limiter_and_idles_on_a_closed_throttle() {
    let mut def = combustion_def().drivetrain;
    def.transmission.mode = TransmissionMode::Manual;
    let (mut d, mut wheels) = rig(def, [false, true]);
    assert_eq!(d.gear, 0);
    let idle = 850.0 * RPM_TO_RAD;
    assert!((d.engine_omega - idle).abs() < 1e-9);
    for _ in 0..3000 {
        d.step(0.001, &throttle(1.0), &mut wheels);
    }
    let rpm = d.telemetry.engine_rpm;
    assert!(rpm > 6400.0 && rpm < 6700.0, "limiter holds {rpm} rpm");
    assert!(
        wheels.iter().all(|w| w.omega == 0.0),
        "neutral drives nothing"
    );
    for _ in 0..12000 {
        d.step(0.001, &throttle(0.0), &mut wheels);
    }
    let rpm = d.telemetry.engine_rpm;
    assert!((rpm - 850.0).abs() < 30.0, "idle governor holds {rpm} rpm");
}

#[test]
fn a_locked_clutch_couples_engine_and_wheels_as_one_inertia() {
    let mut def = combustion_def().drivetrain;
    def.transmission.clutch_bite_rpm = 0.0; // fully engaged from idle
    def.transmission.clutch_max_torque = 1e6;
    def.transmission.gears = vec![2.0];
    def.transmission.final_drive = 2.0;
    let (mut d, mut wheels) = rig(def, [false, true]);
    d.gear = 1;
    // Spin the engine to 3000 rpm against free wheels at rest: momentum is
    // shared through the ratio in one step, and afterwards the clutch does
    // not slip.
    d.engine_omega = 3000.0 * RPM_TO_RAD;
    d.step(0.001, &throttle(0.0), &mut wheels);
    let r = 4.0;
    // Reflected wheel-side inertia: two rear wheels at 1.5 plus the
    // transmission's output inertia, seen from the engine through r².
    let rear = wheels[RL].omega;
    assert!(
        (wheels[RR].omega - rear).abs() < 1e-9,
        "open diff, symmetric"
    );
    assert!(wheels[FL].omega == 0.0 && wheels[FR].omega == 0.0);
    assert!(
        (d.engine_omega - r * rear).abs() < 1e-6,
        "engine {} vs {}",
        d.engine_omega,
        r * rear
    );
    assert!(d.telemetry.clutch_slip.abs() < 1e-6);
}

#[test]
fn a_slipping_clutch_transmits_its_capacity() {
    let mut def = combustion_def().drivetrain;
    def.transmission.clutch_bite_rpm = 0.0;
    def.transmission.clutch_max_torque = 100.0;
    def.transmission.gears = vec![1.0];
    def.transmission.final_drive = 1.0;
    let (mut d, mut wheels) = rig(def, [false, true]);
    d.gear = 1;
    d.engine_omega = 5000.0 * RPM_TO_RAD;
    d.step(0.001, &throttle(0.0), &mut wheels);
    assert!((d.telemetry.clutch_torque - 100.0).abs() < 1e-9);
    assert!(d.telemetry.clutch_slip < -100.0, "still slipping");
    // Carrier torque 100 N·m over two wheels.
    assert!((wheels[RL].shaft_torque - 50.0).abs() < 1e-6);
    assert!((wheels[RR].shaft_torque - 50.0).abs() < 1e-6);
}

#[test]
fn a_limited_slip_differential_biases_torque_to_the_slower_wheel() {
    let mut def = combustion_def().drivetrain;
    def.transmission.clutch_bite_rpm = 0.0;
    def.transmission.clutch_max_torque = 100.0;
    def.transmission.gears = vec![1.0];
    def.transmission.final_drive = 1.0;
    def.rear = DifferentialDef {
        kind: DifferentialKind::Lsd,
        preload: 0.0,
        bias_drive: 3.0,
        bias_coast: 1.5,
    };
    let (mut d, mut wheels) = rig(def, [false, true]);
    d.gear = 1;
    d.engine_omega = 5000.0 * RPM_TO_RAD;
    // The right wheel is already spinning (as if on ice).
    wheels[RR].omega = 50.0;
    d.step(0.001, &throttle(0.0), &mut wheels);
    // Carrier torque 100: at the bias limit the slow wheel gets 75 and the
    // fast one 25 (3:1), i.e. 25 N·m transferred.
    assert!(
        (d.telemetry.diff_lock_rear.abs() - 25.0).abs() < 1e-6,
        "{}",
        d.telemetry.diff_lock_rear
    );
    assert!(
        (wheels[RL].shaft_torque - 75.0).abs() < 1e-6,
        "{}",
        wheels[RL].shaft_torque
    );
    assert!(
        (wheels[RR].shaft_torque - 25.0).abs() < 1e-6,
        "{}",
        wheels[RR].shaft_torque
    );
}

#[test]
fn a_locked_differential_keeps_both_wheels_at_one_speed() {
    let mut def = combustion_def().drivetrain;
    def.rear.kind = DifferentialKind::Locked;
    let (mut d, mut wheels) = rig(def, [false, true]);
    wheels[RL].omega = 10.0;
    wheels[RR].omega = 30.0;
    d.step(0.001, &throttle(0.0), &mut wheels);
    assert!((wheels[RL].omega - wheels[RR].omega).abs() < 1e-9);
    assert!(
        (wheels[RL].omega - 20.0).abs() < 1e-6,
        "momentum kept: {}",
        wheels[RL].omega
    );
}

#[test]
fn an_open_centre_differential_splits_torque_by_its_fraction() {
    let mut def = combustion_def().drivetrain;
    def.transmission.clutch_bite_rpm = 0.0;
    def.transmission.clutch_max_torque = 100.0;
    def.transmission.gears = vec![1.0];
    def.transmission.final_drive = 1.0;
    def.center.front_torque_fraction = 0.3;
    let (mut d, mut wheels) = rig(def, [true, true]);
    d.gear = 1;
    d.engine_omega = 5000.0 * RPM_TO_RAD;
    d.step(0.001, &throttle(0.0), &mut wheels);
    let front = wheels[FL].shaft_torque + wheels[FR].shaft_torque;
    let rear = wheels[RL].shaft_torque + wheels[RR].shaft_torque;
    assert!((front - 30.0).abs() < 1e-6, "front {front}");
    assert!((rear - 70.0).abs() < 1e-6, "rear {rear}");
}

#[test]
fn a_brake_within_capacity_holds_a_driven_wheel_at_exactly_zero() {
    let mut def = combustion_def().drivetrain;
    def.transmission.clutch_bite_rpm = 0.0;
    def.transmission.clutch_max_torque = 100.0;
    def.transmission.gears = vec![1.0];
    def.transmission.final_drive = 1.0;
    let (mut d, mut wheels) = rig(def, [false, true]);
    d.gear = 1;
    d.engine_omega = 3000.0 * RPM_TO_RAD;
    for w in &mut wheels {
        w.brake_capacity = 1000.0;
    }
    for _ in 0..50 {
        d.step(0.001, &throttle(0.0), &mut wheels);
    }
    for w in &wheels {
        assert_eq!(w.omega, 0.0);
        assert!(w.locked);
    }
    // The engine is dragged against the brakes through the slipping clutch.
    assert!((d.telemetry.clutch_torque - 100.0).abs() < 1e-9);
}

#[test]
fn electric_reverse_drives_backwards_and_regenerates_on_lift() {
    let def = electric_def().drivetrain;
    let (mut d, mut wheels) = rig(def, [false, true]);
    assert_eq!(d.gear, 1);
    for _ in 0..1000 {
        d.step(0.001, &throttle(1.0), &mut wheels);
    }
    assert!(wheels[RL].omega > 10.0, "forward: {}", wheels[RL].omega);
    assert!(d.engine_omega > 0.0);
    // Lift: regeneration slows the wheels.
    let before = wheels[RL].omega;
    for _ in 0..500 {
        d.step(0.001, &throttle(0.0), &mut wheels);
    }
    assert!(
        wheels[RL].omega < before - 1.0,
        "regen {} -> {}",
        before,
        wheels[RL].omega
    );
    assert!(d.telemetry.engine_torque < 0.0);
    // Reverse: request it, stop, and it drives the other way.
    for w in &mut wheels {
        w.omega = 0.0;
    }
    let reverse = VehicleInput {
        throttle: 1.0,
        gear: -1.0,
        ..VehicleInput::default()
    };
    for _ in 0..1000 {
        d.step(0.001, &reverse, &mut wheels);
    }
    assert_eq!(d.gear, -1);
    assert!(wheels[RL].omega < -5.0, "reverse: {}", wheels[RL].omega);
}

// --------------------------------------------------------- vehicle level ----

#[test]
fn a_combustion_car_launches_and_shifts_up_through_the_gears() {
    for model in [VehicleModelKind::FourWheel, VehicleModelKind::SingleTrack] {
        let mut d = combustion_def();
        d.simulation.model = model;
        let mut w = World::new(1);
        w.add_vehicle(d).unwrap();
        let mut gears_seen = Vec::new();
        let mut max_rpm: f64 = 0.0;
        w.set_input(0, throttle(1.0)).unwrap();
        for _ in 0..1500 {
            w.step(0.01);
            let v = w.telemetry_of(0);
            let g = v[t::GEAR] as i32;
            if gears_seen.last() != Some(&g) {
                gears_seen.push(g);
            }
            max_rpm = m::max(max_rpm, v[t::ENGINE_RPM]);
        }
        let v = w.telemetry_of(0);
        assert!(
            v[t::SPEED] > 30.0,
            "{model:?}: {} m/s after 15 s",
            v[t::SPEED]
        );
        assert!(gears_seen.len() >= 4, "{model:?}: gears {gears_seen:?}");
        assert!(
            gears_seen.windows(2).all(|p| p[1] > p[0]),
            "{model:?}: {gears_seen:?}"
        );
        assert!(max_rpm < 6700.0, "{model:?}: {max_rpm} rpm");
        assert!(
            v[t::CLUTCH_SLIP].abs() < 1.0,
            "{model:?}: clutch locked at speed"
        );
    }
}

#[test]
fn an_automatic_idles_with_the_brakes_held_and_creeps_little_without() {
    let d = combustion_def();
    let mut w = World::new(1);
    w.add_vehicle(d).unwrap();
    drive(
        &mut w,
        VehicleInput {
            brake: 1.0,
            ..VehicleInput::default()
        },
        3.0,
    );
    let v = w.telemetry_of(0);
    assert!(v[t::SPEED] < 1e-6);
    assert!(
        (v[t::ENGINE_RPM] - 850.0).abs() < 60.0,
        "{} rpm",
        v[t::ENGINE_RPM]
    );
    assert_eq!(v[t::GEAR], 1.0);
    drive(&mut w, VehicleInput::default(), 3.0);
    let v = w.telemetry_of(0);
    assert!(v[t::SPEED] < 1.0, "creep {} m/s", v[t::SPEED]);
}

#[test]
fn reverse_backs_the_car_up() {
    let d = combustion_def();
    let mut w = World::new(1);
    w.add_vehicle(d).unwrap();
    drive(
        &mut w,
        VehicleInput {
            throttle: 0.5,
            gear: -1.0,
            ..VehicleInput::default()
        },
        4.0,
    );
    let v = w.telemetry_of(0);
    assert_eq!(v[t::GEAR], -1.0);
    assert!(v[t::VEL_X] < -2.0, "reversing at {} m/s", v[t::VEL_X]);
    assert!(
        v[t::ENGINE_RPM] > 850.0,
        "engine turns forward: {} rpm",
        v[t::ENGINE_RPM]
    );
}

#[test]
fn a_manual_car_follows_the_gear_input_and_the_clutch_pedal() {
    let mut d = combustion_def();
    d.drivetrain.transmission.mode = TransmissionMode::Manual;
    let mut w = World::new(1);
    w.add_vehicle(d).unwrap();
    // Neutral: full throttle goes nowhere.
    drive(&mut w, throttle(1.0), 2.0);
    assert!(w.telemetry_of(0)[t::SPEED] < 1e-6);
    assert!(w.telemetry_of(0)[t::ENGINE_RPM] > 6000.0);
    // Clutch down, first gear, clutch up: off we go.
    drive(
        &mut w,
        VehicleInput {
            throttle: 0.3,
            clutch: 1.0,
            gear: 1.0,
            ..VehicleInput::default()
        },
        0.5,
    );
    assert!(w.telemetry_of(0)[t::SPEED] < 1e-6, "clutch open");
    drive(
        &mut w,
        VehicleInput {
            throttle: 0.5,
            gear: 1.0,
            ..VehicleInput::default()
        },
        3.0,
    );
    let v = w.telemetry_of(0);
    assert!(v[t::SPEED] > 4.0, "{} m/s", v[t::SPEED]);
    assert_eq!(v[t::GEAR], 1.0);
    // Second gear: engine speed drops with the ratio.
    let rpm1 = v[t::ENGINE_RPM];
    drive(
        &mut w,
        VehicleInput {
            throttle: 0.5,
            gear: 2.0,
            ..VehicleInput::default()
        },
        1.5,
    );
    let v = w.telemetry_of(0);
    assert_eq!(v[t::GEAR], 2.0);
    assert!(v[t::ENGINE_RPM] < rpm1, "{} -> {}", rpm1, v[t::ENGINE_RPM]);
}

#[test]
fn an_electric_car_accelerates_from_rest_without_a_clutch() {
    let d = electric_def();
    let mut w = World::new(1);
    w.add_vehicle(d).unwrap();
    drive(&mut w, throttle(1.0), 5.0);
    let v = w.telemetry_of(0);
    assert!(v[t::SPEED] > 15.0, "{} m/s", v[t::SPEED]);
    assert!(
        v[t::CLUTCH_TORQUE] != 0.0,
        "the rigid coupling carries torque"
    );
    assert!(v[t::CLUTCH_SLIP].abs() < 1e-6, "rigid coupling");
    // Motor speed is the driven-wheel speed through the ratio.
    let wheel = 0.5 * (v[t::WHEEL_SPEED_FL] + v[t::WHEEL_SPEED_FR]);
    assert!(
        (v[t::ENGINE_RPM] * RPM_TO_RAD - 9.0 * wheel).abs() < 1e-6,
        "motor {} rad/s vs wheels {}",
        v[t::ENGINE_RPM] * RPM_TO_RAD,
        wheel
    );
}

#[test]
fn awd_with_a_locked_centre_keeps_the_axles_together() {
    let mut d = combustion_def();
    d.axles[0].driven = true;
    d.axles[1].driven = true;
    d.drivetrain.center.kind = DifferentialKind::Locked;
    let mut car = FourWheelVehicle::new(d);
    let input = throttle(1.0);
    for _ in 0..3000 {
        car.substep(0.001, &input);
    }
    let f = 0.5 * (car.wheels[FL].omega + car.wheels[FR].omega);
    let r = 0.5 * (car.wheels[RL].omega + car.wheels[RR].omega);
    assert!(f > 20.0);
    assert!((f - r).abs() < 1e-6, "front {f} rear {r}");
    assert!(car.wheels[FL].drive_torque > 0.0 && car.wheels[RL].drive_torque > 0.0);
}

#[test]
fn drivetrain_state_round_trips_through_a_snapshot() {
    let d = combustion_def();
    let mut a = World::new(1);
    a.add_vehicle(d.clone()).unwrap();
    let mut b = World::new(1);
    b.add_vehicle(d).unwrap();
    drive(&mut a, throttle(1.0), 6.0);
    let mut buf = vec![0u8; a.snapshot_len(0).unwrap()];
    a.snapshot(0, &mut buf).unwrap();
    b.restore(0, &buf).unwrap();
    assert_eq!(a.state_hash(0).unwrap(), b.state_hash(0).unwrap());
    let ga = a
        .vehicle(0)
        .unwrap()
        .model
        .as_four_wheel()
        .unwrap()
        .drivetrain
        .gear;
    let gb = b
        .vehicle(0)
        .unwrap()
        .model
        .as_four_wheel()
        .unwrap()
        .drivetrain
        .gear;
    assert_eq!(ga, gb);
    assert!(ga >= 2, "shifted by 6 s: gear {ga}");
    for k in 0..300 {
        let input = throttle(if k < 150 { 0.2 } else { 1.0 });
        a.set_input(0, input).unwrap();
        b.set_input(0, input).unwrap();
        a.step(0.01);
        b.step(0.01);
        assert_eq!(
            a.state_hash(0).unwrap(),
            b.state_hash(0).unwrap(),
            "step {k}"
        );
    }
}

#[test]
fn bad_drivetrains_are_rejected() {
    let mut d = combustion_def();
    d.drivetrain.transmission.gears.clear();
    assert!(d.validate().is_err());
    let mut d = combustion_def();
    if let PowerUnitDef::Combustion(c) = &mut d.drivetrain.power_unit {
        c.torque_curve = vec![[3000.0, 100.0], [2000.0, 100.0]];
    }
    assert!(d.validate().is_err());
    let mut d = combustion_def();
    d.drivetrain.rear.bias_drive = 0.5;
    assert!(d.validate().is_err());
    let mut d = combustion_def();
    d.drivetrain.center.front_torque_fraction = 1.0;
    assert!(d.validate().is_err());
}
