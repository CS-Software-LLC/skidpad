//! Anti-dive and anti-squat (ADR-0018), and per-axle track widths. The
//! links carry the chosen share of each axle's longitudinal load transfer
//! straight to the tires: the body pitches less (or more, for pro-dive),
//! the tires carry the same loads, a parked car still parks, and the state
//! survives a snapshot. An axle's own track moves its wheels and its share
//! of the lateral load transfer; without one the chassis track applies.

use skidpad_core::telemetry as t;
use skidpad_core::vehicle::FourWheelVehicle;
use skidpad_core::{VehicleDefinition, VehicleInput, World};

fn anti(brake: f64, drive: f64) -> VehicleDefinition {
    let mut d = VehicleDefinition::default();
    for a in &mut d.axles {
        a.suspension.anti_brake = brake;
        a.suspension.anti_drive = drive;
    }
    d
}

/// Steady braking from 25 m/s at 0.4 pedal; telemetry after 1.5 s.
fn braking(d: VehicleDefinition) -> Vec<f64> {
    let mut w = World::new(1);
    w.add_vehicle(d).unwrap();
    w.vehicle_mut(0).unwrap().model.set_speed(25.0);
    let start = w.telemetry_of(0)[t::PITCH];
    w.set_input(
        0,
        VehicleInput {
            brake: 0.4,
            ..VehicleInput::default()
        },
    )
    .unwrap();
    for _ in 0..150 {
        w.step(0.01);
    }
    let mut v = w.telemetry_of(0).to_vec();
    v[t::PITCH] -= start;
    v
}

/// Full throttle from 5 m/s; telemetry after 1 s.
fn accelerating(d: VehicleDefinition) -> Vec<f64> {
    let mut w = World::new(1);
    w.add_vehicle(d).unwrap();
    w.vehicle_mut(0).unwrap().model.set_speed(5.0);
    w.set_input(
        0,
        VehicleInput {
            throttle: 1.0,
            ..VehicleInput::default()
        },
    )
    .unwrap();
    for _ in 0..100 {
        w.step(0.01);
    }
    w.telemetry_of(0).to_vec()
}

#[test]
fn defaults_carry_no_link_load() {
    let v = braking(VehicleDefinition::default());
    assert_eq!(v[t::PITCH_LINK_LOAD_F], 0.0);
    assert_eq!(v[t::PITCH_LINK_LOAD_R], 0.0);
}

#[test]
fn anti_dive_and_anti_lift_carry_the_transfer_through_the_links() {
    let d = VehicleDefinition::default();
    let (m, h, l) = (d.chassis.mass, d.chassis.cg_height, d.chassis.wheelbase);
    let plain = braking(d);
    let full = braking(anti(1.0, 0.0));
    // + pitch is nose down.
    assert!(plain[t::PITCH] > 0.005, "{}", plain[t::PITCH]);
    // The links lift the nose and hold the tail down. With the geometry at
    // 1 on both axles each carries the transfer its own brakes cause, so
    // together they carry all of it, `m · a · h / L` (ADR-0018).
    let (front, rear) = (full[t::PITCH_LINK_LOAD_F], full[t::PITCH_LINK_LOAD_R]);
    assert!(front > 100.0 && rear < -100.0, "{front} {rear}");
    let transfer = m * full[t::LONG_ACCEL].abs() * h / l;
    assert!(
        ((front - rear) - transfer).abs() < 0.05 * transfer,
        "{front} - {rear} vs {transfer}"
    );
    // The springs see only the rest: the front's share is reacted at the
    // front, the rear's at the rear, so the body still pitches, but less.
    assert!(
        full[t::PITCH] < 0.7 * plain[t::PITCH],
        "{} vs {}",
        full[t::PITCH],
        plain[t::PITCH]
    );
    assert!(full[t::PITCH] > 0.0);
    // The tires carry the same loads: the transfer is set by the deceleration.
    let axle = |v: &[f64]| v[t::LOAD_FL] + v[t::LOAD_FR];
    let rel = (axle(&full) - axle(&plain)).abs() / axle(&plain);
    assert!(rel < 0.02, "front load differs by {rel}");
}

#[test]
fn enough_anti_geometry_holds_the_body_level() {
    // The default car brakes 64 % at the front: geometry of 1 / 0.64 at the
    // front and 1 / 0.36 at the rear reacts the whole transfer at each end.
    let d = VehicleDefinition::default();
    let share =
        d.axles[0].max_brake_torque / (d.axles[0].max_brake_torque + d.axles[1].max_brake_torque);
    let mut level = d.clone();
    level.axles[0].suspension.anti_brake = 1.0 / share;
    level.axles[1].suspension.anti_brake = (1.0 / (1.0 - share)).min(2.0);
    let plain = braking(d);
    let v = braking(level);
    assert!(
        v[t::PITCH].abs() < 0.2 * plain[t::PITCH],
        "{} vs {}",
        v[t::PITCH],
        plain[t::PITCH]
    );
}

