//! Timestep sweep (milestone 3): the manoeuvres agree across the supported
//! substep and host rates. The full 4 × 4 grid for every preset runs in the
//! validate tool through the optimised WASM build; these debug-mode tests
//! take the corners of the grid.

use skidpad_core::definition::VehicleModelKind;
use skidpad_core::validation::{timestep_sweep, TimestepSweepConfig};
use skidpad_core::VehicleDefinition;

fn corners() -> TimestepSweepConfig {
    TimestepSweepConfig {
        substep_rates: vec![250.0, 2000.0],
        host_rates: vec![30.0, 240.0],
        ..TimestepSweepConfig::default()
    }
}

fn kart() -> VehicleDefinition {
    serde_json::from_str(include_str!(
        "../../../packages/presets/src/vehicles/kart.json"
    ))
    .unwrap()
}

#[test]
fn the_default_car_is_stable_across_the_grid_on_both_models() {
    for model in [VehicleModelKind::FourWheel, VehicleModelKind::SingleTrack] {
        let mut d = VehicleDefinition::default();
        d.simulation.model = model;
        let r = timestep_sweep::run(&d, &corners()).unwrap();
        assert_eq!(r.cells.len(), 4);
        assert!(r.all_finite, "{model:?}: non-finite cell");
        assert!(r.all_hold, "{model:?}: {:?}", r.cells);
        assert!(r.clean_stops, "{model:?}: {:?}", r.cells);
        assert!(
            r.gradient_spread_deg_per_g < 0.01,
            "{model:?}: gradient spread {} deg/g",
            r.gradient_spread_deg_per_g
        );
        assert!(
            r.braking_distance_spread < 0.005,
            "{model:?}: braking spread {}",
            r.braking_distance_spread
        );
        assert!(r.stable);
        assert_eq!(r.reference.substep_rate_hz, d.simulation.substep_rate_hz);
        assert_eq!(r.reference.host_rate_hz, 100.0);
    }
}

/// The kart's yaw response is faster than a 30 Hz host step; the single-track
/// kart is the quickest vehicle in the repository and used to defeat the
/// skidpad controller at that rate.
#[test]
fn the_single_track_kart_holds_the_skidpad_at_a_30_hz_host_step() {
    let mut d = kart();
    d.simulation.model = VehicleModelKind::SingleTrack;
    let cfg = TimestepSweepConfig {
        substep_rates: vec![500.0],
        host_rates: vec![30.0],
        ..TimestepSweepConfig::default()
    };
    let r = timestep_sweep::run(&d, &cfg).unwrap();
    assert!(
        r.gradient_spread_deg_per_g < 0.01,
        "gradient {} vs reference {} deg/g",
        r.cells[0].gradient_deg_per_g,
        r.reference.gradient_deg_per_g
    );
    assert!(r.stable);
}

#[test]
fn sweep_rejects_bad_rates() {
    let d = VehicleDefinition::default();
    assert!(timestep_sweep::run(
        &d,
        &TimestepSweepConfig {
            substep_rates: vec![],
            ..TimestepSweepConfig::default()
        }
    )
    .is_err());
    assert!(timestep_sweep::run(
        &d,
        &TimestepSweepConfig {
            host_rates: vec![0.0],
            ..TimestepSweepConfig::default()
        }
    )
    .is_err());
}
