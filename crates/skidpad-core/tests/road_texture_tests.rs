//! Road texture (ADR-0036): surface roughness and ridges reach the
//! suspension, the loads and the steering torque, and change nothing when
//! they are zero.

use skidpad_core::telemetry as t;
use skidpad_core::{Surface, VehicleDefinition, VehicleInput, World};
use skidpad_math as m;

fn hatchback() -> VehicleDefinition {
    serde_json::from_str(include_str!(
        "../../../packages/presets/src/vehicles/hatchback-fwd.json"
    ))
    .unwrap()
}

/// Drive the hatchback straight along +x at `speed` on surface `s`
/// (id 1) for `seconds` at 1 kHz host steps; the steering torque and
/// front-left load of every step.
fn cruise(s: Surface, wheels: &[usize], speed: f64, seconds: f64) -> (Vec<f64>, Vec<f64>) {
    let mut w = World::new(1);
    w.add_vehicle(hatchback()).unwrap();
    w.set_surfaces(&[Surface::REFERENCE, s]).unwrap();
    for &i in wheels {
        w.set_wheel_surface(0, i, 1).unwrap();
    }
    w.vehicle_mut(0).unwrap().model.set_speed(speed);
    w.set_input(
        0,
        VehicleInput {
            throttle: 0.25,
            ..VehicleInput::default()
        },
    )
    .unwrap();
    // Settle on the springs first.
    for _ in 0..500 {
        w.step(0.001);
    }
    let (mut torque, mut load) = (Vec::new(), Vec::new());
    for _ in 0..(seconds * 1000.0) as usize {
        w.step(0.001);
        let rec = w.telemetry_of(0);
        torque.push(rec[t::STEERING_TORQUE]);
        load.push(rec[t::LOAD_FL]);
    }
    (torque, load)
}

fn std_dev(v: &[f64]) -> f64 {
    let n = v.len() as f64;
    let mean = v.iter().sum::<f64>() / n;
    m::sqrt(v.iter().map(|x| (x - mean) * (x - mean)).sum::<f64>() / n)
}

/// Magnitude of the `f` Hz component of a 1 kHz series, N·m.
fn amplitude_at(v: &[f64], f: f64) -> f64 {
    let n = v.len() as f64;
    let mean = v.iter().sum::<f64>() / n;
    let (mut re, mut im) = (0.0, 0.0);
    for (k, x) in v.iter().enumerate() {
        let a = m::TAU * f * k as f64 * 1e-3;
        re += (x - mean) * m::cos(a);
        im += (x - mean) * m::sin(a);
    }
    2.0 * m::hypot(re, im) / n
}

fn rough(roughness: f64) -> Surface {
    Surface {
        roughness,
        ..Surface::REFERENCE
    }
}

fn kerb() -> Surface {
    Surface {
        ridge_height: 0.012,
        ridge_spacing: 0.5,
        ..Surface::REFERENCE
    }
}

#[test]
fn a_textured_surface_nobody_drives_on_changes_nothing() {
    let run = |list: &[Surface]| {
        let mut w = World::new(1);
        w.add_vehicle(hatchback()).unwrap();
        w.set_surfaces(list).unwrap();
        w.vehicle_mut(0).unwrap().model.set_speed(20.0);
        w.set_input(
            0,
            VehicleInput {
                steer: 0.2,
                throttle: 0.3,
                ..VehicleInput::default()
            },
        )
        .unwrap();
        let mut out = Vec::new();
        for _ in 0..300 {
            w.step(0.01);
            out.extend_from_slice(w.telemetry_of(0));
        }
        out
    };
    let base = run(&[Surface::REFERENCE]);
    // A rough surface and a kerb in the table, but every wheel on id 0;
    // and a surface whose ridges have a spacing but no height.
    let flat_ridges = Surface {
        ridge_spacing: 0.5,
        ..Surface::REFERENCE
    };
    let with = run(&[flat_ridges, rough(256.0), kerb()]);
    assert_eq!(base.len(), with.len());
    for (k, (a, b)) in base.iter().zip(&with).enumerate() {
        assert_eq!(a.to_bits(), b.to_bits(), "value {k}: {a} vs {b}");
    }
}

#[test]
fn rough_asphalt_reaches_the_load_and_the_steering() {
    let (smooth_tq, smooth_load) = cruise(Surface::REFERENCE, &[0, 2], 25.0, 2.0);
    let (a_tq, a_load) = cruise(rough(8.0), &[0, 2], 25.0, 2.0);
    let (b_tq, b_load) = cruise(rough(64.0), &[0, 2], 25.0, 2.0);
    assert!(std_dev(&smooth_tq) < 1e-9, "{}", std_dev(&smooth_tq));
    // Load ripple from a tire about 220 kN/m stiff over a millimetre or so.
    assert!(std_dev(&a_load) > 3.0 * std_dev(&smooth_load));
    assert!(std_dev(&b_load) > 2.0 * std_dev(&a_load));
    // Through the caster, the kingpin lean and the kick at the hub, a few
    // hundredths of a newton-metre at the rim on good asphalt, more on a
    // class B road.
    let (a, b) = (std_dev(&a_tq), std_dev(&b_tq));
    assert!(a > 0.02, "class A: {a} N·m");
    assert!(b > 2.0 * a, "class B {b} vs class A {a} N·m");
}

