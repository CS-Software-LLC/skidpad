//! The path-following driver (milestone 7, ADR-0020): it laps a closed
//! path near the line at the speed the curvature allows, stops at the end
//! of an open one, honours a lateral offset, drives either model, and is
//! deterministic.

use skidpad_core::ai::{AiConfig, AiDriver};
use skidpad_core::definition::VehicleModelKind;
use skidpad_core::world::{Lod, WorldError};
use skidpad_core::{VehicleDefinition, VehicleInput, World};
use skidpad_math as m;

const DT: f64 = 1.0 / 60.0;

/// A circle of radius `r` around the origin, counter-clockwise, starting
/// at (0, −r) heading +x.
fn circle(r: f64, n: usize) -> Vec<f64> {
    let mut p = Vec::with_capacity(2 * n);
    for k in 0..n {
        let a = -core::f64::consts::FRAC_PI_2 + 2.0 * core::f64::consts::PI * k as f64 / n as f64;
        p.push(r * m::cos(a));
        p.push(r * m::sin(a));
    }
    p
}

/// A rounded rectangle: two 120 m straights joined by 30 m half circles.
fn oval() -> Vec<f64> {
    let mut p = Vec::new();
    let r = 30.0;
    for k in 0..24 {
        p.push(-60.0 + 120.0 * k as f64 / 24.0);
        p.push(-r);
    }
    for k in 0..24 {
        let a = -core::f64::consts::FRAC_PI_2 + core::f64::consts::PI * k as f64 / 24.0;
        p.push(60.0 + r * m::cos(a));
        p.push(r * m::sin(a));
    }
    for k in 0..24 {
        p.push(60.0 - 120.0 * k as f64 / 24.0);
        p.push(r);
    }
    for k in 0..24 {
        let a = core::f64::consts::FRAC_PI_2 + core::f64::consts::PI * k as f64 / 24.0;
        p.push(-60.0 + r * m::cos(a));
        p.push(r * m::sin(a));
    }
    p
}

fn read(w: &World, i: usize, name: &str) -> f64 {
    let idx = skidpad_core::telemetry::CHANNELS
        .iter()
        .position(|c| c.name == name)
        .unwrap();
    w.telemetry_of(i)[idx]
}

#[test]
fn laps_a_circle_on_the_line_at_the_planned_speed() {
    let mut w = World::new(1);
    w.add_vehicle(VehicleDefinition::default()).unwrap();
    w.reset_vehicle(0, 0.0, -50.0, 0.0).unwrap();
    let cfg = AiConfig {
        lateral_accel: 5.0,
        ..AiConfig::default()
    };
    w.set_ai(0, &circle(50.0, 72), cfg).unwrap();
    let planned = (5.0f64 * 50.0).sqrt();
    let mut max_err: f64 = 0.0;
    for k in 0..(60 * 60) {
        w.step(DT);
        let st = w.ai_status(0).unwrap().unwrap();
        if k > 60 * 15 {
            max_err = max_err.max(st.lateral_error.abs());
            let speed = read(&w, 0, "Speed");
            assert!(
                (speed - planned).abs() < 0.12 * planned,
                "speed {speed} vs planned {planned}"
            );
        }
    }
    let st = w.ai_status(0).unwrap().unwrap();
    // 60 s at about 15.8 m/s on a 314 m lap is about 3 laps.
    assert!(st.laps >= 2, "laps {}", st.laps);
    assert!(max_err < 0.6, "lateral error {max_err} m");
    // The driver wrote what it applied into the input record.
    let input = VehicleInput::from_slice(&w.inputs()[..VehicleInput::STRIDE]);
    assert!(input.steer < 0.0, "counter-clockwise needs left steer");
    assert!(input.throttle > 0.0);
}

