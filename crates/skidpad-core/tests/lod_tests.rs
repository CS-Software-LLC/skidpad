//! Level of detail and batched stepping (milestone 7, ADR-0019): a vehicle
//! moves between the four-wheel model, the single-track model and frozen
//! without a jump in its motion, a snapshot taken at one level restores at
//! another, and `step_many` is the same as stepping one at a time.

use skidpad_core::definition::VehicleModelKind;
use skidpad_core::vehicle::HostMode;
use skidpad_core::world::{Lod, WorldError};
use skidpad_core::{VehicleDefinition, VehicleInput, World};

fn cornering() -> VehicleInput {
    VehicleInput {
        steer: 0.15,
        throttle: 0.35,
        ..VehicleInput::default()
    }
}

/// A car settled into a steady corner at about 20 m/s.
fn settled() -> World {
    let mut w = World::new(2);
    w.add_vehicle(VehicleDefinition::default()).unwrap();
    w.vehicle_mut(0).unwrap().model.set_speed(20.0);
    w.set_input(0, cornering()).unwrap();
    w.step_many(1.0 / 60.0, 180);
    w
}

fn read(w: &World, name: &str) -> f64 {
    let idx = skidpad_core::telemetry::CHANNELS
        .iter()
        .position(|c| c.name == name)
        .unwrap();
    w.telemetry_of(0)[idx]
}

#[test]
fn switching_down_and_up_keeps_the_motion() {
    let mut w = settled();
    let before = (
        read(&w, "PosX"),
        read(&w, "PosY"),
        read(&w, "Yaw"),
        read(&w, "Speed"),
        read(&w, "YawRate"),
        read(&w, "EngineRpm"),
    );
    w.set_lod(0, Lod::SingleTrack, 0.0).unwrap();
    assert_eq!(w.lod(0).unwrap(), Lod::SingleTrack);
    assert_eq!(
        w.vehicle(0).unwrap().model.kind(),
        VehicleModelKind::SingleTrack
    );
    let after = (
        read(&w, "PosX"),
        read(&w, "PosY"),
        read(&w, "Yaw"),
        read(&w, "Speed"),
        read(&w, "YawRate"),
        read(&w, "EngineRpm"),
    );
    assert!((before.0 - after.0).abs() < 1e-9);
    assert!((before.1 - after.1).abs() < 1e-9);
    assert!((before.2 - after.2).abs() < 1e-9);
    assert!((before.3 - after.3).abs() < 0.05, "{before:?} {after:?}");
    assert!((before.4 - after.4).abs() < 1e-9);
    assert!((before.5 - after.5).abs() < 1e-6);

    // One step on the single-track model: no jolt in speed or yaw rate.
    w.step(1.0 / 60.0);
    assert!((read(&w, "Speed") - before.3).abs() < 0.3);
    assert!((read(&w, "YawRate") - before.4).abs() < 0.05);

    w.set_lod(0, Lod::Full, 0.0).unwrap();
    assert_eq!(
        w.vehicle(0).unwrap().model.kind(),
        VehicleModelKind::FourWheel
    );
    let speed = read(&w, "Speed");
    let r = read(&w, "YawRate");
    for _ in 0..30 {
        w.step(1.0 / 60.0);
        assert!((read(&w, "Speed") - speed).abs() < 1.0);
        assert!((read(&w, "YawRate") - r).abs() < 0.1);
    }
}

#[test]
fn a_reduced_car_follows_the_full_car_closely() {
    let mut full = settled();
    let mut reduced = settled();
    reduced.set_lod(0, Lod::SingleTrack, 0.0).unwrap();
    // Two seconds of the same corner: the single-track model lacks lateral
    // load transfer, so it runs a slightly wider line, but not far off.
    full.step_many(1.0 / 60.0, 120);
    reduced.step_many(1.0 / 60.0, 120);
    let dx = read(&full, "PosX") - read(&reduced, "PosX");
    let dy = read(&full, "PosY") - read(&reduced, "PosY");
    let d = (dx * dx + dy * dy).sqrt();
    assert!(d < 4.0, "drifted {d} m apart in 2 s");
    assert!((read(&full, "Speed") - read(&reduced, "Speed")).abs() < 1.0);
}

#[test]
fn a_frozen_car_holds_still_and_resumes() {
    let mut w = settled();
    let hash = w.state_hash(0).unwrap();
    let speed = read(&w, "Speed");
    w.set_lod(0, Lod::Frozen, 0.0).unwrap();
    let steps = w.step_count;
    w.step_many(1.0 / 60.0, 60);
    assert_eq!(w.step_count, steps + 60);
    assert_eq!(w.state_hash(0).unwrap(), hash);
    assert_eq!(read(&w, "Speed"), speed);
    w.set_lod(0, Lod::Full, 0.0).unwrap();
    w.step(1.0 / 60.0);
    assert_ne!(w.state_hash(0).unwrap(), hash);
    assert!((read(&w, "Speed") - speed).abs() < 0.3);
}

#[test]
fn freezing_a_reduced_car_keeps_its_model() {
    let mut w = settled();
    w.set_lod(0, Lod::SingleTrack, 0.0).unwrap();
    w.set_lod(0, Lod::Frozen, 0.0).unwrap();
    assert_eq!(
        w.vehicle(0).unwrap().model.kind(),
        VehicleModelKind::SingleTrack
    );
    w.set_lod(0, Lod::Full, 0.0).unwrap();
    assert_eq!(
        w.vehicle(0).unwrap().model.kind(),
        VehicleModelKind::FourWheel
    );
}

