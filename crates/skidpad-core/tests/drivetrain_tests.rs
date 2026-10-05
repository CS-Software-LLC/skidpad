//! Drivetrain behaviour (ADR-0011): launch, shifting, clutch lock and slip,
//! limited-slip and locked differentials, the centre split, electric drive,
//! the part-throttle shift schedule (ADR-0025), and the exact brake lock
//! with a driven wheel, on both vehicle models.

use skidpad_core::ai::AiConfig;
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
fn an_automatic_upshift_brings_the_engine_down_without_a_flare() {
    // Through the clutch re-engagement after an upshift the engine only
    // falls toward the new gear's speed: full throttle on a barely-bitten
    // clutch used to rev it back up to near the shift point first.
    let mut w = World::new(1);
    w.add_vehicle(combustion_def()).unwrap();
    w.set_input(0, throttle(1.0)).unwrap();
    let mut gear = 0;
    let mut since_shift = f64::INFINITY;
    let mut prev_rpm = 0.0;
    let mut upshifts = 0;
    for _ in 0..1500 {
        w.step(0.01);
        let v = w.telemetry_of(0);
        let g = v[t::GEAR] as i32;
        if g > gear && gear > 0 {
            since_shift = 0.0;
            upshifts += 1;
        }
        gear = g;
        if since_shift < 0.5 && v[t::CLUTCH_SLIP].abs() > 1.0 {
            assert!(
                v[t::ENGINE_RPM] <= prev_rpm + 1.0,
                "gear {g}: {prev_rpm} -> {} rpm with the clutch slipping",
                v[t::ENGINE_RPM]
            );
        }
        since_shift += 0.01;
        prev_rpm = v[t::ENGINE_RPM];
    }
    assert!(upshifts >= 2, "{upshifts} upshifts");
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
fn an_automatic_without_reverse_treats_a_reverse_request_as_neutral() {
    let mut d = combustion_def();
    d.drivetrain.transmission.reverse = 0.0;
    for model in [VehicleModelKind::FourWheel, VehicleModelKind::SingleTrack] {
        d.simulation.model = model;
        let mut w = World::new(1);
        w.add_vehicle(d.clone()).unwrap();
        let reverse = VehicleInput {
            throttle: 1.0,
            gear: -1.0,
            ..VehicleInput::default()
        };
        drive(&mut w, reverse, 3.0);
        let v = w.telemetry_of(0);
        assert_eq!(v[t::GEAR], 0.0, "{model:?}");
        assert!(
            v[t::VEL_X].abs() < 0.05,
            "{model:?} moved at {} m/s",
            v[t::VEL_X]
        );
        // Asking for drive again engages first.
        drive(&mut w, throttle(1.0), 2.0);
        let v = w.telemetry_of(0);
        assert!(v[t::GEAR] >= 1.0, "{model:?}");
        assert!(v[t::VEL_X] > 1.0, "{model:?}");
    }
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
    for factor in [0.0, 1.1] {
        let mut d = combustion_def();
        d.drivetrain.transmission.shift_light_factor = factor;
        assert!(d.validate().is_err());
    }
}

#[test]
fn the_shift_timer_marks_every_shift_on_both_models() {
    for model in [VehicleModelKind::FourWheel, VehicleModelKind::SingleTrack] {
        let mut d = combustion_def();
        d.simulation.model = model;
        let t_shift = d.drivetrain.transmission.shift_time + d.drivetrain.transmission.shift_hold;
        let mut w = World::new(1);
        w.add_vehicle(d).unwrap();
        w.set_input(0, throttle(1.0)).unwrap();
        let (mut gear, mut timer) = (
            w.telemetry_of(0)[t::GEAR],
            w.telemetry_of(0)[t::SHIFT_TIMER],
        );
        assert_eq!(timer, 0.0, "{model:?}: no shift at rest");
        let mut shifts = 0;
        for k in 0..1500 {
            w.step(0.01);
            let v = w.telemetry_of(0);
            let rose = v[t::SHIFT_TIMER] > timer;
            assert_eq!(rose, v[t::GEAR] != gear, "{model:?}: step {k}");
            if rose {
                shifts += 1;
                // Set at the substep the gear engaged, at most one frame ago.
                assert!(
                    v[t::SHIFT_TIMER] > t_shift - 0.01 && v[t::SHIFT_TIMER] <= t_shift,
                    "{model:?}: {}",
                    v[t::SHIFT_TIMER]
                );
            }
            assert!(v[t::SHIFT_TIMER] >= 0.0);
            (gear, timer) = (v[t::GEAR], v[t::SHIFT_TIMER]);
        }
        assert!(shifts >= 3, "{model:?}: {shifts} shifts");
    }
}

#[test]
fn the_rev_limiter_channel_reads_the_cut_at_the_limiter_only() {
    let mut d = combustion_def();
    d.drivetrain.transmission.mode = TransmissionMode::Manual;
    let mut w = World::new(1);
    w.add_vehicle(d).unwrap();
    assert_eq!(w.telemetry_of(0)[t::REV_LIMITER], 0.0);
    // Neutral: full throttle holds the engine on the limiter.
    drive(&mut w, throttle(1.0), 3.0);
    let cut = w.telemetry_of(0)[t::REV_LIMITER];
    let rpm = w.telemetry_of(0)[t::ENGINE_RPM];
    assert!(cut > 0.0 && cut <= 1.0, "{cut} at {rpm} rpm");
    let expected = m::clamp((rpm - 6500.0) / (0.02 * 6500.0), 0.0, 1.0);
    assert!((cut - expected).abs() < 1e-9, "{cut} vs {expected}");
    drive(&mut w, throttle(0.0), 5.0);
    assert_eq!(w.telemetry_of(0)[t::REV_LIMITER], 0.0);
    // No combustion engine, no limiter.
    let mut w = World::new(1);
    w.add_vehicle(electric_def()).unwrap();
    drive(&mut w, throttle(1.0), 5.0);
    assert_eq!(w.telemetry_of(0)[t::REV_LIMITER], 0.0);
}

#[test]
fn the_shift_timer_follows_a_restore() {
    let d = combustion_def();
    let mut a = World::new(1);
    a.add_vehicle(d.clone()).unwrap();
    let mut b = World::new(1);
    b.add_vehicle(d).unwrap();
    a.set_input(0, throttle(1.0)).unwrap();
    // Stop just after the first shift, with the timer running.
    while a.telemetry_of(0)[t::SHIFT_TIMER] == 0.0 {
        a.step(0.01);
    }
    let mut buf = vec![0u8; a.snapshot_len(0).unwrap()];
    a.snapshot(0, &mut buf).unwrap();
    b.restore(0, &buf).unwrap();
    assert!(b.telemetry_of(0)[t::SHIFT_TIMER] > 0.0);
    assert_eq!(
        a.telemetry_of(0)[t::SHIFT_TIMER],
        b.telemetry_of(0)[t::SHIFT_TIMER]
    );
}

#[test]
fn sound_metadata_is_validated_and_never_simulated() {
    for f in [-1.0, 17.0, f64::NAN] {
        let mut d = combustion_def();
        d.sound.firings_per_rev = f;
        let err = d.validate().unwrap_err();
        assert!(
            err.iter()
                .any(|e| e.starts_with("sound.firingsPerRev must be between 0 and 16")),
            "{err:?}"
        );
    }
    let quiet = combustion_def();
    let mut loud = combustion_def();
    loud.sound.firings_per_rev = 3.0;
    loud.validate().unwrap();
    let (mut a, mut b) = (World::new(1), World::new(1));
    a.add_vehicle(quiet).unwrap();
    b.add_vehicle(loud).unwrap();
    drive(&mut a, throttle(1.0), 5.0);
    drive(&mut b, throttle(1.0), 5.0);
    assert_eq!(a.state_hash(0).unwrap(), b.state_hash(0).unwrap());
}

/// Speed after coasting 10 s from 25 m/s in drive with the throttle closed.
fn coast_speed(d: VehicleDefinition) -> (f64, Vec<f64>) {
    let mut w = World::new(1);
    w.add_vehicle(d).unwrap();
    w.vehicle_mut(0).unwrap().model.set_speed(25.0);
    w.set_input(0, VehicleInput::default()).unwrap();
    for _ in 0..1000 {
        w.step(0.01);
    }
    let v = w.telemetry_of(0).to_vec();
    (v[t::SPEED], v)
}

fn with_braking_curve(curve: Vec<[f64; 2]>) -> VehicleDefinition {
    let mut d = combustion_def();
    if let PowerUnitDef::Combustion(c) = &mut d.drivetrain.power_unit {
        c.engine_braking_curve = curve;
    }
    d
}

#[test]
fn an_engine_braking_curve_through_the_line_matches_the_line() {
    let c = CombustionEngineDef::default();
    let line = with_braking_curve(Vec::new());
    let curve = with_braking_curve(vec![
        [c.idle_rpm, c.engine_braking_idle],
        [c.redline_rpm, c.engine_braking_redline],
    ]);
    let (a, va) = coast_speed(line);
    let (b, _) = coast_speed(curve);
    // The engine is engaged and dragging, so the comparison means something.
    assert!(
        va[t::ENGINE_RPM] > 1.2 * c.idle_rpm,
        "{}",
        va[t::ENGINE_RPM]
    );
    assert!(va[t::ENGINE_TORQUE] < -1.0, "{}", va[t::ENGINE_TORQUE]);
    assert!((a - b).abs() < 1e-6 * a, "{a} vs {b}");
}

#[test]
fn an_engine_braking_curve_sets_the_closed_throttle_drag() {
    let curve = vec![[1000.0, 5.0], [3000.0, 10.0], [6000.0, 80.0]];
    let (_, v) = coast_speed(with_braking_curve(curve.clone()));
    let rpm = v[t::ENGINE_RPM];
    let k = curve.iter().position(|p| p[0] >= rpm).unwrap();
    let (p0, p1) = (curve[k - 1], curve[k]);
    let drag = p0[1] + (p1[1] - p0[1]) * (rpm - p0[0]) / (p1[0] - p0[0]);
    assert!(
        (v[t::ENGINE_TORQUE] + drag).abs() < 0.02 * drag,
        "torque {} at {rpm} rpm, drag {drag}",
        v[t::ENGINE_TORQUE]
    );
    // More drag than the gentle default line at these revs coasts down sooner.
    let (plain, _) = coast_speed(with_braking_curve(Vec::new()));
    let (strong, _) = coast_speed(with_braking_curve(vec![[1000.0, 40.0], [6000.0, 120.0]]));
    assert!(strong < plain - 0.2, "{strong} vs {plain}");
}

#[test]
fn bad_engine_braking_curves_are_rejected() {
    assert!(with_braking_curve(vec![[3000.0, 10.0], [2000.0, 20.0]])
        .validate()
        .is_err());
    assert!(with_braking_curve(vec![[3000.0, -10.0]])
        .validate()
        .is_err());
    assert!(with_braking_curve(vec![[3000.0, 10.0]]).validate().is_ok());
}

// ------------------------------------------- part-throttle schedule ----

fn hatchback(model: VehicleModelKind) -> VehicleDefinition {
    let mut d: VehicleDefinition = serde_json::from_str(include_str!(
        "../../../packages/presets/src/vehicles/hatchback-fwd.json"
    ))
    .unwrap();
    d.simulation.model = model;
    d
}

/// The schedule before ADR-0025: the full-throttle points at any throttle.
fn fixed_schedule(mut d: VehicleDefinition) -> VehicleDefinition {
    d.drivetrain.transmission.shift_light_factor = 1.0;
    d
}

/// `(step, new gear, speed)` at every gear change over `steps` 10 ms steps
/// of `input`.
fn gear_changes(d: VehicleDefinition, input: VehicleInput, steps: usize) -> Vec<(usize, i32, f64)> {
    let mut w = World::new(1);
    w.add_vehicle(d).unwrap();
    w.set_input(0, input).unwrap();
    let mut gear = w.telemetry_of(0)[t::GEAR] as i32;
    let mut changes = Vec::new();
    for k in 0..steps {
        w.step(0.01);
        let v = w.telemetry_of(0);
        if v[t::GEAR] as i32 != gear {
            gear = v[t::GEAR] as i32;
            changes.push((k, gear, v[t::SPEED]));
        }
    }
    changes
}

#[test]
fn the_shift_points_meet_the_full_throttle_points_and_keep_their_hysteresis() {
    for file in [
        include_str!("../../../packages/presets/src/vehicles/hatchback-fwd.json"),
        include_str!("../../../packages/presets/src/vehicles/sports-rwd.json"),
        include_str!("../../../packages/presets/src/vehicles/pickup-4x4.json"),
        include_str!("../../../packages/presets/src/vehicles/open-wheeler.json"),
    ] {
        let def: VehicleDefinition = serde_json::from_str(file).unwrap();
        let d = Drivetrain::new(def.drivetrain, [true, false], 4);
        let t = &d.definition().transmission;
        let n = t.gears.len() as i32;
        for g in 1..n {
            assert_eq!(d.upshift_point(g, 1.0), t.shift_up_at);
            let step = d.ratio(g) / d.ratio(g + 1);
            for k in 0..=20 {
                let pedal = k as f64 / 20.0;
                let up = d.upshift_point(g, pedal);
                assert!(up <= t.shift_up_at && up >= t.shift_light_factor * t.shift_up_at);
                // After the upshift the input sits clear of the downshift
                // point, at the throttle the taller gear needs for the same
                // wheel torque, and so also at this throttle.
                let landed = up / step;
                let after = m::min(pedal * step, 1.0);
                assert!(
                    landed >= 1.15 * d.downshift_point(after) - 1e-12,
                    "gear {g} pedal {pedal}: lands at {landed}"
                );
                assert!(landed > d.downshift_point(pedal));
            }
        }
        assert_eq!(d.downshift_point(1.0), t.shift_down_at);
        assert_eq!(
            d.downshift_point(0.0),
            t.shift_light_factor * t.shift_down_at
        );
        // Kickdown: the downshift point rises with the pedal.
        assert!(d.downshift_point(0.5) > d.downshift_point(0.2));
    }
}

#[test]
fn a_part_throttle_cruise_upshifts_on_both_models() {
    // F-25: the AI holding 12 m/s used to sit in first at about 5,560 rpm
    // and a throttle of 0.23 on either model, because the automatic only
    // upshifted at 90 % of redline whatever the throttle.
    let mut rpm = Vec::new();
    for model in [VehicleModelKind::FourWheel, VehicleModelKind::SingleTrack] {
        let mut w = World::new(1);
        w.add_vehicle(hatchback(model)).unwrap();
        let cfg = AiConfig {
            max_speed: 12.0,
            closed: false,
            ..AiConfig::default()
        };
        w.set_ai(0, &[0.0, 0.0, 5000.0, 0.0], cfg).unwrap();
        let mut gear = 1;
        let mut shifts = 0;
        for k in 0..(60 * 40) {
            w.step(1.0 / 60.0);
            let v = w.telemetry_of(0);
            if v[t::GEAR] as i32 != gear {
                gear = v[t::GEAR] as i32;
                shifts += 1;
                assert!(k < 60 * 10, "{model:?}: shift to {gear} at {k} cruising");
            }
        }
        let v = w.telemetry_of(0);
        assert!(
            (v[t::SPEED] - 12.0).abs() < 0.2,
            "{model:?}: {} m/s",
            v[t::SPEED]
        );
        assert_eq!(gear, 2, "{model:?}");
        assert_eq!(shifts, 1, "{model:?}: hunting");
        assert!(
            v[t::ENGINE_RPM] < 3500.0,
            "{model:?}: {} rpm",
            v[t::ENGINE_RPM]
        );
        assert!(v[t::THROTTLE] < 0.5, "{model:?}");
        rpm.push(v[t::ENGINE_RPM]);
    }
    assert!((rpm[0] - rpm[1]).abs() < 20.0, "models disagree: {rpm:?}");
}

#[test]
fn full_throttle_shifts_at_the_same_speeds_as_before() {
    // Upshift speeds of the hatchback from rest at full throttle before
    // the part-throttle schedule, m/s.
    let before = [
        (
            VehicleModelKind::FourWheel,
            [11.8045, 22.3346, 34.3611, 45.5481],
        ),
        (
            VehicleModelKind::SingleTrack,
            [11.8618, 22.3254, 34.3760, 45.5576],
        ),
    ];
    for (model, speeds) in before {
        let changes = gear_changes(hatchback(model), throttle(1.0), 3000);
        assert_eq!(
            changes,
            gear_changes(fixed_schedule(hatchback(model)), throttle(1.0), 3000),
            "{model:?}"
        );
        let gears: Vec<i32> = changes.iter().map(|c| c.1).collect();
        assert_eq!(gears, [2, 3, 4, 5], "{model:?}");
        for (c, v) in changes.iter().zip(speeds) {
            assert!(
                (c.2 - v).abs() < 1e-3,
                "{model:?}: gear {} at {} m/s, was {v}",
                c.1,
                c.2
            );
        }
    }
}

#[test]
fn flooring_the_pedal_kicks_down_from_a_part_throttle_gear() {
    for model in [VehicleModelKind::FourWheel, VehicleModelKind::SingleTrack] {
        let mut w = World::new(1);
        w.add_vehicle(hatchback(model)).unwrap();
        let cfg = AiConfig {
            max_speed: 9.0,
            closed: false,
            ..AiConfig::default()
        };
        w.set_ai(0, &[0.0, 0.0, 5000.0, 0.0], cfg).unwrap();
        for _ in 0..(60 * 30) {
            w.step(1.0 / 60.0);
        }
        // Second gear at about 35 % of redline, below the full-throttle
        // downshift point of 42 %.
        assert_eq!(w.telemetry_of(0)[t::GEAR] as i32, 2, "{model:?}");
        w.clear_ai(0).unwrap();
        w.set_input(0, throttle(1.0)).unwrap();
        let mut kicked = false;
        for _ in 0..20 {
            w.step(0.01);
            kicked |= w.telemetry_of(0)[t::GEAR] as i32 == 1;
        }
        assert!(kicked, "{model:?}: no kickdown");
    }
}

#[test]
fn lifting_upshifts_but_lifting_to_brake_does_not() {
    for model in [VehicleModelKind::FourWheel, VehicleModelKind::SingleTrack] {
        for brake in [0.0, 0.5] {
            let mut w = World::new(1);
            w.add_vehicle(hatchback(model)).unwrap();
            w.set_input(0, throttle(1.0)).unwrap();
            // Full throttle to 19 m/s: second gear at about 80 % of redline,
            // well past the shift hold.
            while w.telemetry_of(0)[t::SPEED] < 19.0 {
                w.step(0.01);
            }
            assert_eq!(w.telemetry_of(0)[t::GEAR] as i32, 2, "{model:?}");
            w.set_input(
                0,
                VehicleInput {
                    brake,
                    ..VehicleInput::default()
                },
            )
            .unwrap();
            let mut top = 2;
            for _ in 0..50 {
                w.step(0.01);
                top = top.max(w.telemetry_of(0)[t::GEAR] as i32);
            }
            if brake > 0.0 {
                assert_eq!(top, 2, "{model:?}: upshifted under braking");
            } else {
                assert_eq!(top, 3, "{model:?}: no upshift on lift");
            }
        }
    }
}
