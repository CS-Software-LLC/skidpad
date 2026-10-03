use skidpad_core::definition::VehicleModelKind;
use skidpad_core::geom::{Quat, Vec3};
use skidpad_core::snapshot::Snapshottable;
use skidpad_core::telemetry as t;
use skidpad_core::validation::{understeer, UndersteerConfig};
use skidpad_core::vehicle::{FourWheelVehicle, HostMode, WheelContact, FL, FR, RL, RR};
use skidpad_core::world::{HOST_CONTACT_STRIDE, HOST_IN_BODY_LEN, HOST_IN_STRIDE, HOST_OUT_STRIDE};
use skidpad_core::{VehicleDefinition, VehicleInput, World, GRAVITY};

fn def() -> VehicleDefinition {
    VehicleDefinition::default()
}

fn drive(car: &mut FourWheelVehicle, input: VehicleInput, seconds: f64) {
    let n = (seconds * 1000.0) as usize;
    for _ in 0..n {
        car.substep(0.001, &input);
    }
}

fn loads(car: &FourWheelVehicle) -> [f64; 4] {
    [
        car.wheels[FL].load,
        car.wheels[FR].load,
        car.wheels[RL].load,
        car.wheels[RR].load,
    ]
}

#[test]
fn suspension_contacts_stay_on_the_finite_forward_ray() {
    for mode in [HostMode::Builtin, HostMode::External] {
        let ray_length = FourWheelVehicle::new(def()).geometry()[FL].ray_length;
        for distance in [
            -1000.0,
            -1e-6,
            0.0,
            0.05,
            0.2,
            ray_length,
            ray_length + 1e-6,
        ] {
            let mut car = FourWheelVehicle::new(def());
            car.host_mode = mode;
            car.contacts = [WheelContact::none(); 4];
            let g = car.geometry()[FL];
            let origin = car.pos + g.ray_origin;
            car.contacts[FL] = WheelContact {
                point: origin + Vec3::new(0.0, 0.0, -distance),
                ..WheelContact::flat_ground()
            };
            car.substep(1.0 / 240.0, &VehicleInput::default());
            let w = &car.wheels[FL];
            let expected = distance >= 0.0 && distance <= g.ray_length;
            assert_eq!(w.in_contact, expected, "{mode:?}: {distance}");
            if expected {
                assert!((w.contact_point - origin).length() <= g.ray_length);
                // Bump-stop compression inside the ray remains supported.
                assert!(w.load > 0.0);
            } else {
                assert_eq!(w.load, 0.0);
                assert_eq!(w.susp_force, 0.0);
                assert_eq!(w.travel_rate, 0.0);
                assert_eq!(car.impulse, Vec3::ZERO);
                assert_eq!(car.angular_impulse, Vec3::ZERO);
            }
        }
    }
}

#[test]
fn tipped_below_ground_cannot_contact_a_plane_behind_the_strut() {
    for mode in [HostMode::Builtin, HostMode::External] {
        let mut car = FourWheelVehicle::new(def());
        car.host_mode = mode;
        car.pos.z = -10.0;
        car.orient = Quat::from_yaw_pitch_roll(0.0, skidpad_math::FRAC_PI_2 - 0.001, 0.0);
        car.substep(1.0 / 240.0, &VehicleInput::default());
        assert!(car.wheels.iter().all(|w| !w.in_contact && w.load == 0.0));
        assert_eq!(car.impulse, Vec3::ZERO);
        assert_eq!(car.angular_impulse, Vec3::ZERO);
        assert_eq!(car.omega, Vec3::ZERO);
    }
}