#[test]
fn brakes_for_the_corners_of_an_oval() {
    let mut w = World::new(1);
    w.add_vehicle(VehicleDefinition::default()).unwrap();
    w.reset_vehicle(0, -60.0, -30.0, 0.0).unwrap();
    let cfg = AiConfig {
        max_speed: 40.0,
        lateral_accel: 6.0,
        ..AiConfig::default()
    };
    w.set_ai(0, &oval(), cfg).unwrap();
    let corner = (6.0f64 * 30.0).sqrt();
    let mut top: f64 = 0.0;
    let mut max_err: f64 = 0.0;
    let mut braked = false;
    for k in 0..(60 * 90) {
        w.step(DT);
        let st = w.ai_status(0).unwrap().unwrap();
        if k > 60 * 20 {
            top = top.max(read(&w, 0, "Speed"));
            max_err = max_err.max(st.lateral_error.abs());
            braked |= read(&w, 0, "Brake") > 0.05;
            // Mid corner: x beyond the straights.
            let x = read(&w, 0, "PosX");
            if x.abs() > 80.0 {
                let speed = read(&w, 0, "Speed");
                assert!(
                    speed < 1.15 * corner,
                    "{speed} m/s in a {corner} m/s corner"
                );
            }
        }
    }
    assert!(top > 1.3 * corner, "never used the straights ({top} m/s)");
    assert!(braked, "never braked for a corner");
    assert!(max_err < 1.5, "lateral error {max_err} m");
    assert!(w.ai_status(0).unwrap().unwrap().laps >= 3);
}

#[test]
fn stops_at_the_end_of_an_open_path() {
    let mut w = World::new(1);
    w.add_vehicle(VehicleDefinition::default()).unwrap();
    let path = [0.0, 0.0, 100.0, 0.0, 150.0, 20.0];
    let cfg = AiConfig {
        closed: false,
        ..AiConfig::default()
    };
    w.set_ai(0, &path, cfg).unwrap();
    for _ in 0..(60 * 40) {
        w.step(DT);
    }
    let st = w.ai_status(0).unwrap().unwrap();
    assert!(st.finished);
    assert!(read(&w, 0, "Speed") < 0.2);
    let (x, y) = (read(&w, 0, "PosX"), read(&w, 0, "PosY"));
    let d = m::hypot(x - 150.0, y - 20.0);
    assert!(d < 6.0, "stopped {d} m from the end");
}

#[test]
fn a_lateral_offset_moves_the_line() {
    let mut w = World::new(2);
    for k in 0..2 {
        w.add_vehicle(VehicleDefinition::default()).unwrap();
        w.reset_vehicle(k, 0.0, -50.0 + 3.0 * k as f64, 0.0)
            .unwrap();
    }
    w.set_ai(0, &circle(50.0, 72), AiConfig::default()).unwrap();
    let inner = AiConfig {
        lateral_offset: 3.0,
        ..AiConfig::default()
    };
    w.set_ai(1, &circle(50.0, 72), inner).unwrap();
    for _ in 0..(60 * 20) {
        w.step(DT);
    }
    let radius = |i: usize| {
        let (x, y) = (read(&w, i, "PosX"), read(&w, i, "PosY"));
        (x * x + y * y).sqrt()
    };
    // Left of a counter-clockwise circle is inside it.
    assert!(
        (radius(0) - radius(1) - 3.0).abs() < 0.8,
        "{} {}",
        radius(0),
        radius(1)
    );
}

#[test]
fn drives_the_single_track_model_and_through_level_changes() {
    let mut w = World::new(1);
    let mut def = VehicleDefinition::default();
    def.simulation.model = VehicleModelKind::SingleTrack;
    w.add_vehicle(def).unwrap();
    w.reset_vehicle(0, 0.0, -50.0, 0.0).unwrap();
    w.set_ai(0, &circle(50.0, 72), AiConfig::default()).unwrap();
    for _ in 0..(60 * 20) {
        w.step(DT);
    }
    assert!(w.ai_status(0).unwrap().unwrap().lateral_error.abs() < 0.6);

    let mut w = World::new(1);
    w.add_vehicle(VehicleDefinition::default()).unwrap();
    w.reset_vehicle(0, 0.0, -50.0, 0.0).unwrap();
    w.set_ai(0, &circle(50.0, 72), AiConfig::default()).unwrap();
    for k in 0..(60 * 30) {
        if k == 600 {
            w.set_lod(0, Lod::SingleTrack, 0.0).unwrap();
        }
        if k == 1200 {
            w.set_lod(0, Lod::Full, 0.0).unwrap();
        }
        w.step(DT);
        if k > 300 {
            let e = w.ai_status(0).unwrap().unwrap().lateral_error.abs();
            assert!(e < 1.0, "step {k}: {e} m off the line");
        }
    }
}

