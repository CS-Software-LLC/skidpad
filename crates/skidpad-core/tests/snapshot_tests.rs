//! Snapshot and hash on the full model (milestone 3): the four-wheel
//! vehicle's state round-trips through a snapshot in both host modes and
//! continues identically, the hash sees every state value, and a world of
//! mixed models hashes consistently.

use skidpad_core::definition::VehicleModelKind;
use skidpad_core::geom::Vec3;
use skidpad_core::snapshot::{Snapshottable, MAGIC, VERSION};
use skidpad_core::vehicle::{FourWheelVehicle, HostMode};
use skidpad_core::world::{HOST_CONTACT_STRIDE, HOST_IN_BODY_LEN, HOST_IN_STRIDE};
use skidpad_core::{VehicleDefinition, VehicleInput, World};

fn def() -> VehicleDefinition {
    VehicleDefinition::default()
}

fn input_at(k: usize) -> VehicleInput {
    // A scripted drive with braking and a handbrake pull, integer arithmetic
    // only.
    let t = k as f64 / 60.0;
    let tri = {
        let p = (k % 240) as f64 / 240.0;
        if p < 0.5 {
            4.0 * p - 1.0
        } else {
            3.0 - 4.0 * p
        }
    };
    VehicleInput {
        steer: 0.5 * tri,
        throttle: if t < 6.0 { 0.9 } else { 0.0 },
        brake: if (6.0..8.0).contains(&t) { 0.8 } else { 0.0 },
        handbrake: if t >= 8.5 { 1.0 } else { 0.0 },
        ..VehicleInput::default()
    }
}

#[test]
fn four_wheel_snapshot_has_the_documented_layout() {
    let mut w = World::new(1);
    w.add_vehicle(def()).unwrap();
    let car = w.vehicle(0).unwrap().model.as_four_wheel().unwrap();
    assert_eq!(car.state_len(), 14 + 4 * 4 + 4);
    let mut buf = vec![0u8; w.snapshot_len(0).unwrap()];
    assert_eq!(buf.len(), 12 + 8 * 34);
    w.snapshot(0, &mut buf).unwrap();
    assert_eq!(&buf[0..4], MAGIC);
    assert_eq!(
        u32::from_le_bytes([buf[4], buf[5], buf[6], buf[7]]),
        VERSION
    );
    assert_eq!(u32::from_le_bytes([buf[8], buf[9], buf[10], buf[11]]), 34);
    // A buffer that is too small reports the size needed and writes nothing.
    let mut short = vec![0u8; 20];
    assert_eq!(w.snapshot(0, &mut short).unwrap(), buf.len());
    assert!(short.iter().all(|&b| b == 0));
}

#[test]
fn four_wheel_hash_sees_every_state_value() {
    let mut car = FourWheelVehicle::new(def());
    for k in 0..120 {
        car.substep(1.0 / 240.0, &input_at(k / 4));
    }
    let mut scratch = vec![0.0; 64];
    let base = car.state_hash(&mut scratch);
    let n = car.state_len();
    let mut values = vec![0.0; n];
    car.write_state(&mut values);
    // The gear slot holds an integer; nudge it by a whole gear.
    let gear_slot = n - skidpad_core::drivetrain::STATE_LEN + 1;
    for i in 0..n {
        let mut perturbed = values.clone();
        perturbed[i] += if i == gear_slot { 1.0 } else { 1e-9 };
        let mut other = car.clone();
        other.read_state(&perturbed);
        assert_ne!(
            other.state_hash(&mut scratch),
            base,
            "state value {i} is not covered by the hash"
        );
        let mut back = vec![0.0; n];
        other.write_state(&mut back);
        assert_eq!(back, perturbed, "state value {i} does not round-trip");
    }
    // The quaternion is hashed as stored, not renormalised.
    assert_eq!(car.clone().state_hash(&mut scratch), base);
}