#[test]
fn rests_at_ride_height_with_static_loads() {
    let d = def();
    let mut car = FourWheelVehicle::new(d.clone());
    drive(&mut car, VehicleInput::default(), 3.0);
    assert!(car.speed() < 1e-9, "speed {}", car.speed());
    assert!(
        (car.pos.z - d.chassis.cg_height).abs() < 1e-6,
        "ride height {}",
        car.pos.z
    );
    let (_, pitch, roll) = car.orient.to_yaw_pitch_roll();
    assert!(pitch.abs() < 1e-6 && roll.abs() < 1e-6);
    let l = loads(&car);
    let mg = d.chassis.mass * GRAVITY;
    assert!((l.iter().sum::<f64>() - mg).abs() < 1.0, "{l:?}");
    assert!((l[FL] - d.static_wheel_load(0)).abs() < 1.0);
    assert!((l[RR] - d.static_wheel_load(1)).abs() < 1.0);
    for w in &car.wheels {
        assert!(w.in_contact);
        assert!(w.travel.abs() < 1e-6, "travel {}", w.travel);
    }
}

#[test]
fn dropped_car_settles_without_bouncing_forever() {
    let d = def();
    let mut car = FourWheelVehicle::new(d.clone());
    car.pos.z += 0.05;
    let mut max_rate: f64 = 0.0;
    for _ in 0..4000 {
        car.substep(0.001, &VehicleInput::default());
        max_rate = max_rate.max(car.wheels[FL].travel_rate.abs());
        assert!(car.pos.is_finite());
    }
    assert!(max_rate > 0.1, "the drop should compress the suspension");
    assert!(
        (car.pos.z - d.chassis.cg_height).abs() < 2e-3,
        "settled height {}",
        car.pos.z
    );
    assert!(car.vel.length() < 1e-3, "residual velocity {:?}", car.vel);
}

#[test]
fn nudged_car_at_rest_comes_back_to_rest() {
    let mut car = FourWheelVehicle::new(def());
    car.vel = Vec3::new(0.3, 0.1, 0.0);
    // A free-rolling car coasts; only rolling resistance slows it below the
    // speed floor. What must not happen is ringing or growth.
    let mut peak: f64 = 0.0;
    for _ in 0..6000 {
        car.substep(0.001, &VehicleInput::default());
        peak = peak.max(car.speed());
    }
    assert!(peak < 0.35, "speed must not grow after a nudge: {peak}");
    assert!(car.speed() < 0.15, "residual speed {}", car.speed());
    assert!(
        car.vel.y.abs() < 1e-3,
        "lateral motion is held by the tires: {}",
        car.vel.y
    );
    let mut last = car.vel.x;
    let mut flips = 0;
    for _ in 0..2000 {
        car.substep(0.001, &VehicleInput::default());
        if car.vel.x * last < 0.0 && car.vel.x.abs() > 1e-4 {
            flips += 1;
        }
        last = car.vel.x;
    }
    assert!(flips <= 2, "car oscillates at rest ({flips} sign flips)");
}

#[test]
fn steady_cornering_transfers_load_to_the_outside() {
    let d = def();
    let mut car = FourWheelVehicle::new(d.clone());
    car.set_speed(15.0);
    drive(
        &mut car,
        VehicleInput {
            steer: 0.15,
            throttle: 0.25,
            ..Default::default()
        },
        5.0,
    );
    // Steering right: lateral acceleration toward −y, load moves to the
    // left (outer) wheels, body rolls toward the outside.
    let ay = car.accel_body.y;
    assert!(ay < -2.0, "lateral accel {ay}");
    let l = loads(&car);
    let delta = (l[FL] + l[RL]) - (l[FR] + l[RR]);
    assert!(delta > 0.0, "outer wheels should carry more: {l:?}");
    // Total transfer across the track balances the roll moment of the
    // lateral force at the centre-of-mass height (Milliken ch. 18).
    let expected = d.chassis.mass * ay.abs() * d.chassis.cg_height / (0.5 * d.chassis.track_width);
    assert!(
        (delta - expected).abs() < 0.2 * expected,
        "transfer {delta} vs m a h / (t/2) = {expected}"
    );
    let (_, _, roll) = car.orient.to_yaw_pitch_roll();
    assert!(roll < -0.005, "body should roll toward the outside: {roll}");
    assert!(car.yaw_rate() < 0.0, "yaw rate should be clockwise");
    // Front and rear transfer split follows roll stiffness: the stiffer
    // front (higher spring and bar rates) takes the larger share.
    let front = l[FL] - l[FR];
    let rear = l[RL] - l[RR];
    assert!(front > rear, "front {front} rear {rear}");
}

