//! Driving assists (ADR-0013): ABS, traction control, stability control and
//! the steering limit, each against the same car with the assist off.

use skidpad_core::definition::VehicleModelKind;
use skidpad_core::drivetrain::def::PowerUnitDef;
use skidpad_core::telemetry as t;
use skidpad_core::tire::TireModel;
use skidpad_core::validation::{straight_line, StraightLineConfig};
use skidpad_core::{VehicleDefinition, VehicleInput, World};

/// A car that needs its assists: the sports preset with every assist off,
/// its engine doubled to 405 N·m, a 2.5:1 locking differential and rear
/// tires no grippier than the fronts, so full throttle spins the rear wheels
/// and a hard step of steer under power steps the tail out.
fn wild_rwd() -> VehicleDefinition {
    let mut d: VehicleDefinition = serde_json::from_str(include_str!(
        "../../../packages/presets/src/vehicles/sports-rwd.json"
    ))
    .unwrap();
    d.assists = Default::default();
    if let PowerUnitDef::Combustion(c) = &mut d.drivetrain.power_unit {
        for p in c.torque_curve.iter_mut() {
            p[1] *= 2.025;
        }
    }
    let rear = &mut d.drivetrain.rear;
    rear.preload = 50.0;
    rear.bias_drive = 2.5;
    rear.bias_coast = 1.8;
    if let TireModel::Feel(t) = &mut d.axles[1].tire {
        t.peak_friction = 1.12;
        t.cornering_stiffness = 21.0;
    }
    d
}

fn hatchback() -> VehicleDefinition {
    serde_json::from_str(include_str!(
        "../../../packages/presets/src/vehicles/hatchback-fwd.json"
    ))
    .unwrap()
}

#[test]
fn assists_are_off_by_default_and_silent() {
    let d = VehicleDefinition::default();
    assert!(!d.assists.any_enabled());
    let mut w = World::new(1);
    w.add_vehicle(d).unwrap();
    w.set_input(
        0,
        VehicleInput {
            steer: 0.4,
            throttle: 1.0,
            ..VehicleInput::default()
        },
    )
    .unwrap();
    for _ in 0..300 {
        w.step(0.01);
    }
    let v = w.telemetry_of(0);
    assert_eq!(v[t::ABS_ACTIVITY], 0.0);
    assert_eq!(v[t::TC_ACTIVITY], 0.0);
    assert_eq!(v[t::ESC_BRAKE_TORQUE], 0.0);
    assert_eq!(v[t::STEER_ASSIST_SCALE], 1.0);
    assert_eq!(v[t::THROTTLE_EFFECTIVE], 1.0);
}

#[test]
fn abs_shortens_the_stop_and_keeps_the_wheels_rolling_until_it_stands_down() {
    for model in [VehicleModelKind::FourWheel, VehicleModelKind::SingleTrack] {
        let mut d = hatchback();
        d.simulation.model = model;
        let locked = straight_line::run(&d, &StraightLineConfig::default()).unwrap();
        assert!(locked.wheel_locked);
        let mut a = d.clone();
        a.assists.abs.enabled = true;
        let abs = straight_line::run(&a, &StraightLineConfig::default()).unwrap();
        assert!(
            abs.braking_distance < 0.93 * locked.braking_distance,
            "{model:?}: ABS {} m vs locked {} m",
            abs.braking_distance,
            locked.braking_distance
        );
        // Lock only after the stand-down speed: the first lock comes late.
        if let Some(t_lock) = abs.lock_time {
            assert!(
                t_lock > 0.85 * abs.braking_time,
                "{model:?}: locked at {t_lock} s of a {} s stop",
                abs.braking_time
            );
        }
        assert!(abs.settled_speed < 1e-4);
    }
}

#[test]
fn abs_activity_shows_in_telemetry_while_braking_hard() {
    let mut d = hatchback();
    d.assists.abs.enabled = true;
    let mut w = World::new(1);
    w.add_vehicle(d).unwrap();
    w.set_input(
        0,
        VehicleInput {
            throttle: 1.0,
            ..VehicleInput::default()
        },
    )
    .unwrap();
    for _ in 0..800 {
        w.step(0.01);
    }
    w.set_input(
        0,
        VehicleInput {
            brake: 1.0,
            ..VehicleInput::default()
        },
    )
    .unwrap();
    let mut peak = 0.0f64;
    let mut locked_fast = false;
    for _ in 0..200 {
        w.step(0.01);
        let v = w.telemetry_of(0);
        peak = peak.max(v[t::ABS_ACTIVITY]);
        if v[t::SPEED] > 3.0 && (v[t::WHEEL_LOCKED_FL] > 0.5 || v[t::WHEEL_LOCKED_RL] > 0.5) {
            locked_fast = true;
        }
    }
    assert!(peak > 0.3, "ABS modulated: peak activity {peak}");
    assert!(!locked_fast, "no wheel locked above 3 m/s");
}

