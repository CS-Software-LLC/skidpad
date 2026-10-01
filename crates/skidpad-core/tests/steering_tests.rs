//! Steering geometry and rack force (ADR-0012): kingpin torque composition,
//! torque steer through the scrub radius, power assist, the single-track
//! equivalence, and jacking.

use skidpad_core::definition::VehicleModelKind;
use skidpad_core::drivetrain::DifferentialKind;
use skidpad_core::telemetry as t;
use skidpad_core::vehicle::{FourWheelVehicle, FL, FR, RL, RR};
use skidpad_core::{VehicleDefinition, VehicleInput, World};

fn settle(w: &mut World, input: VehicleInput, seconds: f64) {
    w.set_input(0, input).unwrap();
    for _ in 0..(seconds * 100.0) as usize {
        w.step(0.01);
    }
}

fn cornering() -> VehicleInput {
    VehicleInput {
        steer: 0.25,
        throttle: 0.35,
        ..VehicleInput::default()
    }
}

#[test]
fn kingpin_torque_composes_trail_scrub_and_assist() {
    let d = VehicleDefinition::default();
    // Pure aligning moment, no forces.
    assert_eq!(d.kingpin_torque(10.0, 0.0, 0.0, 1.0), 10.0);
    // Mechanical trail acts like the pneumatic trail: `−t·Fy`.
    assert!((d.kingpin_torque(0.0, 1000.0, 0.0, 1.0) + 0.02 * 1000.0).abs() < 1e-12);
    // Scrub radius: a forward force on the left wheel steers right (negative
    // about z), on the right wheel left; equal forces cancel.
    let l = d.kingpin_torque(0.0, 0.0, 500.0, 1.0);
    let r = d.kingpin_torque(0.0, 0.0, 500.0, -1.0);
    assert!((l + 0.01 * 500.0).abs() < 1e-12 && (r - 0.01 * 500.0).abs() < 1e-12);
    assert_eq!(l + r, 0.0);
    // Hand wheel: through the ratio, in the input sign, less the assist.
    assert!((d.hand_wheel_torque(14.0) + 1.0).abs() < 1e-12);
    let mut assisted = d.clone();
    assisted.steering.power_assist = 0.75;
    assert!((assisted.hand_wheel_torque(14.0) + 0.25).abs() < 1e-12);
}

#[test]
fn mechanical_trail_adds_to_the_steering_torque_in_a_turn() {
    let mut w = World::new(1);
    w.add_vehicle(VehicleDefinition::default()).unwrap();
    settle(&mut w, cornering(), 6.0);
    let base = w.telemetry_of(0)[t::STEERING_TORQUE];
    let mut d = VehicleDefinition::default();
    d.steering.mechanical_trail = 0.06;
    let mut w2 = World::new(1);
    w2.add_vehicle(d).unwrap();
    settle(&mut w2, cornering(), 6.0);
    let more = w2.telemetry_of(0)[t::STEERING_TORQUE];
    // Turning right (positive input) the tires push the wheel back toward
    // centre: a negative torque in the input sign, which is what a
    // force-feedback wheel is driven with.
    assert!(base < -0.5, "turning right the wheel pulls back: {base}");
    assert!(more < 1.3 * base, "trail 0.06 m: {more} vs {base}");
    assert!(w2.telemetry_of(0)[t::RACK_FORCE].abs() > w.telemetry_of(0)[t::RACK_FORCE].abs());
}

#[test]
fn a_front_limited_slip_differential_gives_torque_steer_through_the_scrub_radius() {
    // FWD default car: open front differential puts equal force on both
    // front wheels and the scrub terms cancel; an LSD biases torque to the
    // slower (inner) wheel and the rack feels the difference.
    let run = |kind: DifferentialKind, scrub: f64| {
        let mut d = VehicleDefinition::default();
        d.drivetrain.front.kind = kind;
        d.drivetrain.front.bias_drive = 3.0;
        d.drivetrain.front.preload = 100.0;
        d.steering.scrub_radius = scrub;
        d.steering.mechanical_trail = 0.0;
        let mut w = World::new(1);
        w.add_vehicle(d).unwrap();
        settle(
            &mut w,
            VehicleInput {
                steer: 0.3,
                throttle: 0.8,
                ..VehicleInput::default()
            },
            6.0,
        );
        let v = w.telemetry_of(0);
        (
            v[t::STEERING_TORQUE],
            v[t::DIFF_LOCK_TORQUE_F],
            v[t::FX_FL] - v[t::FX_FR],
        )
    };
    let (open_no_scrub, _, _) = run(DifferentialKind::Open, 0.0);
    let (open_scrub, _, dfx_open) = run(DifferentialKind::Open, 0.04);
    let (lsd_scrub, lock, dfx_lsd) = run(DifferentialKind::Lsd, 0.04);
    // Equal torques; the forces differ only by the rolling resistance of
    // the unequal loads.
    assert!(
        dfx_open.abs() < 150.0,
        "open diff: equal drive torques ({dfx_open} N)"
    );
    // Near-symmetric forces: the scrub term is only the rolling-resistance
    // difference of the unequal loads.
    assert!(
        (open_scrub - open_no_scrub).abs() < 0.4,
        "scrub alone is nearly silent: {open_scrub} vs {open_no_scrub}"
    );
    assert!(lock.abs() > 50.0, "the LSD is working: {lock} N·m");
    assert!(
        dfx_lsd.abs() > 2.0 * dfx_open.abs() + 200.0,
        "LSD biases the drive force: {dfx_lsd} N"
    );
    assert!(
        (lsd_scrub - open_scrub).abs() > 3.0 * (open_scrub - open_no_scrub).abs() + 0.3,
        "torque steer: {lsd_scrub} vs {open_scrub} N·m"
    );
}

