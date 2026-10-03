//! Suspension geometry that changes with travel (ADR-0026): the definition
//! format and its validation; a car without curves runs bit for bit as
//! before; each curve moves what it says at a known travel; a roll centre
//! that moves jacks the body in a turn; and the state survives a snapshot.

mod common;

use common::curve;
use skidpad_core::kinematics::{KinematicsDef, TravelCurve};
use skidpad_core::snapshot::Snapshottable;
use skidpad_core::telemetry as t;
use skidpad_core::vehicle::four_wheel::{FL, FR, RL, RR};
use skidpad_core::vehicle::FourWheelVehicle;
use skidpad_core::{VehicleDefinition, VehicleInput, World};
use skidpad_math as m;

const CASES: &str = include_str!("fixtures/kinematics_validation.json");

fn kinematics_errors(d: &VehicleDefinition) -> Vec<String> {
    match d.validate() {
        Ok(()) => Vec::new(),
        Err(e) => e.into_iter().filter(|m| m.contains("kinematics")).collect(),
    }
}

/// The same cases and messages as `packages/core/test/kinematics.test.ts`.
#[test]
fn validation_matches_the_shared_cases() {
    let cases: serde_json::Value = serde_json::from_str(CASES).unwrap();
    for case in cases["cases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let axle = case["axle"].as_u64().unwrap() as usize;
        let mut d = serde_json::to_value(VehicleDefinition::default()).unwrap();
        let a = &mut d["axles"][axle];
        if let Some(fields) = case.get("axleFields").and_then(|f| f.as_object()) {
            for (k, v) in fields {
                a[k] = v.clone();
            }
        }
        if let Some(fields) = case.get("suspensionFields").and_then(|f| f.as_object()) {
            for (k, v) in fields {
                a["suspension"][k] = v.clone();
            }
        }
        let d: VehicleDefinition = serde_json::from_value(d).unwrap();
        let expected: Vec<String> = case["errors"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e.as_str().unwrap().to_string())
            .collect();
        assert_eq!(kinematics_errors(&d), expected, "case {name}");
    }
}

#[test]
fn the_block_is_optional_and_left_out_when_absent() {
    let d = VehicleDefinition::default();
    assert!(d.axles.iter().all(|a| a.suspension.kinematics.is_none()));
    let json = serde_json::to_string(&d).unwrap();
    assert!(!json.contains("kinematics"));
}

