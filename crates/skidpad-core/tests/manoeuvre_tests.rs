//! Step steer (ISO 7401) and double lane change (ISO 3888): the scenarios
//! complete on both models, their numbers are physically ordered, and the
//! lane change passes at sane speeds and fails at silly ones.

use skidpad_core::definition::VehicleModelKind;
use skidpad_core::validation::{
    lane_change, step_steer, LaneChangeConfig, LaneChangeCourse, StepSteerConfig,
};
use skidpad_core::VehicleDefinition;

fn hatchback() -> VehicleDefinition {
    serde_json::from_str(include_str!(
        "../../../packages/presets/src/vehicles/hatchback-fwd.json"
    ))
    .unwrap()
}

#[test]
fn step_steer_settles_near_the_targeted_lateral_acceleration() {
    for model in [VehicleModelKind::FourWheel, VehicleModelKind::SingleTrack] {
        let mut d = hatchback();
        d.simulation.model = model;
        let r = step_steer::run(&d, &StepSteerConfig::default()).unwrap();
        assert!(r.completed, "{model:?}");
        assert!(
            (r.speed - 80.0 / 3.6).abs() < 0.5,
            "{model:?}: speed {}",
            r.speed
        );
        // Linear theory sets the step; the nonlinear tires land within a
        // quarter of the 4 m/s² aim.
        assert!(
            (r.lat_accel - 4.0).abs() < 1.0,
            "{model:?}: lat accel {}",
            r.lat_accel
        );
        assert!(
            r.yaw_rate > 0.1 && r.yaw_rate < 0.3,
            "{model:?}: {}",
            r.yaw_rate
        );
        assert!(r.yaw_rate_gain > 0.0);
        // A road car at 80 km/h responds within half a second with little
        // overshoot (ISO 7401 typical values).
        let rt = r.yaw_rate_response_time.expect("yaw rate reached 90 %");
        assert!(rt > 0.05 && rt < 0.6, "{model:?}: response time {rt}");
        assert!(
            r.yaw_rate_overshoot < 0.3,
            "{model:?}: overshoot {}",
            r.yaw_rate_overshoot
        );
        assert!(r.lat_accel_response_time.is_some());
        if model == VehicleModelKind::FourWheel {
            assert!(r.roll > 0.005 && r.roll_peak >= r.roll);
        } else {
            assert_eq!(r.roll, 0.0);
        }
    }
}

#[test]
fn more_yaw_inertia_slows_the_response_without_moving_the_steady_state() {
    let base = step_steer::run(&hatchback(), &StepSteerConfig::default()).unwrap();
    let mut heavy = hatchback();
    heavy.chassis.yaw_inertia *= 3.0;
    let r = step_steer::run(&heavy, &StepSteerConfig::default()).unwrap();
    let (a, b) = (
        r.yaw_rate_response_time.unwrap(),
        base.yaw_rate_response_time.unwrap(),
    );
    assert!(a > b * 1.2, "response {a} s vs {b} s");
    assert!(
        (r.yaw_rate_gain - base.yaw_rate_gain).abs() < 0.05 * base.yaw_rate_gain,
        "gain {} vs {}",
        r.yaw_rate_gain,
        base.yaw_rate_gain
    );
    // A looser rear raises the steady-state gain (less understeer).
    let mut loose = hatchback();
    if let skidpad_core::tire::TireModel::Feel(p) = &mut loose.axles[1].tire {
        p.cornering_stiffness *= 0.7;
    }
    let r = step_steer::run(&loose, &StepSteerConfig::default()).unwrap();
    assert!(r.yaw_rate_gain > base.yaw_rate_gain * 1.05);
}

#[test]
fn lane_change_passes_at_road_speeds_and_fails_when_too_fast() {
    for model in [VehicleModelKind::FourWheel, VehicleModelKind::SingleTrack] {
        let mut d = hatchback();
        d.simulation.model = model;
        let r = lane_change::run(
            &d,
            &LaneChangeConfig {
                speeds: vec![40.0 / 3.6, 60.0 / 3.6, 130.0 / 3.6],
                ..LaneChangeConfig::default()
            },
        )
        .unwrap();
        assert_eq!(r.course_length, 110.0);
        assert!((r.lane_widths[0] - (1.1 * r.vehicle_width + 0.25)).abs() < 1e-9);
        assert_eq!(r.lane_offset, 3.5);
        assert_eq!(r.attempts.len(), 3);
        for a in &r.attempts {
            assert!(
                a.completed,
                "{model:?} at {} m/s did not finish",
                a.entry_speed
            );
            assert!(a.max_lat_accel > 0.5);
        }
        assert!(
            r.attempts[0].passed,
            "{model:?} failed at 40 km/h: {:?}",
            r.attempts[0]
        );
        assert!(
            r.attempts[1].passed,
            "{model:?} failed at 60 km/h: {:?}",
            r.attempts[1]
        );
        assert!(!r.attempts[2].passed, "{model:?} passed at 130 km/h");
        assert!(r.attempts[2].cone_overlap > 0.0);
        assert!(r.attempts[2].max_lat_accel > r.attempts[0].max_lat_accel);
        assert_eq!(r.max_passing_speed, Some(60.0 / 3.6));
    }
}

#[test]
fn the_moose_test_course_is_tighter() {
    let d = hatchback();
    let r = lane_change::run(
        &d,
        &LaneChangeConfig {
            course: LaneChangeCourse::Iso3888Part2,
            speeds: vec![50.0 / 3.6],
            hold_speed: false,
            ..LaneChangeConfig::default()
        },
    )
    .unwrap();
    assert_eq!(r.course_length, 61.0);
    assert!((r.lane_offset - (1.0 + r.vehicle_width)).abs() < 1e-9);
    assert!(r.attempts[0].completed);
    // Throttle released: the car exits slower than it entered.
    assert!(r.attempts[0].exit_speed < r.attempts[0].entry_speed);
}

#[test]
fn bad_configs_are_rejected() {
    assert!(step_steer::run(
        &hatchback(),
        &StepSteerConfig {
            speed: 0.0,
            ..StepSteerConfig::default()
        }
    )
    .is_err());
    assert!(lane_change::run(
        &hatchback(),
        &LaneChangeConfig {
            speeds: vec![],
            ..LaneChangeConfig::default()
        }
    )
    .is_err());
}
