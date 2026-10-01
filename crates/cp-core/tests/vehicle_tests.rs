use cp_core::snapshot::Snapshottable;
use cp_core::telemetry as t;
use cp_core::vehicle::BicycleVehicle;
use cp_core::{VehicleDefinition, VehicleInput, World};

fn def() -> VehicleDefinition {
    VehicleDefinition::default()
}

fn drive(car: &mut BicycleVehicle, input: VehicleInput, seconds: f64) {
    let n = (seconds * 1000.0) as usize;
    for _ in 0..n {
        car.substep(0.001, &input);
    }
}

#[test]
fn definition_round_trips_through_json_with_defaults() {
    let d = def();
    let json = serde_json::to_string_pretty(&d).unwrap();
    assert!(json.contains("\"formatVersion\": 1"));
    let back: VehicleDefinition = serde_json::from_str(&json).unwrap();
    assert_eq!(back, d);
    // Partial definitions fill in defaults.
    let partial: VehicleDefinition =
        serde_json::from_str("{\"name\":\"x\",\"chassis\":{\"mass\":900}}").unwrap();
    assert_eq!(partial.chassis.mass, 900.0);
    assert_eq!(partial.chassis.wheelbase, 2.6);
    assert!(partial.validate().is_ok());
}

#[test]
fn validation_messages_are_readable() {
    let mut d = def();
    d.chassis.mass = -1.0;
    d.chassis.cg_to_front_axle = 5.0;
    let errs = d.validate().unwrap_err();
    assert!(errs
        .iter()
        .any(|e| e.starts_with("chassis.mass must be positive")));
    assert!(errs
        .iter()
        .any(|e| e.contains("cgToFrontAxle must lie between the axles")));
}

#[test]
fn car_at_rest_stays_at_rest() {
    let mut car = BicycleVehicle::new(def());
    drive(&mut car, VehicleInput::default(), 5.0);
    assert!(car.speed().abs() < 1e-9, "speed {}", car.speed());
    assert!(car.x.abs() < 1e-9 && car.y.abs() < 1e-9);
    assert_eq!(car.axles[0].omega, 0.0);
}

#[test]
fn full_throttle_accelerates_forward_and_brakes_stop_it() {
    let mut car = BicycleVehicle::new(def());
    drive(
        &mut car,
        VehicleInput {
            throttle: 1.0,
            ..Default::default()
        },
        5.0,
    );
    assert!(car.vx > 15.0, "vx after 5 s = {}", car.vx);
    assert!(
        car.vy.abs() < 1e-3,
        "straight line should not drift: vy = {}",
        car.vy
    );
    assert!(
        car.axles[1].transient.slip_ratio.abs() < 1e-2,
        "undriven rear should roll nearly freely (rolling resistance and wheel inertia only): {}",
        car.axles[1].transient.slip_ratio
    );
    let v0 = car.vx;
    drive(
        &mut car,
        VehicleInput {
            brake: 1.0,
            ..Default::default()
        },
        1.0,
    );
    assert!(
        car.vx < v0 - 5.0,
        "braking should slow it: {v0} -> {}",
        car.vx
    );
    drive(
        &mut car,
        VehicleInput {
            brake: 1.0,
            ..Default::default()
        },
        6.0,
    );
    assert!(car.vx.abs() < 0.05, "should come to rest: {}", car.vx);
    assert!(car.axles[0].locked || car.axles[0].omega.abs() < 1e-6);
}

#[test]
fn braked_wheel_stays_locked_without_chatter() {
    let mut car = BicycleVehicle::new(def());
    car.set_speed(20.0);
    let input = VehicleInput {
        brake: 1.0,
        ..Default::default()
    };
    let mut locked_steps = 0;
    let mut sign_flips = 0;
    let mut last = 0.0;
    for _ in 0..1500 {
        car.substep(0.001, &input);
        if car.axles[0].locked {
            locked_steps += 1;
        }
        let w = car.axles[0].omega;
        if w * last < 0.0 {
            sign_flips += 1;
        }
        last = w;
    }
    assert!(
        locked_steps > 1000,
        "front wheel should lock under full brake ({locked_steps})"
    );
    assert_eq!(sign_flips, 0, "wheel speed must not oscillate about zero");
}

#[test]
fn steering_right_turns_right() {
    let mut car = BicycleVehicle::new(def());
    car.set_speed(15.0);
    drive(
        &mut car,
        VehicleInput {
            steer: 0.3,
            throttle: 0.3,
            ..Default::default()
        },
        3.0,
    );
    assert!(
        car.yaw < -0.5,
        "yaw should go negative (clockwise) when steering right: {}",
        car.yaw
    );
    assert!(car.y < 0.0, "car should move toward -y: {}", car.y);
    assert!(car.axles[0].transient.slip_angle.abs() < 0.3);
}

#[test]
fn reversing_is_stable() {
    let mut car = BicycleVehicle::new(def());
    car.set_speed(-5.0);
    drive(
        &mut car,
        VehicleInput {
            steer: 0.5,
            ..Default::default()
        },
        4.0,
    );
    assert!(car.speed().is_finite());
    assert!(car.speed() < 5.0);
    assert!(car.vy.abs() < 2.0);
}

