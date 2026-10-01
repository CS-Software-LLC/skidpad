//! Static toe per axle: each wheel's road-wheel angle carries the axle's toe
//! on top of the steering, mirrored left to right. A toed-in car runs
//! straight with its tires pulling against each other, coasts down sooner
//! from the scrub, answers a step steer later, and still parks.

use skidpad_core::telemetry as t;
use skidpad_core::{VehicleDefinition, VehicleInput, World};

fn world(d: VehicleDefinition, speed: f64) -> World {
    let mut w = World::new(1);
    w.add_vehicle(d).unwrap();
    if speed > 0.0 {
        w.vehicle_mut(0).unwrap().model.set_speed(speed);
    }
    w
}

fn toed(front: f64, rear: f64) -> VehicleDefinition {
    let mut d = VehicleDefinition::default();
    d.axles[0].static_toe_deg = front;
    d.axles[1].static_toe_deg = rear;
    d
}

#[test]
fn defaults_have_no_toe() {
    let d = VehicleDefinition::default();
    assert_eq!(d.axles[0].static_toe_deg, 0.0);
    assert_eq!(d.axles[1].static_toe_deg, 0.0);
    let mut w = world(d, 20.0);
    w.step(0.01);
    let v = w.telemetry_of(0);
    for k in [
        t::WHEEL_STEER_FL,
        t::WHEEL_STEER_FR,
        t::WHEEL_STEER_RL,
        t::WHEEL_STEER_RR,
    ] {
        assert_eq!(v[k], 0.0);
    }
}

#[test]
fn toe_in_turns_each_wheel_toward_the_centreline() {
    let mut w = world(toed(0.5, -0.2), 20.0);
    w.step(0.01);
    let v = w.telemetry_of(0);
    let (f, r) = (0.5_f64.to_radians(), 0.2_f64.to_radians());
    // + is a left turn: toe-in points the left wheel right.
    assert!((v[t::WHEEL_STEER_FL] + f).abs() < 1e-12);
    assert!((v[t::WHEEL_STEER_FR] - f).abs() < 1e-12);
    // Negative toe is toe-out.
    assert!((v[t::WHEEL_STEER_RL] - r).abs() < 1e-12);
    assert!((v[t::WHEEL_STEER_RR] + r).abs() < 1e-12);
    // The mean steer angle is the driver's, without the toe.
    assert_eq!(v[t::STEER_ANGLE], 0.0);
}

fn coast(d: VehicleDefinition) -> Vec<f64> {
    let mut w = world(d, 25.0);
    for _ in 0..500 {
        w.step(0.01);
    }
    w.telemetry_of(0).to_vec()
}

#[test]
fn a_toed_in_car_runs_straight_and_coasts_down_sooner() {
    let plain = coast(VehicleDefinition::default());
    let toe = coast(toed(1.0, 0.5));
    // The tires pull against each other and cancel.
    assert!(toe[t::FY_FL] < -100.0, "{}", toe[t::FY_FL]);
    assert!(toe[t::FY_FR] > 100.0, "{}", toe[t::FY_FR]);
    assert!(toe[t::YAW_RATE].abs() < 1e-6, "{}", toe[t::YAW_RATE]);
    assert!(toe[t::POS_Y].abs() < 1e-6, "{}", toe[t::POS_Y]);
    // The scrub is drag.
    assert!(
        toe[t::SPEED] < plain[t::SPEED] - 0.05,
        "{} vs {}",
        toe[t::SPEED],
        plain[t::SPEED]
    );
}

/// Time from the step for the yaw rate to reach 90 % of its final value, s.
fn step_response(d: VehicleDefinition) -> f64 {
    let mut w = world(d, 22.0);
    let dt = 0.002;
    let mut yaw = Vec::new();
    for k in 0..2500 {
        let steer = if k * 2 < 100 { 0.0 } else { 0.03 };
        w.set_input(
            0,
            VehicleInput {
                steer,
                throttle: 0.15,
                ..VehicleInput::default()
            },
        )
        .unwrap();
        w.step(dt);
        yaw.push(w.telemetry_of(0)[t::YAW_RATE]);
    }
    let last = *yaw.last().unwrap();
    let k90 = yaw
        .iter()
        .position(|r| r.abs() >= 0.9 * last.abs())
        .unwrap();
    k90 as f64 * dt - 0.1
}

#[test]
fn toe_in_slows_the_step_steer_response() {
    let plain = step_response(VehicleDefinition::default());
    let toe = step_response(toed(1.0, 0.5));
    assert!(toe > plain + 0.01, "{toe} vs {plain}");
}

#[test]
fn a_toed_in_car_still_parks_on_a_cross_slope() {
    let mut w = world(toed(1.0, 0.5), 0.0);
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
}

#[test]
fn bad_toe_is_rejected() {
    assert!(toed(10.5, 0.0).validate().is_err());
    assert!(toed(0.0, f64::NAN).validate().is_err());
    assert!(toed(-10.0, 10.0).validate().is_ok());
}
