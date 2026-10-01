//! Solid axles and roll centres (ADR-0016): a roll centre above the ground
//! moves part of an axle's lateral load transfer into the links, which
//! reduces body roll without changing the total transfer; a solid axle
//! keeps its wheels upright to the road while the body rolls; both are
//! invisible at their defaults and survive a snapshot round trip.

use skidpad_core::definition::SuspensionKind;
use skidpad_core::telemetry as t;
use skidpad_core::{VehicleDefinition, VehicleInput, World, GRAVITY};

fn corner(d: VehicleDefinition) -> Vec<f64> {
    let mut w = World::new(1);
    w.add_vehicle(d).unwrap();
    w.vehicle_mut(0).unwrap().model.set_speed(15.0);
    w.set_input(
        0,
        VehicleInput {
            steer: 0.2,
            throttle: 0.3,
            ..VehicleInput::default()
        },
    )
    .unwrap();
    for _ in 0..600 {
        w.step(0.01);
    }
    w.telemetry_of(0).to_vec()
}

fn transfer(v: &[f64], axle: usize) -> f64 {
    v[t::LOAD_FL + 2 * axle] - v[t::LOAD_FR + 2 * axle]
}

#[test]
fn roll_centres_reduce_roll_but_not_the_total_load_transfer() {
    let low = corner(VehicleDefinition::default());
    let mut d = VehicleDefinition::default();
    d.axles[0].suspension.roll_center_height = 0.1;
    d.axles[1].suspension.roll_center_height = 0.3;
    let high = corner(d.clone());
    // Steering right rolls the body toward the outside, the left side down,
    // which is a negative roll about +x.
    assert!(low[t::ROLL] < -0.01, "roll {}", low[t::ROLL]);
    assert!(
        high[t::ROLL].abs() < 0.75 * low[t::ROLL].abs(),
        "roll {} with roll centres vs {} without",
        high[t::ROLL],
        low[t::ROLL]
    );
    // The outer-minus-inner load difference summed over both axles is
    // 2·m·a_y·h/t either way (the moment balance about the ground), so it
    // agrees within the small change the different roll angle makes.
    let total_low = transfer(&low, 0) + transfer(&low, 1);
    let total_high = transfer(&high, 0) + transfer(&high, 1);
    let expected = 2.0 * d.chassis.mass * low[t::LAT_ACCEL].abs() * d.chassis.cg_height
        / d.chassis.track_width;
    assert!(
        (total_low.abs() - expected).abs() < 0.1 * expected,
        "{total_low} vs {expected}"
    );
    assert!(
        (total_high.abs() - total_low.abs()).abs() < 0.08 * total_low.abs(),
        "{total_high} vs {total_low}"
    );
    // The rear, with the higher roll centre, now carries a larger share of
    // the transfer through its links; the telemetry reports the geometric
    // part per axle.
    assert!(high[t::GEOMETRIC_TRANSFER_R] > high[t::GEOMETRIC_TRANSFER_F]);
    assert!(high[t::GEOMETRIC_TRANSFER_R] > 100.0);
    assert_eq!(low[t::GEOMETRIC_TRANSFER_F], 0.0);
    let share_low = transfer(&low, 1).abs() / total_low.abs();
    let share_high = transfer(&high, 1).abs() / total_high.abs();
    assert!(
        share_high > share_low + 0.03,
        "rear share {share_high} vs {share_low}"
    );
}

#[test]
fn a_solid_axle_keeps_its_wheels_upright_while_the_body_rolls() {
    let independent = corner(VehicleDefinition::default());
    let mut d = VehicleDefinition::default();
    d.axles[1].suspension.kind = SuspensionKind::Solid;
    let solid = corner(d);
    let roll = solid[t::ROLL].abs();
    assert!(roll > 0.01);
    // Independent rear wheels lean with the body: a roll `φ` about +x
    // tilts both wheel planes by `−φ` in the ISO wheel frame.
    let ind_roll = independent[t::ROLL];
    assert!((independent[t::CAMBER_RL] + ind_roll).abs() < 0.2 * ind_roll.abs());
    assert!((independent[t::CAMBER_RR] + ind_roll).abs() < 0.2 * ind_roll.abs());
    // The beam axle's wheels stay square to the road.
    assert!(
        solid[t::CAMBER_RL].abs() < 0.05 * roll,
        "{}",
        solid[t::CAMBER_RL]
    );
    assert!(
        solid[t::CAMBER_RR].abs() < 0.05 * roll,
        "{}",
        solid[t::CAMBER_RR]
    );
    // The front is still independent and still leans.
    assert!((solid[t::CAMBER_FL] + solid[t::ROLL]).abs() < 0.2 * roll);
}