#[test]
fn is_deterministic_and_restorable() {
    let run = |cut: Option<usize>| {
        let mut w = World::new(1);
        w.add_vehicle(VehicleDefinition::default()).unwrap();
        w.reset_vehicle(0, -60.0, -30.0, 0.0).unwrap();
        w.set_ai(0, &oval(), AiConfig::default()).unwrap();
        for k in 0..1200 {
            if Some(k) == cut {
                let mut snap = vec![0u8; w.snapshot_len(0).unwrap()];
                w.snapshot(0, &mut snap).unwrap();
                w.restore(0, &snap).unwrap();
            }
            w.step(DT);
        }
        w.world_hash()
    };
    assert_eq!(run(None), run(None));
    // Restoring resets the driver's search hint and integrator, so the
    // run diverges; it must still be reproducible.
    assert_eq!(run(Some(500)), run(Some(500)));
}

#[test]
fn clear_ai_leaves_the_last_inputs() {
    let mut w = World::new(1);
    w.add_vehicle(VehicleDefinition::default()).unwrap();
    w.reset_vehicle(0, 0.0, -50.0, 0.0).unwrap();
    w.set_ai(0, &circle(50.0, 72), AiConfig::default()).unwrap();
    w.step_many(DT, 120);
    let held = w.inputs()[..VehicleInput::STRIDE].to_vec();
    w.clear_ai(0).unwrap();
    assert!(w.ai_status(0).unwrap().is_none());
    w.step_many(DT, 10);
    assert_eq!(&w.inputs()[..VehicleInput::STRIDE], held.as_slice());
}

#[test]
fn rejects_bad_paths_and_configs() {
    let def = VehicleDefinition::default();
    assert!(AiDriver::new(&def, &[0.0, 0.0, 1.0], AiConfig::default()).is_err());
    assert!(AiDriver::new(&def, &[0.0, 0.0, 1.0, 0.0], AiConfig::default()).is_err());
    assert!(AiDriver::new(&def, &[0.0, 0.0, 0.0, 0.0, 0.0, 0.0], AiConfig::default()).is_err());
    assert!(AiDriver::new(
        &def,
        &[0.0, 0.0, f64::NAN, 1.0, 2.0, 2.0],
        AiConfig::default()
    )
    .is_err());
    let open = AiConfig {
        closed: false,
        ..AiConfig::default()
    };
    assert!(AiDriver::new(&def, &[0.0, 0.0, 1.0, 0.0], open).is_ok());
    let bad = AiConfig {
        lateral_accel: 0.0,
        ..AiConfig::default()
    };
    assert!(AiDriver::new(&def, &circle(10.0, 8), bad).is_err());
    let mut w = World::new(1);
    w.add_vehicle(def).unwrap();
    assert!(matches!(
        w.set_ai(0, &[1.0], AiConfig::default()),
        Err(WorldError::Invalid(_))
    ));
    assert!(matches!(
        w.set_ai(3, &circle(10.0, 8), AiConfig::default()),
        Err(WorldError::NoSuchVehicle(3))
    ));
}

#[test]
fn the_speed_profile_respects_curvature_and_braking() {
    let def = VehicleDefinition::default();
    let cfg = AiConfig {
        max_speed: 50.0,
        lateral_accel: 6.0,
        brake_decel: 5.0,
        drive_accel: 3.0,
        ..AiConfig::default()
    };
    let d = AiDriver::new(&def, &oval(), cfg).unwrap();
    let corner = (6.0f64 * 30.0).sqrt();
    // Mid corner (a quarter of the way round the first half circle).
    let s_corner = 120.0 + 0.5 * core::f64::consts::PI * 30.0;
    assert!((d.planned_speed(s_corner) - corner).abs() < 0.05 * corner);
    // Mid straight: faster, but no faster than braking into the corner allows.
    let mid = d.planned_speed(60.0);
    let brake_cap = (corner * corner + 2.0 * 5.0 * 60.0).sqrt();
    assert!(mid > corner * 1.3 && mid <= brake_cap + 0.5, "{mid}");
}
