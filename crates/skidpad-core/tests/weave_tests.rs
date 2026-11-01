//! On-centre weave (ISO 13674-1, Norman's metrics): the scenario completes
//! on both models near its aim, its numbers hold across substep rates, the
//! column terms add what they should, and a manual car weights up more
//! steeply than its assisted twin.

use skidpad_core::definition::VehicleModelKind;
use skidpad_core::validation::{weave, WeaveConfig};
use skidpad_core::VehicleDefinition;

fn hatchback() -> VehicleDefinition {
    serde_json::from_str(include_str!(
        "../../../packages/presets/src/vehicles/hatchback-fwd.json"
    ))
    .unwrap()
}

#[test]
fn weave_reaches_its_aim_and_gives_ordered_numbers() {
    for model in [VehicleModelKind::FourWheel, VehicleModelKind::SingleTrack] {
        let mut d = hatchback();
        d.simulation.model = model;
        let r = weave::run(&d, &WeaveConfig::default()).unwrap();
        assert!(r.completed, "{model:?}");
        assert!(
            (r.speed - 100.0 / 3.6).abs() < 0.5,
            "{model:?}: {}",
            r.speed
        );
        // Linear theory sizes the sine for 0.2 g.
        assert!(
            (r.lat_accel_peak_g - 0.2).abs() < 0.04,
            "{model:?}: peak {} g",
            r.lat_accel_peak_g
        );
        assert!(r.torque_gradient_zero_g > 5.0, "{model:?}: {r:?}");
        assert!(r.torque_gradient_reference > 0.0, "{model:?}: {r:?}");
        assert!(r.torque_at_zero_g > 0.0, "{model:?}: {r:?}");
        assert!(r.angle_hysteresis_deg > 0.0, "{model:?}: {r:?}");
        assert!(r.steering_sensitivity > 0.5, "{model:?}: {r:?}");
        assert!(r.torque_peak > r.torque_at_zero_g, "{model:?}: {r:?}");
    }
}

#[test]
fn the_column_adds_its_friction_and_damping_and_nothing_else() {
    let d = hatchback();
    let with = weave::run(&d, &WeaveConfig::default()).unwrap();
    let without = weave::run(
        &d,
        &WeaveConfig {
            include_column: false,
            ..WeaveConfig::default()
        },
    )
    .unwrap();
    assert_eq!(without.column_torque_at_zero_g, 0.0);
    let added = with.torque_at_zero_g - without.torque_at_zero_g;
    assert!(
        (added - with.column_torque_at_zero_g).abs() < 0.1 * with.column_torque_at_zero_g,
        "loop widened by {added}, column share {}",
        with.column_torque_at_zero_g
    );
    // The column acts on the rate, not the angle: the gradients barely move.
    assert!(
        (with.torque_gradient_zero_g - without.torque_gradient_zero_g).abs()
            < 0.02 * without.torque_gradient_zero_g,
        "{} vs {}",
        with.torque_gradient_zero_g,
        without.torque_gradient_zero_g
    );
}

#[test]
fn weave_numbers_hold_across_substep_rates() {
    let run = |rate: f64| {
        let mut d = hatchback();
        d.simulation.substep_rate_hz = rate;
        weave::run(&d, &WeaveConfig::default()).unwrap()
    };
    let reference = run(2000.0);
    for rate in [500.0, 1000.0] {
        let r = run(rate);
        assert!(
            (r.torque_gradient_zero_g / reference.torque_gradient_zero_g - 1.0).abs() < 0.02,
            "{rate} Hz: {} vs {}",
            r.torque_gradient_zero_g,
            reference.torque_gradient_zero_g
        );
        assert!(
            (r.torque_at_zero_g - reference.torque_at_zero_g).abs() < 0.03,
            "{rate} Hz: {} vs {}",
            r.torque_at_zero_g,
            reference.torque_at_zero_g
        );
        assert!(
            (r.steering_sensitivity / reference.steering_sensitivity - 1.0).abs() < 0.02,
            "{rate} Hz"
        );
    }
}

#[test]
fn a_manual_car_weights_up_more_steeply_off_centre_than_its_assisted_twin() {
    let assisted = hatchback();
    assert!(assisted.steering.power_assist > 0.0);
    let mut manual = assisted.clone();
    manual.steering.power_assist = 0.0;
    manual.steering.power_assist_at_speed = 0.0;
    manual.steering.power_assist_fade_start = 0.0;
    manual.steering.power_assist_fade_end = 0.0;
    let a = weave::run(&assisted, &WeaveConfig::default()).unwrap();
    let m = weave::run(&manual, &WeaveConfig::default()).unwrap();
    // The boost curve (ADR-0029) gives almost no help on centre, so the two
    // cars feel alike there and part ways as the torque builds.
    assert!(
        (m.torque_gradient_zero_g / a.torque_gradient_zero_g - 1.0).abs() < 0.1,
        "on centre: manual {} N·m/g, assisted {} N·m/g",
        m.torque_gradient_zero_g,
        a.torque_gradient_zero_g
    );
    assert!(
        m.torque_gradient_reference > 1.2 * a.torque_gradient_reference,
        "at 0.1 g: manual {} N·m/g, assisted {} N·m/g",
        m.torque_gradient_reference,
        a.torque_gradient_reference
    );
    // The assist changes the effort, not the car's response.
    assert!(
        (m.steering_sensitivity / a.steering_sensitivity - 1.0).abs() < 0.01,
        "{} vs {}",
        m.steering_sensitivity,
        a.steering_sensitivity
    );
}

#[test]
fn bad_configs_are_refused() {
    let d = hatchback();
    for cfg in [
        WeaveConfig {
            frequency: 0.0,
            ..WeaveConfig::default()
        },
        WeaveConfig {
            measure_cycles: 0,
            ..WeaveConfig::default()
        },
    ] {
        assert!(weave::run(&d, &cfg).is_err());
    }
}
