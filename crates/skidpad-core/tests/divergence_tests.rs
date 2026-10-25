//! The divergence guard (M9): a vehicle whose state goes non-finite or runs
//! away is put back at rest at its last healthy pose, counted in
//! `World::health` and the `Diverged` channel, and stops pushing anything
//! onto an external body; a healthy vehicle is never touched.

use skidpad_core::ai::AiConfig;
use skidpad_core::definition::VehicleModelKind;
use skidpad_core::telemetry::{self as t, CHANNELS};
use skidpad_core::vehicle::HostMode;
use skidpad_core::world::{Divergence, Health, HOST_OUT_BODY_LEN, HOST_OUT_STRIDE, RUNAWAY_SPEED};
use skidpad_core::{VehicleDefinition, VehicleInput, World};

const DT: f64 = 1.0 / 60.0;

fn cornering() -> VehicleInput {
    VehicleInput {
        steer: 0.15,
        throttle: 0.35,
        ..VehicleInput::default()
    }
}

/// A car of the given model settled into a steady corner at about 20 m/s.
fn settled(kind: VehicleModelKind) -> World {
    let mut def = VehicleDefinition::default();
    def.simulation.model = kind;
    let mut w = World::new(2);
    w.add_vehicle(def).unwrap();
    w.vehicle_mut(0).unwrap().model.set_speed(20.0);
    w.set_input(0, cornering()).unwrap();
    w.step_many(DT, 120);
    w
}

fn all_finite(w: &World) -> bool {
    w.telemetry_of(0).iter().all(|x| x.is_finite())
}

#[test]
fn a_healthy_run_is_never_touched() {
    for kind in [VehicleModelKind::FourWheel, VehicleModelKind::SingleTrack] {
        let w = settled(kind);
        assert_eq!(w.health(0).unwrap(), Health::default());
        assert_eq!(w.telemetry_of(0)[t::DIVERGED], 0.0);
        assert!(w.vehicle(0).unwrap().model.speed() > 15.0);
    }
}

#[test]
fn a_nan_state_resets_at_the_last_good_pose() {
    for kind in [VehicleModelKind::FourWheel, VehicleModelKind::SingleTrack] {
        let mut w = settled(kind);
        let rec = w.telemetry_of(0);
        let (x, y, yaw, time) = (rec[t::POS_X], rec[t::POS_Y], rec[t::YAW], rec[t::TIME]);

        w.vehicle_mut(0).unwrap().model.set_yaw_rate(f64::NAN);
        w.step(DT);

        let h = w.health(0).unwrap();
        assert_eq!(h.recoveries, 1, "{kind:?}");
        assert_eq!(h.cause, Divergence::NonFinite);
        assert_eq!(h.last_step, w.step_count);
        assert!(h.channel.is_some(), "the NaN reaches telemetry");
        assert!(all_finite(&w), "{kind:?}");
        let rec = w.telemetry_of(0);
        assert_eq!(rec[t::DIVERGED], 1.0);
        assert_eq!((rec[t::POS_X], rec[t::POS_Y]), (x, y));
        assert!((rec[t::YAW] - yaw).abs() < 1e-12);
        assert_eq!(rec[t::SPEED], 0.0);
        // The clock keeps running through the reset.
        assert!(rec[t::TIME] > time);

        // It drives on from there, and the count stays.
        w.step_many(DT, 120);
        assert!(all_finite(&w));
        assert!(w.vehicle(0).unwrap().model.speed() > 1.0);
        assert_eq!(w.health(0).unwrap().recoveries, 1);
        assert_eq!(w.telemetry_of(0)[t::DIVERGED], 1.0);
    }
}

#[test]
fn a_runaway_speed_is_caught_while_still_finite() {
    let mut w = settled(VehicleModelKind::FourWheel);
    w.vehicle_mut(0)
        .unwrap()
        .model
        .set_speed(2.0 * RUNAWAY_SPEED);
    w.step(DT);
    let h = w.health(0).unwrap();
    assert_eq!(h.cause, Divergence::Runaway);
    assert_eq!(h.channel.map(|c| CHANNELS[c].name), Some("Speed"));
    assert_eq!(w.telemetry_of(0)[t::SPEED], 0.0);
}