#[test]
fn pro_dive_pitches_the_body_more() {
    let plain = braking(VehicleDefinition::default());
    let pro = braking(anti(-0.5, 0.0));
    assert!(
        pro[t::PITCH] > 1.2 * plain[t::PITCH],
        "{} vs {}",
        pro[t::PITCH],
        plain[t::PITCH]
    );
}

#[test]
fn anti_drive_reduces_pitch_under_power() {
    let plain = accelerating(VehicleDefinition::default());
    let full = accelerating(anti(0.0, 1.0));
    // The default car drives its front wheels; under power the nose lifts
    // (pitch negative) and anti-lift at the front holds it down.
    assert!(plain[t::PITCH] < -0.002, "{}", plain[t::PITCH]);
    assert!(
        full[t::PITCH].abs() < 0.5 * plain[t::PITCH].abs(),
        "{}",
        full[t::PITCH]
    );
    assert!(full[t::PITCH_LINK_LOAD_F] < 0.0);
}

#[test]
fn a_car_with_anti_geometry_still_parks_on_slopes() {
    for (grade, cross) in [(0.3, 0.0), (0.0, 0.2)] {
        let mut w = World::new(1);
        w.add_vehicle(anti(0.6, 0.8)).unwrap();
        w.set_ground_slope(0, grade, cross).unwrap();
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
        assert!(
            v[t::SPEED] < 1e-4,
            "{grade}/{cross}: creeps at {} m/s",
            v[t::SPEED]
        );
    }
}

#[test]
fn anti_geometry_state_round_trips_through_a_snapshot() {
    let d = anti(0.5, 0.7);
    let mut a = World::new(1);
    a.add_vehicle(d.clone()).unwrap();
    let mut b = World::new(1);
    b.add_vehicle(d).unwrap();
    let mut buf = vec![0u8; a.snapshot_len(0).unwrap()];
    for k in 0..400 {
        let input = VehicleInput {
            throttle: if k < 200 { 0.8 } else { 0.0 },
            brake: if k < 200 { 0.0 } else { 0.5 },
            steer: 0.2,
            ..VehicleInput::default()
        };
        a.set_input(0, input).unwrap();
        b.set_input(0, input).unwrap();
        a.step(0.01);
        if k == 220 {
            a.snapshot(0, &mut buf).unwrap();
            b.restore(0, &buf).unwrap();
        }
        if k > 220 {
            b.step(0.01);
            assert_eq!(
                a.state_hash(0).unwrap(),
                b.state_hash(0).unwrap(),
                "step {k}"
            );
        }
    }
}

#[test]
fn bad_anti_geometry_is_rejected() {
    assert!(anti(2.5, 0.0).validate().is_err());
    assert!(anti(0.0, f64::NAN).validate().is_err());
    assert!(anti(-2.0, 2.0).validate().is_ok());
}

#[test]
fn an_axle_without_a_track_uses_the_chassis_track() {
    let d = VehicleDefinition::default();
    let half = 0.5 * d.chassis.track_width;
    let car = FourWheelVehicle::new(d);
    for g in car.geometry() {
        assert_eq!(g.ray_origin.y.abs(), half);
    }
}

#[test]
fn an_axle_track_moves_its_wheels_and_its_load_transfer() {
    let mut d = VehicleDefinition::default();
    d.axles[1].track_width = 1.8;
    assert_eq!(d.axle_track(0), d.chassis.track_width);
    assert_eq!(d.axle_track(1), 1.8);
    let car = FourWheelVehicle::new(d.clone());
    let g = car.geometry();
    assert_eq!(g[0].ray_origin.y, 0.5 * d.chassis.track_width);
    assert_eq!(g[2].ray_origin.y, 0.9);
    assert_eq!(g[3].ray_origin.y, -0.9);

    // The roll centre's share of the lateral transfer is `F_y · h_rc / t`
    // with the axle's own track.
    let corner = |mut d: VehicleDefinition| {
        d.axles[1].suspension.roll_center_height = 0.1;
        let mut w = World::new(1);
        w.add_vehicle(d).unwrap();
        w.vehicle_mut(0).unwrap().model.set_speed(15.0);
        w.set_input(
            0,
            VehicleInput {
                steer: 0.2,
                throttle: 0.3,
                ..VehicleInput::default()
            },
        )
        .unwrap();
        for _ in 0..600 {
            w.step(0.01);
        }
        let v = w.telemetry_of(0).to_vec();
        v[t::GEOMETRIC_TRANSFER_R] / v[t::LAT_ACCEL].abs()
    };
    let narrow = corner(VehicleDefinition::default());
    let wide = corner(d.clone());
    let expected = d.chassis.track_width / 1.8;
    assert!(
        ((wide / narrow) - expected).abs() < 0.05 * expected,
        "{wide} / {narrow} vs {expected}"
    );
}

#[test]
fn bad_axle_tracks_are_rejected() {
    let mut d = VehicleDefinition::default();
    d.axles[0].track_width = -1.0;
    assert!(d.validate().is_err());
}