#[test]
fn dives_under_braking_and_squats_under_power() {
    let mut car = FourWheelVehicle::new(def());
    drive(
        &mut car,
        VehicleInput {
            throttle: 1.0,
            ..Default::default()
        },
        2.0,
    );
    let (_, pitch, _) = car.orient.to_yaw_pitch_roll();
    assert!(pitch < -0.003, "squat should lift the nose: pitch {pitch}");
    let l = loads(&car);
    assert!(l[RL] + l[RR] > l[FL] + l[FR] * 0.9);
    drive(
        &mut car,
        VehicleInput {
            brake: 1.0,
            ..Default::default()
        },
        0.8,
    );
    let (_, pitch, _) = car.orient.to_yaw_pitch_roll();
    assert!(pitch > 0.005, "dive should drop the nose: pitch {pitch}");
    assert!(car.wheels[FL].travel > 0.0 && car.wheels[RL].travel < 0.0);
}

#[test]
fn handbrake_locks_only_the_rear_wheels() {
    let mut d = def();
    d.brakes.handbrake_torque = 4000.0;
    let mut car = FourWheelVehicle::new(d);
    car.set_speed(12.0);
    drive(
        &mut car,
        VehicleInput {
            handbrake: 1.0,
            ..Default::default()
        },
        1.0,
    );
    assert!(car.wheels[RL].locked && car.wheels[RR].locked);
    assert!(!car.wheels[FL].locked && car.wheels[FL].omega > 10.0);
}

#[test]
fn ackermann_steers_the_inner_wheel_more() {
    let mut car = FourWheelVehicle::new(def());
    car.substep(
        0.001,
        &VehicleInput {
            steer: 0.6,
            ..Default::default()
        },
    );
    let fl = car.wheels[FL].steer;
    let fr = car.wheels[FR].steer;
    assert!(
        fl < 0.0 && fr < 0.0,
        "steering right is a negative angle: {fl} {fr}"
    );
    assert!(
        fr.abs() > fl.abs() + 0.01,
        "inner (right) wheel {fr} vs outer {fl}"
    );
    assert_eq!(car.wheels[RL].steer, 0.0);
    let mut d = def();
    d.steering.ackermann = 0.0;
    let mut parallel = FourWheelVehicle::new(d);
    parallel.substep(
        0.001,
        &VehicleInput {
            steer: 0.6,
            ..Default::default()
        },
    );
    assert!((parallel.wheels[FL].steer - parallel.wheels[FR].steer).abs() < 1e-12);
}

#[test]
fn four_wheel_understeer_matches_single_track_in_the_linear_range() {
    let d = def();
    let cfg = UndersteerConfig {
        speeds: vec![4.0, 6.0, 8.0],
        ..UndersteerConfig::default()
    };
    let four = understeer::run(&d, &cfg).unwrap();
    let mut single_def = d.clone();
    single_def.simulation.model = VehicleModelKind::SingleTrack;
    let single = understeer::run(&single_def, &cfg).unwrap();
    assert!(four.gradient_deg_per_g > 0.0);
    assert!(
        (four.gradient_deg_per_g - single.gradient_deg_per_g).abs() < 0.4,
        "four-wheel {} vs single-track {} deg/g",
        four.gradient_deg_per_g,
        single.gradient_deg_per_g
    );
    assert!((four.fitted_intercept - four.ackermann_angle).abs() < 0.01);
}