#[test]
fn traction_control_holds_launch_slip_near_the_target() {
    let launch = |tc: bool| {
        let mut d = wild_rwd();
        d.assists.traction_control.enabled = tc;
        let mut w = World::new(1);
        w.add_vehicle(d).unwrap();
        w.set_input(
            0,
            VehicleInput {
                throttle: 1.0,
                ..VehicleInput::default()
            },
        )
        .unwrap();
        // The launch in first gear, after the clutch has bitten. The upshift's
        // clutch re-engagement dumps engine inertia into the wheels and is
        // the shift controller's business, not traction control's.
        let mut worst = 0.0f64;
        let mut activity = 0.0f64;
        for k in 0..300 {
            w.step(0.01);
            let v = w.telemetry_of(0);
            if k > 50 && v[t::GEAR] == 1.0 {
                worst = worst.max(v[t::SLIP_RATIO_RL].max(v[t::SLIP_RATIO_RR]));
            }
            activity = activity.max(v[t::TC_ACTIVITY]);
        }
        (worst, activity, w.telemetry_of(0)[t::SPEED])
    };
    let (slip_off, act_off, _) = launch(false);
    let (slip_on, act_on, speed_on) = launch(true);
    assert!(slip_off > 0.3, "the car spins up without TC: {slip_off}");
    assert!(slip_on < 0.3, "TC holds the slip: {slip_on}");
    assert_eq!(act_off, 0.0);
    assert!(act_on > 0.2, "TC cut the throttle: {act_on}");
    assert!(speed_on > 15.0, "and the car still goes: {speed_on} m/s");
}

#[test]
fn stability_control_tames_a_step_steer_at_speed() {
    let run = |esc: bool| {
        let mut d = wild_rwd();
        d.assists.stability_control.enabled = esc;
        let mut w = World::new(1);
        w.add_vehicle(d).unwrap();
        // Up to speed, then a hard step of steering with the power on.
        w.set_input(
            0,
            VehicleInput {
                throttle: 0.6,
                ..VehicleInput::default()
            },
        )
        .unwrap();
        for _ in 0..600 {
            w.step(0.01);
        }
        w.set_input(
            0,
            VehicleInput {
                steer: 0.45,
                throttle: 0.8,
                ..VehicleInput::default()
            },
        )
        .unwrap();
        let mut peak_yaw = 0.0f64;
        let mut peak_slip = 0.0f64;
        let mut brake = 0.0f64;
        for _ in 0..300 {
            w.step(0.01);
            let v = w.telemetry_of(0);
            peak_yaw = peak_yaw.max(v[t::YAW_RATE].abs());
            peak_slip = peak_slip.max(v[t::BODY_SLIP].abs());
            brake = brake.max(v[t::ESC_BRAKE_TORQUE]);
        }
        (peak_yaw, peak_slip, brake)
    };
    let (yaw_off, slip_off, _) = run(false);
    let (yaw_on, slip_on, brake_on) = run(true);
    assert!(brake_on > 100.0, "ESC braked a wheel: {brake_on} N·m");
    assert!(
        slip_on < 0.85 * slip_off,
        "body slip {slip_on} rad with ESC vs {slip_off} without"
    );
    assert!(yaw_on <= yaw_off * 1.02, "yaw {yaw_on} vs {yaw_off}");
}

#[test]
fn the_steering_assist_limits_the_angle_at_speed_only() {
    let mut d = VehicleDefinition::default();
    d.assists.steering_assist.enabled = true;
    let mut w = World::new(1);
    w.add_vehicle(d.clone()).unwrap();
    let full = VehicleInput {
        steer: 1.0,
        ..VehicleInput::default()
    };
    w.set_input(0, full).unwrap();
    w.step(0.01);
    let v = w.telemetry_of(0);
    assert!(
        (v[t::STEER_ANGLE].abs() - d.max_wheel_angle()).abs() < 1e-9,
        "full lock at rest"
    );
    assert_eq!(v[t::STEER_ASSIST_SCALE], 1.0);
    // At 30 m/s the limit is L·a / v².
    let mut fast = World::new(1);
    fast.add_vehicle(d.clone()).unwrap();
    fast.set_input(
        0,
        VehicleInput {
            throttle: 1.0,
            ..VehicleInput::default()
        },
    )
    .unwrap();
    for _ in 0..1500 {
        fast.step(0.01);
    }
    let speed = fast.telemetry_of(0)[t::SPEED];
    assert!(speed > 25.0, "{speed}");
    fast.set_input(0, full).unwrap();
    fast.step(0.01);
    let v = fast.telemetry_of(0);
    let expect = d.chassis.wheelbase * 9.0 / (v[t::VEL_X] * v[t::VEL_X]);
    assert!(
        (v[t::STEER_ANGLE].abs() - expect).abs() < 0.05 * expect,
        "angle {} vs limit {}",
        v[t::STEER_ANGLE].abs(),
        expect
    );
    assert!(v[t::STEER_ASSIST_SCALE] < 0.3);
}

#[test]
fn bad_assist_settings_are_rejected() {
    let mut d = VehicleDefinition::default();
    d.assists.abs.slip_release = 0.05;
    assert!(d.validate().is_err());
    let mut d = VehicleDefinition::default();
    d.assists.stability_control.gain = -1.0;
    assert!(d.validate().is_err());
    let mut d = VehicleDefinition::default();
    d.assists.steering_assist.lat_accel_limit = 0.0;
    assert!(d.validate().is_err());
}