#[test]
fn an_unstable_tuning_is_reset_rather_than_spreading_nan() {
    // Passes validation, but a 60 Hz integrator cannot hold a near-rigid
    // spring: the body pitches faster every step.
    let mut def = VehicleDefinition::default();
    def.simulation.substep_rate_hz = 60.0;
    for a in def.axles.iter_mut() {
        a.suspension.spring_rate = 1.0e9;
    }
    let mut w = World::new(1);
    w.add_vehicle(def).unwrap();
    w.vehicle_mut(0).unwrap().model.set_speed(20.0);
    w.set_input(0, cornering()).unwrap();
    for _ in 0..600 {
        w.step(DT);
        assert!(all_finite(&w));
    }
    assert!(w.health(0).unwrap().recoveries > 0);
}

#[test]
fn bad_host_numbers_never_reach_the_state() {
    let mut w = settled(VehicleModelKind::FourWheel);
    let before = w.world_hash();
    // A NaN step length does nothing at all.
    w.step(f64::NAN);
    assert_eq!(w.world_hash(), before);
    // A NaN pedal reads as zero.
    let s = &mut w.inputs_mut()[..VehicleInput::STRIDE];
    s[0] = f64::NAN;
    s[1] = f64::INFINITY;
    w.step_many(DT, 60);
    assert!(all_finite(&w));
    assert_eq!(w.health(0).unwrap().recoveries, 0);
    assert_eq!(w.telemetry_of(0)[t::THROTTLE], 0.0);
}

#[test]
fn an_external_body_gets_no_impulse_from_the_bad_step() {
    let mut w = settled(VehicleModelKind::FourWheel);
    w.set_host_mode(0, HostMode::External).unwrap();
    // Hold the body where the built-in host left it.
    let rec = w.telemetry_of(0).to_vec();
    let body = &mut w.host_in_mut()[..13];
    body[0] = rec[t::POS_X];
    body[1] = rec[t::POS_Y];
    body[2] = rec[t::POS_Z];
    body[3] = rec[t::QUAT_X];
    body[4] = rec[t::QUAT_Y];
    body[5] = rec[t::QUAT_Z];
    body[6] = rec[t::QUAT_W];
    w.step(DT);
    assert_eq!(w.health(0).unwrap().recoveries, 0);

    // The host sets the body's rates every step, so poison a wheel.
    w.vehicle_mut(0)
        .unwrap()
        .model
        .as_four_wheel_mut()
        .unwrap()
        .wheels[0]
        .omega = f64::NAN;
    w.step(DT);
    assert_eq!(w.health(0).unwrap().recoveries, 1);
    let out = &w.host_out()[..HOST_OUT_STRIDE];
    assert!(out.iter().all(|x| x.is_finite()));
    assert!(out[..HOST_OUT_BODY_LEN].iter().all(|&x| x == 0.0));
}

#[test]
fn clearing_health_zeroes_the_record_and_channel() {
    let mut w = settled(VehicleModelKind::FourWheel);
    w.vehicle_mut(0).unwrap().model.set_yaw_rate(f64::NAN);
    w.step(DT);
    w.clear_health(0).unwrap();
    assert_eq!(w.health(0).unwrap(), Health::default());
    assert_eq!(w.telemetry_of(0)[t::DIVERGED], 0.0);
    w.step(DT);
    assert_eq!(w.telemetry_of(0)[t::DIVERGED], 0.0);
}

#[test]
fn a_driver_starts_over_after_a_reset() {
    let mut w = World::new(1);
    w.add_vehicle(VehicleDefinition::default()).unwrap();
    let path = [0.0, 0.0, 200.0, 0.0, 400.0, 0.0];
    w.set_ai(0, &path, AiConfig::default()).unwrap();
    w.step_many(DT, 120);
    w.vehicle_mut(0).unwrap().model.set_yaw_rate(f64::NAN);
    w.step(DT);
    assert_eq!(w.health(0).unwrap().recoveries, 1);
    w.step_many(DT, 120);
    assert!(all_finite(&w));
    assert!(w.vehicle(0).unwrap().model.speed() > 1.0);
}

#[test]
fn recovery_is_deterministic() {
    let run = || {
        let mut w = settled(VehicleModelKind::FourWheel);
        w.vehicle_mut(0).unwrap().model.set_yaw_rate(f64::NAN);
        w.step_many(DT, 60);
        w.world_hash()
    };
    assert_eq!(run(), run());
}
