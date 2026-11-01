//! Sine with dwell (FMVSS 126): the slowly increasing steer finds the angle
//! linear theory predicts, and the hatchback preset spins out of a 270° run
//! without stability control and comes straight with it. The preset results
//! are in `docs/validation/sine-with-dwell.md`.

use skidpad_core::validation::sine_with_dwell::{
    self, SineWithDwellConfig, YAW_RATIO_175_LIMIT, YAW_RATIO_1_LIMIT,
};
use skidpad_core::validation::step_steer::linear_steer_angle;
use skidpad_core::{VehicleDefinition, GRAVITY};

fn hatchback() -> VehicleDefinition {
    let mut d: VehicleDefinition = serde_json::from_str(include_str!(
        "../../../packages/presets/src/vehicles/hatchback-fwd.json"
    ))
    .unwrap();
    d.assists.steering_assist.enabled = false;
    d
}

/// `A` within 15 % of the hand-wheel angle linear theory gives for 0.3 g at
/// 80 km/h, and above it: the four-wheel hatchback understeers more than
/// linear theory says (1.07 against 0.93 deg/g on the skidpad, README), and
/// its tires are past their linear range by 0.3 g.
#[test]
fn a_is_the_linear_theory_angle_for_0_3_g() {
    let d = hatchback();
    let cfg = SineWithDwellConfig::default();
    let a = sine_with_dwell::amplitude_a(&d, &cfg);
    let linear = linear_steer_angle(&d, cfg.speed, 0.3 * GRAVITY) * d.steering.ratio;
    assert!(a > linear && a / linear < 1.15, "A {a} vs linear {linear}");
}

#[test]
fn stability_control_keeps_the_hatchback_straight_at_270_degrees() {
    let cfg = SineWithDwellConfig::default();
    let amp = 270f64.to_radians();
    let mut d = hatchback();
    d.assists.stability_control.enabled = false;
    let off = sine_with_dwell::single_run(&d, &cfg, amp, 1.0, true);
    assert!(off.completed);
    assert!(
        off.yaw_ratio_1 > YAW_RATIO_1_LIMIT && !off.stable,
        "without ESC: {off:?}"
    );
    d.assists.stability_control.enabled = true;
    for direction in [1.0, -1.0] {
        let on = sine_with_dwell::single_run(&d, &cfg, amp, direction, true);
        assert!(on.yaw_ratio_1 <= YAW_RATIO_1_LIMIT, "{on:?}");
        assert!(on.yaw_ratio_175 <= YAW_RATIO_175_LIMIT, "{on:?}");
        assert_eq!(on.responsive, Some(true), "{on:?}");
        assert!(on.peak_yaw_rate * direction < 0.0, "{on:?}");
    }
}

#[test]
fn rejects_a_zero_frequency() {
    let cfg = SineWithDwellConfig {
        frequency: 0.0,
        ..Default::default()
    };
    assert!(sine_with_dwell::run(&hatchback(), &cfg).is_err());
}