#[test]
fn four_wheel_restore_and_continue_matches_the_uninterrupted_run() {
    let run = |restore_at: Option<usize>| {
        let mut a = World::new(1);
        a.add_vehicle(def()).unwrap();
        let mut b = World::new(1);
        b.add_vehicle(def()).unwrap();
        let mut buf = vec![0u8; a.snapshot_len(0).unwrap()];
        let mut hashes = Vec::new();
        for k in 0..720 {
            a.set_input(0, input_at(k)).unwrap();
            a.step(1.0 / 60.0);
            if restore_at == Some(k) {
                a.snapshot(0, &mut buf).unwrap();
                // b has lived a different life.
                b.set_input(
                    0,
                    VehicleInput {
                        steer: -1.0,
                        throttle: 1.0,
                        ..Default::default()
                    },
                )
                .unwrap();
                for _ in 0..90 {
                    b.step(1.0 / 60.0);
                }
                b.restore(0, &buf).unwrap();
                assert_eq!(a.state_hash(0).unwrap(), b.state_hash(0).unwrap());
            }
            if restore_at.is_some_and(|r| k > r) {
                b.set_input(0, input_at(k)).unwrap();
                b.step(1.0 / 60.0);
                assert_eq!(
                    a.state_hash(0).unwrap(),
                    b.state_hash(0).unwrap(),
                    "diverged at step {k}"
                );
                assert_eq!(a.telemetry_of(0), b.telemetry_of(0));
            }
            if k % 60 == 59 {
                hashes.push(a.state_hash(0).unwrap());
            }
        }
        hashes
    };
    // Through the braking (step 360..480) and after the handbrake pull.
    assert_eq!(run(None), run(Some(400)));
    assert_eq!(run(None), run(Some(540)));
}

/// Mirror a proxy's state into a host record, as an adapter would from its
/// rigid body, with flat ground under every wheel.
fn write_host_record(rec: &mut [f64], car: &FourWheelVehicle) {
    let angvel = car.orient.rotate(car.omega);
    rec[0] = car.pos.x;
    rec[1] = car.pos.y;
    rec[2] = car.pos.z;
    rec[3] = car.orient.x;
    rec[4] = car.orient.y;
    rec[5] = car.orient.z;
    rec[6] = car.orient.w;
    rec[7] = car.vel.x;
    rec[8] = car.vel.y;
    rec[9] = car.vel.z;
    rec[10] = angvel.x;
    rec[11] = angvel.y;
    rec[12] = angvel.z;
    for k in 0..4 {
        let o = HOST_IN_BODY_LEN + k * HOST_CONTACT_STRIDE;
        rec[o] = 1.0;
        rec[o + 4] = 0.0;
        rec[o + 5] = 0.0;
        rec[o + 6] = 1.0;
    }
}

#[test]
fn external_host_restore_and_continue_matches_the_uninterrupted_run() {
    // The proxy's own pose integration stands in for the host body: each
    // step the host record is the proxy state the previous step left, which
    // is what a host that applied the reported impulses would hold.
    let mut a = World::new(1);
    a.add_vehicle(def()).unwrap();
    a.set_host_mode(0, HostMode::External).unwrap();
    let mut b = World::new(1);
    b.add_vehicle(def()).unwrap();
    b.set_host_mode(0, HostMode::External).unwrap();
    let mut buf = vec![0u8; a.snapshot_len(0).unwrap()];
    let step = |w: &mut World, k: usize| {
        let car = w.vehicle(0).unwrap().model.as_four_wheel().unwrap().clone();
        write_host_record(&mut w.host_in_mut()[..HOST_IN_STRIDE], &car);
        w.set_input(0, input_at(k)).unwrap();
        w.step(1.0 / 60.0);
    };
    for k in 0..300 {
        step(&mut a, k);
    }
    a.snapshot(0, &mut buf).unwrap();
    for k in 0..100 {
        step(&mut b, 2 * k);
    }
    b.restore(0, &buf).unwrap();
    assert_eq!(a.host_mode(0).unwrap(), HostMode::External);
    assert_eq!(
        b.host_mode(0).unwrap(),
        HostMode::External,
        "host mode is not state"
    );
    assert_eq!(a.state_hash(0).unwrap(), b.state_hash(0).unwrap());
    for k in 300..720 {
        step(&mut a, k);
        step(&mut b, k);
        assert_eq!(
            a.state_hash(0).unwrap(),
            b.state_hash(0).unwrap(),
            "diverged at step {k}"
        );
        assert_eq!(a.host_out(), b.host_out(), "impulses diverged at step {k}");
    }
    let car = a.vehicle(0).unwrap().model.as_four_wheel().unwrap();
    assert!(
        car.pos.is_finite() && car.speed() < 1.0,
        "the handbrake stop held"
    );
}