#[test]
fn ten_thousand_steps_twice_give_identical_state() {
    let run = || {
        let mut w = World::new(2);
        w.add_vehicle(def()).unwrap();
        let mut hashes = Vec::new();
        for i in 0..10_000u32 {
            let s = cp_math::sin((i as f64) * 0.01);
            w.set_input(
                0,
                VehicleInput {
                    steer: s * 0.5,
                    throttle: 0.6,
                    brake: 0.0,
                    handbrake: 0.0,
                },
            )
            .unwrap();
            w.step(1.0 / 60.0);
            if i % 1000 == 0 {
                hashes.push(w.state_hash(0).unwrap());
            }
        }
        (hashes, w.world_hash())
    };
    assert_eq!(run(), run());
}

#[test]
fn snapshot_restore_continue_matches_uninterrupted_run() {
    let mut a = World::new(1);
    a.add_vehicle(def()).unwrap();
    let mut b = World::new(1);
    b.add_vehicle(def()).unwrap();
    let input = VehicleInput {
        steer: 0.2,
        throttle: 0.8,
        brake: 0.0,
        handbrake: 0.0,
    };
    a.set_input(0, input).unwrap();
    b.set_input(0, input).unwrap();
    for _ in 0..300 {
        a.step(1.0 / 60.0);
        b.step(1.0 / 60.0);
    }
    let mut buf = vec![0u8; a.snapshot_len(0).unwrap()];
    let n = a.snapshot(0, &mut buf).unwrap();
    assert_eq!(n, buf.len());
    // Perturb b, then restore from a's snapshot.
    b.set_input(
        0,
        VehicleInput {
            steer: -1.0,
            throttle: 0.0,
            brake: 1.0,
            handbrake: 1.0,
        },
    )
    .unwrap();
    for _ in 0..100 {
        b.step(1.0 / 60.0);
    }
    b.restore(0, &buf).unwrap();
    b.set_input(0, input).unwrap();
    assert_eq!(a.state_hash(0).unwrap(), b.state_hash(0).unwrap());
    for _ in 0..600 {
        a.step(1.0 / 60.0);
        b.step(1.0 / 60.0);
    }
    assert_eq!(a.state_hash(0).unwrap(), b.state_hash(0).unwrap());
    assert_eq!(a.telemetry_of(0), b.telemetry_of(0));
}

#[test]
fn snapshot_rejects_garbage() {
    let mut w = World::new(1);
    w.add_vehicle(def()).unwrap();
    assert!(w.restore(0, b"nope").is_err());
    let mut buf = vec![0u8; w.snapshot_len(0).unwrap()];
    w.snapshot(0, &mut buf).unwrap();
    buf[5] = 9; // version
    assert!(w.restore(0, &buf).is_err());
}

#[test]
fn world_telemetry_matches_layout() {
    let mut w = World::new(3);
    w.add_vehicle(def()).unwrap();
    w.add_vehicle(def()).unwrap();
    w.set_input(
        1,
        VehicleInput {
            throttle: 1.0,
            ..Default::default()
        },
    )
    .unwrap();
    for _ in 0..120 {
        w.step(1.0 / 60.0);
    }
    let v0 = w.telemetry_of(0);
    let v1 = w.telemetry_of(1);
    assert_eq!(v0.len(), t::STRIDE);
    assert!(v0[t::SPEED].abs() < 1e-9);
    assert!(v1[t::SPEED] > 5.0);
    assert!((v1[t::TIME] - 2.0).abs() < 1e-9);
    assert_eq!(v1[t::THROTTLE], 1.0);
    assert!(
        v1[t::LOAD_R] > v1[t::LOAD_F] * 0.5,
        "load transfer to the rear under acceleration"
    );
    assert_eq!(w.len(), 2);
    assert!(w.add_vehicle(def()).is_ok());
    assert!(w.add_vehicle(def()).is_err(), "capacity exhausted");
}

#[test]
fn substep_rate_is_honoured_per_vehicle() {
    let mut d = def();
    d.simulation.substep_rate_hz = 240.0;
    let mut w = World::new(1);
    w.add_vehicle(d).unwrap();
    w.set_input(
        0,
        VehicleInput {
            throttle: 1.0,
            ..Default::default()
        },
    )
    .unwrap();
    for _ in 0..60 {
        w.step(1.0 / 60.0);
    }
    let v = w.telemetry_of(0);
    assert!((v[t::TIME] - 1.0).abs() < 1e-9);
    assert!(v[t::SPEED] > 3.0);
}

#[test]
fn state_hash_covers_transient_slip() {
    let mut car = BicycleVehicle::new(def());
    let mut scratch = vec![0.0; 64];
    let h0 = car.state_hash(&mut scratch);
    car.axles[0].transient.slip_angle = 0.01;
    assert_ne!(h0, car.state_hash(&mut scratch));
}