#[test]
fn lod_substep_rate_override() {
    let mut w = settled();
    w.set_lod(0, Lod::SingleTrack, 240.0).unwrap();
    assert_eq!(w.vehicle(0).unwrap().effective_rate_hz(), 240.0);
    w.step_many(1.0 / 60.0, 60);
    assert!(read(&w, "Speed").is_finite() && read(&w, "Speed") > 10.0);
    w.set_lod(0, Lod::Full, 0.0).unwrap();
    assert_eq!(
        w.vehicle(0).unwrap().effective_rate_hz(),
        VehicleDefinition::default().simulation.substep_rate_hz
    );
    assert!(matches!(
        w.set_lod(0, Lod::Full, -1.0),
        Err(WorldError::Invalid(_))
    ));
    assert!(matches!(
        w.set_lod(0, Lod::Full, f64::NAN),
        Err(WorldError::Invalid(_))
    ));
}

#[test]
fn an_externally_hosted_car_can_freeze_but_not_reduce() {
    let mut w = World::new(1);
    w.add_vehicle(VehicleDefinition::default()).unwrap();
    w.set_host_mode(0, HostMode::External).unwrap();
    assert_eq!(
        w.set_lod(0, Lod::SingleTrack, 0.0),
        Err(WorldError::WrongModel(0))
    );
    w.step(1.0 / 60.0);
    assert!(w.host_out()[..6].iter().any(|v| *v != 0.0));
    w.set_lod(0, Lod::Frozen, 0.0).unwrap();
    w.step(1.0 / 60.0);
    assert!(w.host_out()[..6].iter().all(|v| *v == 0.0));
}

#[test]
fn a_snapshot_restores_across_levels() {
    let mut w = settled();
    w.set_lod(0, Lod::SingleTrack, 0.0).unwrap();
    w.step_many(1.0 / 60.0, 10);
    let mut low = vec![0u8; w.snapshot_len(0).unwrap()];
    w.snapshot(0, &mut low).unwrap();
    let low_hash = w.state_hash(0).unwrap();

    w.set_lod(0, Lod::Full, 0.0).unwrap();
    w.step_many(1.0 / 60.0, 10);
    let mut high = vec![0u8; w.snapshot_len(0).unwrap()];
    w.snapshot(0, &mut high).unwrap();
    let high_hash = w.state_hash(0).unwrap();

    // Restoring the single-track snapshot drops the car to that level.
    w.restore(0, &low).unwrap();
    assert_eq!(w.lod(0).unwrap(), Lod::SingleTrack);
    assert_eq!(w.state_hash(0).unwrap(), low_hash);
    // And the four-wheel snapshot brings it back up.
    w.restore(0, &high).unwrap();
    assert_eq!(w.lod(0).unwrap(), Lod::Full);
    assert_eq!(w.state_hash(0).unwrap(), high_hash);

    // A corrupt snapshot of the other length leaves the car alone.
    let mut bad = low.clone();
    bad[0] = b'X';
    assert!(w.restore(0, &bad).is_err());
    assert_eq!(w.lod(0).unwrap(), Lod::Full);
    assert_eq!(w.state_hash(0).unwrap(), high_hash);
}

#[test]
fn level_changes_are_deterministic() {
    let run = || {
        let mut w = World::new(3);
        for k in 0..3 {
            w.add_vehicle(VehicleDefinition::default()).unwrap();
            w.reset_vehicle(k, 0.0, 10.0 * k as f64, 0.0).unwrap();
            w.set_input(
                k,
                VehicleInput {
                    steer: 0.1 * k as f64,
                    throttle: 0.6,
                    ..VehicleInput::default()
                },
            )
            .unwrap();
        }
        for step in 0..600u32 {
            match step {
                100 => w.set_lod(1, Lod::SingleTrack, 0.0).unwrap(),
                200 => w.set_lod(2, Lod::Frozen, 0.0).unwrap(),
                300 => w.set_lod(1, Lod::Full, 0.0).unwrap(),
                400 => w.set_lod(2, Lod::SingleTrack, 120.0).unwrap(),
                _ => {}
            }
            w.step(1.0 / 60.0);
        }
        w.world_hash()
    };
    assert_eq!(run(), run());
}

#[test]
fn step_many_matches_single_steps() {
    let make = || {
        let mut w = World::new(2);
        w.add_vehicle(VehicleDefinition::default()).unwrap();
        let mut st = VehicleDefinition::default();
        st.simulation.model = VehicleModelKind::SingleTrack;
        w.add_vehicle(st).unwrap();
        for k in 0..2 {
            w.set_input(
                k,
                VehicleInput {
                    steer: 0.2,
                    throttle: 0.8,
                    ..VehicleInput::default()
                },
            )
            .unwrap();
        }
        w
    };
    let mut a = make();
    let mut b = make();
    for _ in 0..240 {
        a.step(1.0 / 60.0);
    }
    b.step_many(1.0 / 60.0, 240);
    assert_eq!(a.step_count, b.step_count);
    assert_eq!(a.world_hash(), b.world_hash());
    assert_eq!(a.telemetry(), b.telemetry());
}

#[test]
fn set_definition_keeps_the_level() {
    let mut w = settled();
    w.set_lod(0, Lod::SingleTrack, 0.0).unwrap();
    let mut def = VehicleDefinition::default();
    def.chassis.mass += 100.0;
    w.set_definition(0, def.clone()).unwrap();
    assert_eq!(
        w.vehicle(0).unwrap().model.kind(),
        VehicleModelKind::SingleTrack
    );
    assert_eq!(w.vehicle(0).unwrap().authored_definition(), &def);
    w.set_lod(0, Lod::Full, 0.0).unwrap();
    assert_eq!(
        w.vehicle(0).unwrap().model.kind(),
        VehicleModelKind::FourWheel
    );
    assert_eq!(
        w.vehicle(0).unwrap().model.definition().chassis.mass,
        def.chassis.mass
    );
}