#[test]
fn snapshot_restores_across_host_modes_as_pure_state() {
    // A snapshot taken on the built-in host restores into an external-mode
    // vehicle (the host then owns the pose) and the other way round: the
    // snapshot holds state, the host mode and contacts are environment.
    let mut a = World::new(1);
    a.add_vehicle(def()).unwrap();
    for k in 0..200 {
        a.set_input(0, input_at(k)).unwrap();
        a.step(1.0 / 60.0);
    }
    let mut buf = vec![0u8; a.snapshot_len(0).unwrap()];
    a.snapshot(0, &mut buf).unwrap();
    let mut b = World::new(1);
    b.add_vehicle(def()).unwrap();
    b.set_host_mode(0, HostMode::External).unwrap();
    b.restore(0, &buf).unwrap();
    assert_eq!(a.state_hash(0).unwrap(), b.state_hash(0).unwrap());
    assert_eq!(b.host_mode(0).unwrap(), HostMode::External);
    let a_car = a.vehicle(0).unwrap().model.as_four_wheel().unwrap();
    let b_car = b.vehicle(0).unwrap().model.as_four_wheel().unwrap();
    assert_eq!(a_car.pos, b_car.pos);
    assert_eq!(a_car.wheels[0].omega, b_car.wheels[0].omega);
    assert_eq!(
        b_car.impulse,
        Vec3::ZERO,
        "accumulators are cleared on restore"
    );
}

#[test]
fn mixed_model_world_hash_covers_every_vehicle_and_the_step_count() {
    let mut single = def();
    single.simulation.model = VehicleModelKind::SingleTrack;
    let build = || {
        let mut w = World::new(2);
        w.add_vehicle(def()).unwrap();
        w.add_vehicle(single.clone()).unwrap();
        w
    };
    let mut w = build();
    for k in 0..120 {
        w.set_input(0, input_at(k)).unwrap();
        w.set_input(1, input_at(k + 7)).unwrap();
        w.step(1.0 / 60.0);
    }
    let h = w.world_hash();
    assert_eq!(h, build_and_run(&mut build(), &single, 120));
    let h0 = w.state_hash(0).unwrap();
    let h1 = w.state_hash(1).unwrap();
    assert_ne!(h0, h1);
    assert_ne!(h, h0);
    assert_ne!(h, h1);
    // The world hash is sensitive to each vehicle alone.
    let mut buf0 = vec![0u8; w.snapshot_len(0).unwrap()];
    let mut buf1 = vec![0u8; w.snapshot_len(1).unwrap()];
    w.snapshot(0, &mut buf0).unwrap();
    w.snapshot(1, &mut buf1).unwrap();
    assert_ne!(
        buf0.len(),
        buf1.len(),
        "the models have different state sizes"
    );
    assert!(
        w.restore(0, &buf1).is_err(),
        "a single-track snapshot does not fit a four-wheel car"
    );
    w.set_input(1, VehicleInput::default()).unwrap();
    w.step(1.0 / 60.0);
    assert_ne!(w.world_hash(), h, "a step changes the world hash");
    w.restore(0, &buf0).unwrap();
    w.restore(1, &buf1).unwrap();
    assert_eq!(w.state_hash(0).unwrap(), h0);
    assert_eq!(w.state_hash(1).unwrap(), h1);
    assert_ne!(
        w.world_hash(),
        h,
        "the step count is part of the world hash"
    );

    fn build_and_run(w: &mut World, _single: &VehicleDefinition, steps: usize) -> u64 {
        for k in 0..steps {
            w.set_input(0, input_at(k)).unwrap();
            w.set_input(1, input_at(k + 7)).unwrap();
            w.step(1.0 / 60.0);
        }
        w.world_hash()
    }
}
