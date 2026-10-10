//! Compliance steer (ADR-0027): the steered wheels turn with the steering
//! system's wind-up under the kingpin torque, and each wheel turns under its
//! own lateral force. Off by default; with it, the understeer gradient grows
//! by Gillespie's terms (Fundamentals of Vehicle Dynamics, ch. 6), the angles
//! point the right way, both models agree, every substep rate holds, and a
//! snapshot restores the state exactly.

use skidpad_core::definition::VehicleModelKind;
use skidpad_core::telemetry as t;
use skidpad_core::validation::{step_steer, understeer, StepSteerConfig, UndersteerConfig};
use skidpad_core::{VehicleDefinition, VehicleInput, World, GRAVITY};

fn turn(d: VehicleDefinition) -> Vec<f64> {
    let mut w = World::new(1);
    w.add_vehicle(d).unwrap();
    w.vehicle_mut(0).unwrap().model.set_speed(15.0);
    let input = VehicleInput {
        steer: -0.08, // left
        throttle: 0.2,
        ..VehicleInput::default()
    };
    w.set_input(0, input).unwrap();
    for _ in 0..300 {
        w.step(0.01);
    }
    w.telemetry_of(0).to_vec()
}

fn compliant(c_at: f64, c_front: f64, c_rear: f64) -> VehicleDefinition {
    let mut d = VehicleDefinition::default();
    d.steering.align_torque_compliance_deg = c_at;
    d.axles[0].lateral_compliance_steer_deg = c_front;
    d.axles[1].lateral_compliance_steer_deg = c_rear;
    d
}

#[test]
fn defaults_have_no_compliance() {
    let d = VehicleDefinition::default();
    assert_eq!(d.steering.align_torque_compliance_deg, 0.0);
    assert_eq!(d.axles[0].lateral_compliance_steer_deg, 0.0);
    assert_eq!(d.axles[1].lateral_compliance_steer_deg, 0.0);
    let v = turn(d);
    for i in 0..4 {
        assert_eq!(v[t::COMPLIANCE_STEER_FL + i], 0.0);
    }
}

#[test]
fn compliance_steers_toward_understeer() {
    let v = turn(compliant(5.0, 0.2, 0.2));
    // A left turn (+ yaw): the front wheels steer right, out of the turn,
    // and the rear wheels left, into it.
    assert!(v[t::YAW_RATE] > 0.1, "{}", v[t::YAW_RATE]);
    for k in [t::COMPLIANCE_STEER_FL, t::COMPLIANCE_STEER_FR] {
        assert!(v[k] < -1e-4, "{}", v[k]);
    }
    for k in [t::COMPLIANCE_STEER_RL, t::COMPLIANCE_STEER_RR] {
        assert!(v[k] > 1e-5, "{}", v[k]);
    }
    // The wheel angle carries it; the driver's angle does not.
    let fl = v[t::WHEEL_STEER_FL] - v[t::COMPLIANCE_STEER_FL];
    let plain = turn(VehicleDefinition::default());
    assert!((v[t::STEER_ANGLE] - plain[t::STEER_ANGLE]).abs() < 1e-12);
    assert!(fl > 0.0);
}

fn gradient(d: &VehicleDefinition) -> f64 {
    let cfg = UndersteerConfig::default();
    understeer::run(d, &cfg).unwrap().gradient
}

/// Gillespie's aligning-torque term: the front axle's kingpin torque per
/// m/s² is `(t_m + t_p) · W_f / g`, and the wheels give `c` rad per N·m of it.
#[test]
fn aligning_torque_compliance_adds_its_understeer_term() {
    let base = VehicleDefinition::default();
    let c_deg = 4.0;
    let d = compliant(c_deg, 0.0, 0.0);
    let measured = gradient(&d) - gradient(&base);
    let wf = base.chassis.mass * GRAVITY * base.cg_to_rear_axle() / base.chassis.wheelbase;
    let trail = base.steering.mechanical_trail + base.axles[0].tire.static_trail(0.5 * wf);
    let c = c_deg.to_radians() * 1e-3;
    let expected = c * trail * wf / GRAVITY;
    assert!(
        (measured / expected - 1.0).abs() < 0.1,
        "measured {measured}, Gillespie {expected}"
    );
}