#[test]
fn airborne_wheels_carry_no_load_and_report_only_drag() {
    let mut w = World::new(1);
    w.add_vehicle(def()).unwrap();
    w.set_host_mode(0, HostMode::External).unwrap();
    {
        let rec = &mut w.host_in_mut()[..HOST_IN_STRIDE];
        rec[2] = 5.0; // five metres up
        for k in 0..4 {
            rec[HOST_IN_BODY_LEN + k * HOST_CONTACT_STRIDE] = 0.0; // no hit
        }
    }
    w.step(0.5);
    let v = w.telemetry_of(0);
    for k in 0..4 {
        assert_eq!(v[t::LOAD_FL + k], 0.0);
        assert_eq!(v[t::WHEEL_CONTACT_FL + k], 0.0);
    }
    let out = &w.host_out()[..HOST_OUT_STRIDE];
    assert!(
        out[0].abs() < 1e-9 && out[1].abs() < 1e-9,
        "no planar impulse"
    );
    assert!(out[2].abs() < 2.0, "only aero drag on the fall: {}", out[2]);
    let car = w.vehicle(0).unwrap().model.as_four_wheel().unwrap();
    assert!(
        (car.vel.z + GRAVITY * 0.5).abs() < 0.01,
        "free fall: {}",
        car.vel.z
    );
}

#[test]
fn external_host_impulse_equals_builtin_velocity_change() {
    let mut builtin = World::new(1);
    builtin.add_vehicle(def()).unwrap();
    let mut external = World::new(1);
    external.add_vehicle(def()).unwrap();
    external.set_host_mode(0, HostMode::External).unwrap();
    let input = VehicleInput {
        steer: 0.3,
        throttle: 0.8,
        ..Default::default()
    };
    builtin.set_input(0, input).unwrap();
    external.set_input(0, input).unwrap();
    let dt = 1.0 / 60.0;
    let mass = def().chassis.mass;
    for _ in 0..180 {
        // Copy the built-in vehicle's state into the external host record,
        // as an adapter would from its rigid body.
        let (pos, orient, vel, angvel) = {
            let c = builtin.vehicle(0).unwrap().model.as_four_wheel().unwrap();
            (c.pos, c.orient, c.vel, c.orient.rotate(c.omega))
        };
        {
            let rec = &mut external.host_in_mut()[..HOST_IN_STRIDE];
            rec[0] = pos.x;
            rec[1] = pos.y;
            rec[2] = pos.z;
            rec[3] = orient.x;
            rec[4] = orient.y;
            rec[5] = orient.z;
            rec[6] = orient.w;
            rec[7] = vel.x;
            rec[8] = vel.y;
            rec[9] = vel.z;
            rec[10] = angvel.x;
            rec[11] = angvel.y;
            rec[12] = angvel.z;
            for k in 0..4 {
                let o = HOST_IN_BODY_LEN + k * HOST_CONTACT_STRIDE;
                rec[o] = 1.0;
                rec[o + 6] = 1.0;
            }
        }
        builtin.step(dt);
        external.step(dt);
        let b = builtin.vehicle(0).unwrap().model.as_four_wheel().unwrap();
        let e = external.vehicle(0).unwrap().model.as_four_wheel().unwrap();
        // Same state in, same substeps: the proxies agree up to the rounding
        // of the world ↔ body angular-velocity round trip.
        assert!((b.vel - e.vel).length() < 1e-12);
        assert!((b.omega - e.omega).length() < 1e-12);
        // The reported impulse plus gravity accounts for the velocity change.
        let out = &external.host_out()[..HOST_OUT_STRIDE];
        let dv = b.vel - vel;
        let predicted =
            Vec3::new(out[0], out[1], out[2]) * (1.0 / mass) + Vec3::new(0.0, 0.0, -GRAVITY * dt);
        assert!(
            (dv - predicted).length() < 1e-9,
            "dv {dv:?} vs {predicted:?}"
        );
    }
    let b = builtin.vehicle(0).unwrap().model.as_four_wheel().unwrap();
    assert!(b.speed() > 5.0);
}