#[test]
fn kerb_ridges_buzz_at_the_crossing_frequency() {
    // 25 m/s over crests 0.5 m apart: 50 Hz.
    let (tq, _) = cruise(kerb(), &[0, 2], 25.0, 2.0);
    let at = amplitude_at(&tq, 50.0);
    assert!(at > 0.1, "50 Hz: {at} N·m");
    for f in [20.0, 35.0, 70.0] {
        let off = amplitude_at(&tq, f);
        assert!(at > 5.0 * off, "50 Hz {at} vs {f} Hz {off}");
    }
    // With both front wheels on the same ridges the kicks cancel through
    // the rack, as on a real car squarely on a kerb.
    let (both, _) = cruise(kerb(), &[0, 1, 2, 3], 25.0, 1.0);
    assert!(std_dev(&both) < 1e-9);
}

#[test]
fn a_snapshot_resumes_on_the_same_bumps() {
    let start = |w: &mut World| {
        w.add_vehicle(hatchback()).unwrap();
        w.set_surfaces(&[rough(64.0)]).unwrap();
        w.vehicle_mut(0).unwrap().model.set_speed(15.0);
        w.set_input(
            0,
            VehicleInput {
                throttle: 0.3,
                steer: 0.1,
                ..VehicleInput::default()
            },
        )
        .unwrap();
    };
    let mut a = World::new(1);
    start(&mut a);
    for _ in 0..50 {
        a.step(0.01);
    }
    let mut buf = vec![0u8; a.snapshot_len(0).unwrap()];
    a.snapshot(0, &mut buf).unwrap();
    let mut b = World::new(1);
    start(&mut b);
    b.restore(0, &buf).unwrap();
    for _ in 0..100 {
        a.step(0.01);
        b.step(0.01);
        let (ra, rb) = (a.telemetry_of(0), b.telemetry_of(0));
        assert_eq!(
            ra[t::STEERING_TORQUE].to_bits(),
            rb[t::STEERING_TORQUE].to_bits()
        );
        assert_eq!(ra[t::POS_X].to_bits(), rb[t::POS_X].to_bits());
    }
}

#[test]
fn a_car_without_unsprung_mass_feels_the_road_through_its_springs() {
    let mut w = World::new(1);
    w.add_vehicle(VehicleDefinition::default()).unwrap();
    w.set_surfaces(&[rough(256.0)]).unwrap();
    w.vehicle_mut(0).unwrap().model.set_speed(20.0);
    w.set_input(
        0,
        VehicleInput {
            throttle: 0.3,
            ..VehicleInput::default()
        },
    )
    .unwrap();
    let mut travel = Vec::new();
    for _ in 0..3000 {
        w.step(0.001);
        let rec = w.telemetry_of(0);
        assert!(rec.iter().all(|x| x.is_finite()));
        travel.push(rec[t::SUSP_TRAVEL_FL]);
    }
    assert!(
        std_dev(&travel[1000..]) > 5e-4,
        "{}",
        std_dev(&travel[1000..])
    );
}

fn kart() -> VehicleDefinition {
    serde_json::from_str(include_str!(
        "../../../packages/presets/src/vehicles/kart.json"
    ))
    .unwrap()
}

/// Wet asphalt as the presets give it with texture on.
fn wet(roughness: f64) -> Surface {
    Surface {
        grip: 0.65,
        rolling_resistance: 1.1,
        roughness,
        ..Surface::REFERENCE
    }
}

/// Brake the kart in a straight line from `speed` on `s` with `brake` and
/// `steer` held; the largest yaw on the way down, degrees, and the time
/// the rear first locked, s.
fn kart_stop(s: Surface, speed: f64, brake: f64, steer: f64) -> (f64, Option<f64>) {
    let mut w = World::new(1);
    w.add_vehicle(kart()).unwrap();
    w.set_surfaces(&[s]).unwrap();
    w.vehicle_mut(0).unwrap().model.set_speed(speed);
    for _ in 0..200 {
        w.step(0.001);
    }
    w.set_input(
        0,
        VehicleInput {
            brake,
            steer,
            ..VehicleInput::default()
        },
    )
    .unwrap();
    let (mut yaw, mut lock) = (0.0f64, None);
    for k in 0..8000 {
        w.step(0.001);
        let rec = w.telemetry_of(0);
        yaw = yaw.max(rec[t::YAW].abs());
        if lock.is_none() && rec[t::WHEEL_LOCKED_RL] > 0.5 {
            lock = Some(k as f64 * 1e-3);
        }
        if rec[t::SPEED] < 0.3 {
            break;
        }
    }
    (yaw.to_degrees(), lock)
}

#[test]
fn the_kart_brakes_straight_on_textured_wet_asphalt_short_of_locking() {
    // Half pedal is short of the rear's lock point on wet asphalt.
    for speed in [12.0, 18.0, 25.0] {
        let (yaw, lock) = kart_stop(wet(8.0), speed, 0.5, 0.0);
        assert!(lock.is_none(), "{speed} m/s: rear locked at {lock:?} s");
        assert!(yaw < 1.0, "{speed} m/s: yawed {yaw}°");
    }
}

#[test]
fn a_locked_kart_rear_swaps_ends_on_a_smooth_road_too() {
    // The kart brakes its rear axle only, so once the rear locks nothing
    // holds the tail. The texture does not move the lock point; it only
    // breaks a symmetry a smooth road keeps exactly, which a quarter of a
    // degree of steer breaks just as well.
    let (_, smooth) = kart_stop(wet(0.0), 18.0, 0.8, 0.0);
    let (_, rough) = kart_stop(wet(8.0), 18.0, 0.8, 0.0);
    let (smooth, rough) = (smooth.unwrap(), rough.unwrap());
    assert!(
        (smooth - rough).abs() < 0.05,
        "lock {smooth} s vs {rough} s"
    );
    let (yaw, _) = kart_stop(wet(0.0), 18.0, 0.8, 0.01);
    assert!(yaw > 90.0, "smooth, steer 0.01: yawed {yaw}°");
}