#[test]
fn curves_round_trip_through_json() {
    let mut d = VehicleDefinition::default();
    d.axles[0].suspension.kinematics = Some(KinematicsDef {
        toe_deg: Some(TravelCurve::new(&[[-0.08, 0.3], [0.0, 0.0], [0.08, -0.4]])),
        roll_center_height: Some(TravelCurve::new(&[[-0.1, 0.05], [0.1, -0.05]])),
        ..KinematicsDef::default()
    });
    d.axles[1].suspension.kinematics = Some(KinematicsDef::default());
    let json = serde_json::to_string(&d).unwrap();
    assert!(json.contains(r#""toeDeg":[[-0.08,0.3],[0.0,0.0],[0.08,-0.4]]"#));
    assert!(!json.contains("camberDeg"));
    let back: VehicleDefinition = serde_json::from_str(&json).unwrap();
    assert_eq!(back, d);
    assert!(back.axles[1]
        .suspension
        .kinematics
        .as_ref()
        .unwrap()
        .is_empty());
}

const PRESETS: [(&str, &str); 6] = [
    (
        "hatchbackFwd",
        include_str!("../../../packages/presets/src/vehicles/hatchback-fwd.json"),
    ),
    (
        "sportsRwd",
        include_str!("../../../packages/presets/src/vehicles/sports-rwd.json"),
    ),
    (
        "kart",
        include_str!("../../../packages/presets/src/vehicles/kart.json"),
    ),
    (
        "pickup4x4",
        include_str!("../../../packages/presets/src/vehicles/pickup-4x4.json"),
    ),
    (
        "crossoverEv",
        include_str!("../../../packages/presets/src/vehicles/crossover-ev.json"),
    ),
    (
        "openWheeler",
        include_str!("../../../packages/presets/src/vehicles/open-wheeler.json"),
    ),
];

/// The default car and every preset, without any travel curves the preset
/// ships with: these tests are about the path without curves.
fn vehicles() -> Vec<(String, VehicleDefinition)> {
    let mut out = vec![(String::from("default"), VehicleDefinition::default())];
    for (id, json) in PRESETS {
        let mut d: VehicleDefinition = serde_json::from_str(json).unwrap();
        for a in &mut d.axles {
            a.suspension.kinematics = None;
        }
        out.push((id.to_string(), d));
    }
    out
}

#[test]
fn the_presets_curves_are_valid() {
    for (id, json) in PRESETS {
        let d: VehicleDefinition = serde_json::from_str(json).unwrap();
        assert!(d.validate().is_ok(), "{id}: {:?}", d.validate());
    }
}

/// A drive that exercises every term: launch, a slalom, braking in a turn.
/// Returns the state hash and the telemetry at a few points.
fn drive(d: VehicleDefinition) -> (Vec<u64>, Vec<Vec<f64>>) {
    let mut w = World::new(1);
    w.add_vehicle(d).unwrap();
    w.vehicle_mut(0).unwrap().model.set_speed(15.0);
    let (mut hashes, mut records) = (Vec::new(), Vec::new());
    for k in 0..240 {
        let tt = k as f64 / 60.0;
        let input = VehicleInput {
            steer: 0.4 * m::sin(1.5 * tt),
            throttle: if tt < 2.0 { 0.8 } else { 0.0 },
            brake: if tt > 2.5 { 0.5 } else { 0.0 },
            ..VehicleInput::default()
        };
        w.set_input(0, input).unwrap();
        w.step(1.0 / 60.0);
        if k % 60 == 59 {
            hashes.push(w.state_hash(0).unwrap());
            records.push(w.telemetry_of(0).to_vec());
        }
    }
    (hashes, records)
}

fn same_bits(a: &[Vec<f64>], b: &[Vec<f64>]) -> bool {
    a.iter()
        .zip(b)
        .all(|(x, y)| x.iter().zip(y).all(|(p, q)| p.to_bits() == q.to_bits()))
}

#[test]
fn no_curve_and_an_empty_block_run_bit_for_bit_as_before() {
    for (id, d) in vehicles() {
        assert!(d.axles.iter().all(|a| a.suspension.kinematics.is_none()));
        let (base_hashes, base) = drive(d.clone());
        let mut empty = d.clone();
        for a in &mut empty.axles {
            a.suspension.kinematics = Some(KinematicsDef::default());
        }
        let (h, r) = drive(empty);
        assert_eq!(h, base_hashes, "{id}: empty block");
        assert!(same_bits(&r, &base), "{id}: empty block telemetry");
    }
}

/// A zero toe, camber or anti curve adds exactly zero. A zero roll-centre
/// curve is not a no-op: it switches the axle to the per-wheel link forces,
/// which differ from the per-axle couple whenever the two wheels' lateral
/// forces differ.
#[test]
fn zero_curves_other_than_the_roll_centre_change_nothing() {
    let zero = || Some(curve(0.0, 0.0));
    for (id, d) in vehicles() {
        let (base_hashes, base) = drive(d.clone());
        let mut z = d.clone();
        for a in &mut z.axles {
            let solid = a.suspension.kind == skidpad_core::definition::SuspensionKind::Solid;
            a.suspension.kinematics = Some(KinematicsDef {
                toe_deg: if solid { None } else { zero() },
                camber_deg: if solid { None } else { zero() },
                anti_brake: zero(),
                anti_drive: zero(),
                roll_center_height: None,
            });
        }
        assert!(z.validate().is_ok(), "{id}");
        let (h, r) = drive(z);
        assert_eq!(h, base_hashes, "{id}: zero curves");
        assert!(same_bits(&r, &base), "{id}: zero curves telemetry");
    }
}

/// The default car with one axle's suspension given `k`, parked level, then
/// pushed down by `heave` m (both wheels in bump) for one substep, so every
/// wheel sits at that travel with the body level.
fn heaved(k: KinematicsDef, heave: f64) -> FourWheelVehicle {
    let mut d = VehicleDefinition::default();
    d.axles[0].static_toe_deg = 0.1;
    d.axles[0].static_camber_deg = -1.0;
    d.axles[0].suspension.roll_center_height = 0.05;
    d.axles[0].suspension.anti_brake = 0.2;
    d.axles[0].suspension.anti_drive = 0.1;
    d.axles[0].suspension.kinematics = Some(k);
    assert!(d.validate().is_ok(), "{:?}", d.validate());
    let mut car = FourWheelVehicle::new(d);
    car.pos.z -= heave;
    car
}

const CURVE: [[f64; 2]; 3] = [[-0.1, 0.4], [0.0, 0.0], [0.1, -0.6]];

/// Value of `CURVE` at 30 mm of bump, three tenths of the way to its bump
/// end point. Each test reads it in the units of the curve under test.
fn curve_at_bump() -> f64 {
    -0.6 * 0.03 / 0.1
}

#[test]
fn the_toe_curve_turns_each_wheel_by_its_travel() {
    let mut car = heaved(
        KinematicsDef {
            toe_deg: Some(TravelCurve::new(&CURVE)),
            ..KinematicsDef::default()
        },
        0.03,
    );
    car.substep(1e-3, &VehicleInput::default());
    for i in [FL, FR] {
        let w = &car.wheels[i];
        assert!((w.travel - 0.03).abs() < 1e-9, "travel {}", w.travel);
        let toe = m::deg_to_rad(0.1 + curve_at_bump());
        assert!((w.toe - toe).abs() < 1e-12, "toe {} vs {toe}", w.toe);
        // Toe-in points the left wheel right (negative), mirrored on the right.
        let side = if i == FL { 1.0 } else { -1.0 };
        assert!((w.steer + side * toe).abs() < 1e-12);
    }
    let v = telemetry(&car);
    assert!((v[t::TOE_FL] - v[t::TOE_FR]).abs() < 1e-15);
    assert!((v[t::TOE_FL] - m::deg_to_rad(0.1 + curve_at_bump())).abs() < 1e-12);
    // The rear has no curve and no static toe.
    assert_eq!(v[t::TOE_RL], 0.0);
    assert_eq!(car.wheels[RL].steer, 0.0);
}

#[test]
fn the_camber_curve_adds_to_the_static_camber_by_side() {
    let mut car = heaved(
        KinematicsDef {
            camber_deg: Some(TravelCurve::new(&CURVE)),
            ..KinematicsDef::default()
        },
        0.03,
    );
    car.substep(1e-3, &VehicleInput::default());
    // Level body: no lean term. Negative camber is top-in, which is
    // negative ISO camber on the left wheel and positive on the right.
    let camber = m::deg_to_rad(-1.0 + curve_at_bump());
    assert!((car.wheels[FL].camber - camber).abs() < 1e-9);
    assert!((car.wheels[FR].camber + camber).abs() < 1e-9);
    assert!(car.wheels[RL].camber.abs() < 1e-9);
}

#[test]
fn the_roll_centre_curve_sets_each_wheels_link_force_at_its_travel() {
    let mut car = heaved(
        KinematicsDef {
            roll_center_height: Some(TravelCurve::new(&CURVE)),
            ..KinematicsDef::default()
        },
        0.03,
    );
    // Lateral forces of the previous substep: unequal, as in a left turn
    // with the right wheel outside.
    car.wheel_fy_prev = [1000.0, 3000.0, 800.0, 2000.0];
    car.axle_fy_prev = [4000.0, 2800.0];
    car.substep(1e-3, &VehicleInput::default());
    let track = car.definition().axle_track(0);
    // Static height plus the curve, here a height change in metres.
    let h = 0.05 + curve_at_bump();
    let fl = -2.0 * 1000.0 * h / track;
    let fr = 2.0 * 3000.0 * h / track;
    assert!((car.wheels[FL].geometric_load - fl).abs() < 1e-6);
    assert!((car.wheels[FR].geometric_load - fr).abs() < 1e-6);
    // The rear has no curve and no static roll centre.
    assert_eq!(car.wheels[RL].geometric_load, 0.0);
    assert_eq!(car.wheels[RR].geometric_load, 0.0);
    let v = telemetry(&car);
    assert!((v[t::JACKING_FORCE_F] - (fl + fr)).abs() < 1e-6);
    assert_eq!(v[t::JACKING_FORCE_R], 0.0);
}

#[test]
fn equal_forces_and_heights_reduce_to_the_axle_couple() {
    let flat = KinematicsDef {
        roll_center_height: Some(TravelCurve::new(&CURVE)),
        ..KinematicsDef::default()
    };
    let mut curved = heaved(flat, 0.0);
    let mut plain = heaved(KinematicsDef::default(), 0.0);
    for car in [&mut curved, &mut plain] {
        car.wheel_fy_prev = [1500.0, 1500.0, 0.0, 0.0];
        car.axle_fy_prev = [3000.0, 0.0];
        car.substep(1e-3, &VehicleInput::default());
    }
    for i in [FL, FR] {
        let (a, b) = (
            curved.wheels[i].geometric_load,
            plain.wheels[i].geometric_load,
        );
        assert!((a - b).abs() < 1e-9 * b.abs(), "{a} vs {b}");
    }
    assert!(telemetry(&curved)[t::JACKING_FORCE_F].abs() < 1e-9);
}

#[test]
fn the_anti_curves_set_the_fraction_at_each_wheels_travel() {
    for braking in [true, false] {
        let k = KinematicsDef {
            anti_brake: Some(TravelCurve::new(&CURVE)),
            anti_drive: Some(TravelCurve::new(&[[-0.1, -0.1], [0.0, 0.0], [0.1, 0.2]])),
            ..KinematicsDef::default()
        };
        let mut car = heaved(k, 0.03);
        let fx = if braking { -2000.0 } else { 1500.0 };
        car.axle_fx_prev = [fx, 0.0];
        car.substep(1e-3, &VehicleInput::default());
        let d = car.definition();
        let (h, l) = (d.chassis.cg_height, d.chassis.wheelbase);
        let anti = if braking {
            0.2 + curve_at_bump()
        } else {
            0.1 + 0.2 * 0.03 / 0.1
        };
        // Front: the link force is −½ · anti · F_x · h / L per wheel.
        let expected = -0.5 * anti * fx * h / l;
        for i in [FL, FR] {
            let got = car.wheels[i].pitch_load;
            assert!(
                (got - expected).abs() < 1e-9,
                "braking {braking}: {got} vs {expected}"
            );
        }
    }
}

fn telemetry(car: &FourWheelVehicle) -> Vec<f64> {
    let mut rec = vec![0.0; t::STRIDE];
    car.write_telemetry(&VehicleInput::default(), &mut rec);
    rec
}

/// Steady left turn at 20 m/s; means over the last second of the body
/// height, the front share of the lateral load transfer, the front
/// jacking force and the lateral acceleration.
fn steady_turn(d: VehicleDefinition) -> (f64, f64, f64, f64) {
    let mut w = World::new(1);
    w.add_vehicle(d).unwrap();
    w.vehicle_mut(0).unwrap().model.set_speed(20.0);
    w.set_input(
        0,
        VehicleInput {
            steer: -0.08,
            throttle: 0.25,
            ..VehicleInput::default()
        },
    )
    .unwrap();
    let (mut z, mut share, mut jack, mut ay, mut n) = (0.0, 0.0, 0.0, 0.0, 0.0);
    for k in 0..400 {
        w.step(0.01);
        if k >= 300 {
            let v = w.telemetry_of(0);
            let front = m::abs(v[t::LOAD_FR] - v[t::LOAD_FL]);
            let rear = m::abs(v[t::LOAD_RR] - v[t::LOAD_RL]);
            z += v[t::POS_Z];
            share += front / (front + rear);
            jack += v[t::JACKING_FORCE_F];
            ay += v[t::LAT_ACCEL];
            n += 1.0;
        }
    }
    (z / n, share / n, jack / n, ay / n)
}

fn front_roll_centre(curve_rc: Option<TravelCurve>) -> VehicleDefinition {
    let mut d = VehicleDefinition::default();
    d.axles[0].suspension.roll_center_height = 0.1;
    d.axles[0].suspension.kinematics = Some(KinematicsDef {
        roll_center_height: curve_rc,
        ..KinematicsDef::default()
    });
    d
}

/// The per-wheel form jacks the body even at a constant height, because
/// the loaded outer tire carries more lateral force than the inner one
/// (decision 7 of ADR-0026). A roll centre that rises in bump lifts the
/// outer link and jacks harder; one that falls jacks less, or pulls the
/// body down.
#[test]
fn the_roll_centre_curve_orders_the_jacking() {
    let (z_none, _, jack_none, ay) = steady_turn(front_roll_centre(None));
    assert!(ay > 5.0, "lateral acceleration {ay}");
    assert_eq!(jack_none, 0.0);
    let mut last = (f64::NEG_INFINITY, f64::NEG_INFINITY);
    for (droop, bump) in [
        (0.3, -0.3),
        (0.08, -0.08),
        (0.0, 0.0),
        (-0.08, 0.08),
        (-0.3, 0.3),
    ] {
        let (z, _, jack, _) = steady_turn(front_roll_centre(Some(curve(droop, bump))));
        assert!(
            jack > last.0 + 50.0,
            "{bump}: jacking {jack} after {}",
            last.0
        );
        assert!(
            z > last.1 + 1e-4,
            "{bump}: body height {z} after {}",
            last.1
        );
        last = (jack, z);
    }
    // A constant height already lifts the body against the per-axle couple.
    let (z_zero, _, jack_zero, _) = steady_turn(front_roll_centre(Some(curve(0.0, 0.0))));
    assert!(jack_zero > 50.0 && z_zero > z_none + 1e-3);
    // A steeply falling roll centre pulls the body down.
    let (z_fall, _, jack_fall, _) = steady_turn(front_roll_centre(Some(curve(0.3, -0.3))));
    assert!(jack_fall < -50.0 && z_fall < z_none);
}

/// A roll centre that falls in bump, as on most road-car front ends and on
/// the Chrono E90, moves lateral load transfer off the front axle in a
/// turn: the outer wheel's link flattens as it compresses. A rising one is
/// not the mirror image, because the extra jacking extends both springs
/// and moves both wheels toward droop, where a rising curve lowers both
/// heights, so it is not asserted.
#[test]
fn a_roll_centre_falling_in_bump_moves_transfer_rearward() {
    let (_, share_zero, _, _) = steady_turn(front_roll_centre(Some(curve(0.0, 0.0))));
    let (_, share_some, _, _) = steady_turn(front_roll_centre(Some(curve(0.08, -0.08))));
    let (_, share_steep, _, _) = steady_turn(front_roll_centre(Some(curve(0.3, -0.3))));
    assert!(
        share_some < share_zero - 0.001,
        "{share_some} vs {share_zero}"
    );
    assert!(
        share_steep < share_some - 0.01,
        "{share_steep} vs {share_some}"
    );
}

#[test]
fn a_snapshot_with_curves_reproduces_the_run() {
    let d = common::with_steep_curves(VehicleDefinition::default());
    let mut w = World::new(1);
    w.add_vehicle(d).unwrap();
    w.vehicle_mut(0).unwrap().model.set_speed(18.0);
    w.set_input(
        0,
        VehicleInput {
            steer: -0.3,
            throttle: 0.4,
            ..VehicleInput::default()
        },
    )
    .unwrap();
    for _ in 0..120 {
        w.step(1.0 / 60.0);
    }
    let mut buf = vec![0u8; w.snapshot_len(0).unwrap()];
    w.snapshot(0, &mut buf).unwrap();
    let car = w.vehicle(0).unwrap().model.as_four_wheel().unwrap();
    assert!(car.wheel_fy_prev.iter().all(|f| f.abs() > 1.0));
    let run = |w: &mut World| {
        for _ in 0..60 {
            w.step(1.0 / 60.0);
        }
        w.state_hash(0).unwrap()
    };
    let a = run(&mut w);
    w.restore(0, &buf).unwrap();
    let b = run(&mut w);
    assert_eq!(a, b);
    let mut scratch = vec![0.0; 256];
    let car = w.vehicle(0).unwrap().model.as_four_wheel().unwrap();
    assert!(car.state_hash(&mut scratch) == a);
}