/// Gillespie's lateral-force compliance terms: each wheel carries half its
/// axle's load times `a_y / g`, and steers `c` rad per N of it.
#[test]
fn lateral_compliance_adds_its_understeer_terms() {
    let base = VehicleDefinition::default();
    let (cf_deg, cr_deg) = (0.25, 0.15);
    let d = compliant(0.0, cf_deg, cr_deg);
    let measured = gradient(&d) - gradient(&base);
    let l = base.chassis.wheelbase;
    let mg = base.chassis.mass * GRAVITY;
    let wf = mg * base.cg_to_rear_axle() / l;
    let wr = mg * base.chassis.cg_to_front_axle / l;
    let expected = (cf_deg.to_radians() * 1e-3 * 0.5 * wf + cr_deg.to_radians() * 1e-3 * 0.5 * wr) / GRAVITY;
    assert!(
        (measured / expected - 1.0).abs() < 0.1,
        "measured {measured}, Gillespie {expected}"
    );
}

#[test]
fn the_single_track_model_carries_the_same_compliance() {
    let mut four = compliant(4.0, 0.2, 0.1);
    let mut single = four.clone();
    single.simulation.model = VehicleModelKind::SingleTrack;
    let mut four_base = VehicleDefinition::default();
    let mut single_base = four_base.clone();
    single_base.simulation.model = VehicleModelKind::SingleTrack;
    four.simulation.model = VehicleModelKind::FourWheel;
    four_base.simulation.model = VehicleModelKind::FourWheel;
    let d4 = gradient(&four) - gradient(&four_base);
    let d1 = gradient(&single) - gradient(&single_base);
    assert!(d4 > 0.0 && d1 > 0.0, "{d4} {d1}");
    assert!((d1 / d4 - 1.0).abs() < 0.15, "four-wheel {d4}, single-track {d1}");
}

/// A compliance as large as a recirculating-ball SUV's (the NHTSA Jeep
/// comparison wants about 10 deg/kN·m) holds at every supported rate.
#[test]
fn large_compliance_is_stable_at_every_substep_rate() {
    let mut yaw = Vec::new();
    for rate in [250.0, 500.0, 1000.0, 2000.0] {
        let mut d = compliant(12.0, 0.3, 0.2);
        d.simulation.substep_rate_hz = rate;
        let r = step_steer::run(&d, &StepSteerConfig::default()).unwrap();
        assert!(r.yaw_rate.is_finite() && r.yaw_rate.abs() > 0.05, "{rate} Hz: {}", r.yaw_rate);
        assert!(r.yaw_rate_overshoot < 0.5, "{rate} Hz: overshoot {}", r.yaw_rate_overshoot);
        yaw.push(r.yaw_rate);
    }
    for y in &yaw {
        assert!((y / yaw[2] - 1.0).abs() < 0.01, "{yaw:?}");
    }
}

#[test]
fn a_snapshot_restores_the_compliance_state() {
    for model in [VehicleModelKind::FourWheel, VehicleModelKind::SingleTrack] {
        let mut d = compliant(8.0, 0.2, 0.1);
        d.simulation.model = model;
        let mut w = World::new(1);
        w.add_vehicle(d).unwrap();
        w.vehicle_mut(0).unwrap().model.set_speed(20.0);
        let input = VehicleInput {
            steer: 0.1,
            throttle: 0.3,
            ..VehicleInput::default()
        };
        w.set_input(0, input).unwrap();
        for _ in 0..100 {
            w.step(0.01);
        }
        let mut buf = vec![0u8; w.snapshot_len(0).unwrap()];
        w.snapshot(0, &mut buf).unwrap();
        for _ in 0..100 {
            w.step(0.01);
        }
        let after = w.state_hash(0).unwrap();
        w.restore(0, &buf).unwrap();
        for _ in 0..100 {
            w.step(0.01);
        }
        assert_eq!(w.state_hash(0).unwrap(), after, "{model:?}");
    }
}