#[test]
fn moving_platform_drags_the_car_along() {
    let mut car = FourWheelVehicle::new(def());
    car.host_mode = HostMode::External;
    for c in &mut car.contacts {
        *c = WheelContact {
            surface_velocity: Vec3::new(2.0, 0.0, 0.0),
            ..WheelContact::flat_ground()
        };
    }
    car.begin_host_step(car.pos, car.orient, car.vel, Vec3::ZERO);
    // Free wheels spin up on the belt like a dyno roller; only rolling
    // resistance drags the body along.
    drive(&mut car, VehicleInput::default(), 2.0);
    assert!(car.impulse.x > 100.0, "impulse {:?}", car.impulse);
    assert!(
        car.wheels[FL].omega < -1.0,
        "wheels roll backward on the belt"
    );
    assert!(
        car.vel.x > 0.1 && car.vel.x < 1.0,
        "coasting: {}",
        car.vel.x
    );
    // With the brakes on the car is carried with the belt.
    drive(
        &mut car,
        VehicleInput {
            brake: 1.0,
            ..Default::default()
        },
        3.0,
    );
    assert!((car.vel.x - 2.0).abs() < 0.05, "carried: {}", car.vel.x);
}

#[test]
fn switching_host_mode_back_resets_the_pose() {
    let mut w = World::new(1);
    w.add_vehicle(def()).unwrap();
    w.set_host_mode(0, HostMode::External).unwrap();
    w.host_in_mut()[2] = 50.0;
    w.step(1.0 / 60.0);
    assert!(w.telemetry_of(0)[t::POS_Z] > 40.0);
    w.set_host_mode(0, HostMode::Builtin).unwrap();
    assert_eq!(w.host_mode(0).unwrap(), HostMode::Builtin);
    w.step(1.0 / 60.0);
    assert!((w.telemetry_of(0)[t::POS_Z] - def().chassis.cg_height).abs() < 1e-3);
    // The single-track model has no host sync.
    let mut d = def();
    d.simulation.model = VehicleModelKind::SingleTrack;
    let mut w2 = World::new(1);
    w2.add_vehicle(d).unwrap();
    assert!(w2.set_host_mode(0, HostMode::External).is_err());
    assert!(w2.wheel_rays(0, &mut [0.0; 32]).is_err());
}

#[test]
fn wheel_rays_describe_the_geometry() {
    let d = def();
    let mut w = World::new(1);
    w.add_vehicle(d.clone()).unwrap();
    let mut out = [0.0; 32];
    assert_eq!(w.wheel_rays(0, &mut out).unwrap(), 32);
    let r = d.axles[0].tire.unloaded_radius();
    let s = &d.axles[0].suspension;
    assert!((out[0] - d.chassis.cg_to_front_axle).abs() < 1e-12);
    assert!((out[1] - 0.5 * d.chassis.track_width).abs() < 1e-12);
    assert!((out[2] - (r - d.chassis.cg_height + s.travel_bump)).abs() < 1e-12);
    assert_eq!(out[5], -1.0);
    assert!((out[6] - (r + s.travel_bump + s.travel_droop)).abs() < 1e-12);
    assert_eq!(out[7], r);
    assert!(out[9] < 0.0, "front-right is on −y");
    assert!(out[16] < 0.0, "rear-left is behind the centre of mass");
}