#[test]
fn a_solid_axle_with_static_camber_keeps_that_camber() {
    let mut d = VehicleDefinition::default();
    d.axles[1].suspension.kind = SuspensionKind::Solid;
    d.axles[1].static_camber_deg = -1.0;
    let v = corner(d);
    let gamma = 1.0_f64.to_radians();
    assert!((v[t::CAMBER_RL] + gamma).abs() < 0.05 * gamma);
    assert!((v[t::CAMBER_RR] - gamma).abs() < 0.05 * gamma);
}

#[test]
fn defaults_are_invisible() {
    let d = VehicleDefinition::default();
    assert_eq!(d.axles[0].suspension.kind, SuspensionKind::Independent);
    assert_eq!(d.axles[0].suspension.roll_center_height, 0.0);
    let v = corner(d);
    assert_eq!(v[t::GEOMETRIC_TRANSFER_F], 0.0);
    assert_eq!(v[t::GEOMETRIC_TRANSFER_R], 0.0);
}

#[test]
fn a_car_with_roll_centres_still_parks_on_a_cross_slope() {
    let mut d = VehicleDefinition::default();
    d.axles[0].suspension.roll_center_height = 0.08;
    d.axles[1].suspension.roll_center_height = 0.12;
    let mut w = World::new(1);
    w.add_vehicle(d.clone()).unwrap();
    w.set_ground_slope(0, 0.0, 0.2).unwrap();
    w.set_input(
        0,
        VehicleInput {
            brake: 1.0,
            handbrake: 1.0,
            ..VehicleInput::default()
        },
    )
    .unwrap();
    for _ in 0..1500 {
        w.step(0.01);
    }
    let v = w.telemetry_of(0);
    assert!(v[t::SPEED] < 1e-4, "creeps at {} m/s", v[t::SPEED]);
    // The links carry part of the side load the tires put on the body: the
    // uphill side is lighter, and the geometric share shows in telemetry.
    assert!(v[t::GEOMETRIC_TRANSFER_F] > 0.0);
    let total = v[t::LOAD_FL] + v[t::LOAD_FR] + v[t::LOAD_RL] + v[t::LOAD_RR];
    let expected = d.chassis.mass * GRAVITY / (1.0f64 + 0.04).sqrt();
    assert!(
        (total - expected).abs() < 0.01 * expected,
        "{total} vs {expected}"
    );
}

#[test]
fn roll_centre_state_round_trips_through_a_snapshot() {
    let mut d = VehicleDefinition::default();
    d.axles[0].suspension.roll_center_height = 0.1;
    d.axles[1].suspension.roll_center_height = 0.2;
    let mut a = World::new(1);
    a.add_vehicle(d.clone()).unwrap();
    let mut b = World::new(1);
    b.add_vehicle(d).unwrap();
    let input = VehicleInput {
        steer: 0.4,
        throttle: 0.7,
        ..VehicleInput::default()
    };
    a.set_input(0, input).unwrap();
    b.set_input(0, input).unwrap();
    let mut buf = vec![0u8; a.snapshot_len(0).unwrap()];
    for k in 0..400 {
        a.step(0.01);
        if k == 200 {
            a.snapshot(0, &mut buf).unwrap();
            b.restore(0, &buf).unwrap();
        }
        if k > 200 {
            b.step(0.01);
            assert_eq!(
                a.state_hash(0).unwrap(),
                b.state_hash(0).unwrap(),
                "step {k}"
            );
        }
    }
}

#[test]
fn bad_roll_centres_are_rejected() {
    let mut d = VehicleDefinition::default();
    d.axles[0].suspension.roll_center_height = 2.0;
    assert!(d.validate().is_err());
}
