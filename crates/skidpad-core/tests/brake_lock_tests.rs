//! Locked-brake behaviour (milestone 3): braking from 100 km/h with no ABS
//! on every preset, both models, across the substep-rate sweep. Wheels that
//! lock must lock once and stay locked (no chatter), the deceleration on
//! sliding friction must be smooth, and the car must come to a clean rest on
//! the held brake.

use skidpad_core::definition::VehicleModelKind;
use skidpad_core::validation::{straight_line, StraightLineConfig};
use skidpad_core::VehicleDefinition;

const PRESETS: [(&str, &str); 3] = [
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
];

fn presets() -> Vec<(String, VehicleDefinition)> {
    let mut out = Vec::new();
    for (id, json) in PRESETS {
        let mut d: VehicleDefinition = serde_json::from_str(json).unwrap();
        // The stop is measured without ABS, whatever the preset ships with.
        d.assists.abs.enabled = false;
        out.push((id.to_string(), d));
    }
    out.push((String::from("default"), VehicleDefinition::default()));
    out
}

fn wheel_count(model: VehicleModelKind) -> u32 {
    match model {
        VehicleModelKind::FourWheel => 4,
        VehicleModelKind::SingleTrack => 2,
    }
}

#[test]
fn brakes_lock_once_without_chatter_and_the_car_stops_cleanly() {
    for (id, base) in presets() {
        for model in [VehicleModelKind::FourWheel, VehicleModelKind::SingleTrack] {
            for rate in [250.0, 500.0, 1000.0, 2000.0] {
                let mut d = base.clone();
                d.simulation.model = model;
                d.simulation.substep_rate_hz = rate;
                let r = straight_line::run(&d, &StraightLineConfig::default()).unwrap();
                let tag = format!("{id} {model:?} at {rate} Hz");
                // Every reference vehicle out-brakes its tires without ABS.
                assert!(r.wheel_locked, "{tag}: no wheel locked");
                // The driven wheels also have to drag the engine down through
                // the clutch before they can lock (the kart's single-speed
                // engine from near redline takes the longest).
                let t_lock = r.lock_time.unwrap();
                assert!(
                    t_lock > 0.05 && t_lock < 1.0,
                    "{tag}: first lock at {t_lock} s"
                );
                // Each wheel locks at most once and never releases while the
                // car is still moving: no chatter.
                assert_eq!(r.lock_releases, 0, "{tag}: lock chatter");
                assert!(
                    r.lock_transitions <= wheel_count(model),
                    "{tag}: {} lock transitions",
                    r.lock_transitions
                );
                // The deceleration on sliding friction is smooth: under 1 %
                // ripple about its trend.
                assert!(
                    r.locked_decel_ripple < 0.01,
                    "{tag}: deceleration ripple {:.4}",
                    r.locked_decel_ripple
                );
                // The stop releases the stored contact-patch deflection
                // (ADR-0010): a short spring-back of a few centimetres at
                // well under walking pace, then rest on the locked wheels.
                assert!(
                    r.rest_speed < 0.5,
                    "{tag}: spring-back {} m/s",
                    r.rest_speed
                );
                assert!(
                    r.rest_distance < 0.1,
                    "{tag}: spring-back {} m",
                    r.rest_distance
                );
                assert!(
                    r.settled_speed < 1e-4,
                    "{tag}: {} m/s two seconds after the stop",
                    r.settled_speed
                );
                assert!(r.braking_distance.is_finite() && r.braking_distance > 20.0);
            }
        }
    }
}

#[test]
fn weak_brakes_never_lock_and_stop_later() {
    let strong = straight_line::run(
        &VehicleDefinition::default(),
        &StraightLineConfig::default(),
    )
    .unwrap();
    let mut d = VehicleDefinition::default();
    for a in &mut d.axles {
        a.max_brake_torque = 700.0;
    }
    let weak = straight_line::run(&d, &StraightLineConfig::default()).unwrap();
    assert!(!weak.wheel_locked);
    assert_eq!(weak.lock_time, None);
    assert_eq!(weak.lock_transitions, 0);
    assert_eq!(weak.lock_releases, 0);
    assert_eq!(weak.locked_decel_ripple, 0.0);
    assert!(
        weak.braking_distance > strong.braking_distance + 10.0,
        "weak {} m vs strong {} m",
        weak.braking_distance,
        strong.braking_distance
    );
    // Rolling to a stop on a brake below the grip limit leaves nothing wound
    // up to spring back.
    assert!(weak.rest_speed < 0.1, "spring-back {} m/s", weak.rest_speed);
    assert!(weak.settled_speed < 1e-4);
}

#[test]
fn rest_window_can_be_skipped() {
    let r = straight_line::run(
        &VehicleDefinition::default(),
        &StraightLineConfig {
            rest_time: 0.0,
            ..StraightLineConfig::default()
        },
    )
    .unwrap();
    assert_eq!(r.rest_speed, 0.0);
    assert_eq!(r.rest_distance, 0.0);
    assert!(r.settled_speed <= straight_line::STOP_SPEED);
}