#[test]
fn snapshot_restores_pose_and_wheels() {
    let mut w = World::new(1);
    w.add_vehicle(def()).unwrap();
    w.set_input(
        0,
        VehicleInput {
            steer: -0.4,
            throttle: 0.9,
            ..Default::default()
        },
    )
    .unwrap();
    for _ in 0..240 {
        w.step(1.0 / 60.0);
    }
    let mut buf = vec![0u8; w.snapshot_len(0).unwrap()];
    w.snapshot(0, &mut buf).unwrap();
    let h = w.state_hash(0).unwrap();
    for _ in 0..60 {
        w.step(1.0 / 60.0);
    }
    assert_ne!(w.state_hash(0).unwrap(), h);
    w.restore(0, &buf).unwrap();
    assert_eq!(w.state_hash(0).unwrap(), h);
    let car = w.vehicle(0).unwrap().model.as_four_wheel().unwrap();
    assert_eq!(car.state_len(), 18 + 16 + 4);
    assert!(car.orient.is_finite());
    assert!(car.wheels[FL].spin_angle.abs() <= core::f64::consts::PI);
}

#[test]
fn live_definition_swap_can_change_the_model() {
    let mut w = World::new(1);
    w.add_vehicle(def()).unwrap();
    w.set_input(
        0,
        VehicleInput {
            throttle: 1.0,
            ..Default::default()
        },
    )
    .unwrap();
    for _ in 0..120 {
        w.step(1.0 / 60.0);
    }
    let x = w.telemetry_of(0)[t::POS_X];
    let mut d = def();
    d.simulation.model = VehicleModelKind::SingleTrack;
    w.set_definition(0, d).unwrap();
    assert_eq!(
        w.vehicle(0).unwrap().model.kind(),
        VehicleModelKind::SingleTrack
    );
    let v = w.telemetry_of(0);
    assert!((v[t::POS_X] - x).abs() < 1e-9, "position carries over");
    assert_eq!(v[t::SPEED], 0.0, "rebuilt at rest");
    let q = Quat::from_yaw(v[t::YAW]);
    assert!((q.w - v[t::QUAT_W]).abs() < 1e-12);
}

#[test]
fn a_restore_rewrites_the_telemetry() {
    let mut w = World::new(1);
    w.add_vehicle(VehicleDefinition::default()).unwrap();
    w.set_input(
        0,
        VehicleInput {
            throttle: 1.0,
            ..VehicleInput::default()
        },
    )
    .unwrap();
    for _ in 0..60 {
        w.step(1.0 / 60.0);
    }
    let mut snap = vec![0u8; w.snapshot_len(0).unwrap()];
    w.snapshot(0, &mut snap).unwrap();
    let pos = w.telemetry_of(0)[t::POS_X];
    for _ in 0..60 {
        w.step(1.0 / 60.0);
    }
    assert!(w.telemetry_of(0)[t::POS_X] > pos + 1.0);
    w.restore(0, &snap).unwrap();
    assert_eq!(w.telemetry_of(0)[t::POS_X], pos);
}

#[test]
fn a_heading_vector_resets_like_its_yaw() {
    let def = VehicleDefinition::default();
    let mut a = World::new(1);
    let mut b = World::new(1);
    a.add_vehicle(def.clone()).unwrap();
    b.add_vehicle(def).unwrap();
    a.reset_vehicle(0, 3.0, 4.0, skidpad_math::atan2(2.0, -1.0))
        .unwrap();
    b.reset_vehicle_heading(0, 3.0, 4.0, -3.0, 6.0).unwrap();
    assert_eq!(a.world_hash(), b.world_hash());
    assert!(b.reset_vehicle_heading(0, 0.0, 0.0, 0.0, 0.0).is_err());
    assert!(b.reset_vehicle_heading(0, 0.0, 0.0, f64::NAN, 1.0).is_err());
}

#[test]
fn the_step_counter_can_be_restored() {
    let mut w = World::new(1);
    w.add_vehicle(VehicleDefinition::default()).unwrap();
    for _ in 0..10 {
        w.step(0.01);
    }
    let hash = w.world_hash();
    let mut snap = vec![0u8; w.snapshot_len(0).unwrap()];
    w.snapshot(0, &mut snap).unwrap();
    w.step(0.01);
    w.restore(0, &snap).unwrap();
    assert_ne!(w.world_hash(), hash);
    w.set_step_count(10);
    assert_eq!(w.world_hash(), hash);
}