#[test]
fn single_track_and_four_wheel_agree_on_the_hand_wheel_torque_in_the_linear_range() {
    let mut four = World::new(1);
    four.add_vehicle(VehicleDefinition::default()).unwrap();
    let mut d = VehicleDefinition::default();
    d.simulation.model = VehicleModelKind::SingleTrack;
    let mut single = World::new(1);
    single.add_vehicle(d).unwrap();
    let gentle = VehicleInput {
        steer: 0.1,
        throttle: 0.3,
        ..VehicleInput::default()
    };
    settle(&mut four, gentle, 8.0);
    settle(&mut single, gentle, 8.0);
    let a = four.telemetry_of(0)[t::STEERING_TORQUE];
    let b = single.telemetry_of(0)[t::STEERING_TORQUE];
    assert!(a < -0.2 && b < -0.2, "{a} {b}");
    assert!(
        (a - b).abs() < 0.35 * a.abs().max(b.abs()),
        "four-wheel {a} vs single-track {b} N·m"
    );
}

#[test]
fn jacking_unloads_the_inner_rear_wheel_and_is_absent_at_zero_rate() {
    let kart: VehicleDefinition = serde_json::from_str(include_str!(
        "../../../packages/presets/src/vehicles/kart.json"
    ))
    .unwrap();
    assert!(kart.steering.jacking_rate > 0.0, "the kart preset jacks");
    let loads = |rate: f64| {
        let mut d = kart.clone();
        d.steering.jacking_rate = rate;
        let mut car = FourWheelVehicle::new(d);
        car.set_speed(8.0);
        // Steer left (negative input) at a steady throttle.
        let input = VehicleInput {
            steer: -0.5,
            throttle: 0.3,
            ..VehicleInput::default()
        };
        for _ in 0..3000 {
            car.substep(0.001, &input);
        }
        [
            car.wheels[FL].load,
            car.wheels[FR].load,
            car.wheels[RL].load,
            car.wheels[RR].load,
        ]
    };
    let flat = loads(0.0);
    let jacked = loads(kart.steering.jacking_rate);
    // Left turn: inner = left. Jacking loads the inner front and unloads the
    // inner rear, diagonally.
    assert!(
        jacked[0] > flat[0] + 30.0,
        "inner front {} vs {}",
        jacked[0],
        flat[0]
    );
    assert!(
        jacked[1] < flat[1] - 30.0,
        "outer front {} vs {}",
        jacked[1],
        flat[1]
    );
    assert!(
        jacked[2] < flat[2] - 60.0,
        "inner rear {} vs {}",
        jacked[2],
        flat[2]
    );
    assert!(
        jacked[3] > flat[3] + 60.0,
        "outer rear {} vs {}",
        jacked[3],
        flat[3]
    );
    let total: f64 = jacked.iter().sum();
    let total_flat: f64 = flat.iter().sum();
    assert!(
        (total - total_flat).abs() < 0.05 * total_flat,
        "weight is conserved"
    );
}

#[test]
fn bad_steering_geometry_is_rejected() {
    let mut d = VehicleDefinition::default();
    d.steering.power_assist = 1.5;
    assert!(d.validate().is_err());
    let mut d = VehicleDefinition::default();
    d.steering.steering_arm = 0.0;
    assert!(d.validate().is_err());
    let mut d = VehicleDefinition::default();
    d.steering.jacking_rate = 2.0;
    assert!(d.validate().is_err());
}
