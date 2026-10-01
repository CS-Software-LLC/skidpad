//! Contact-patch deflection at standstill (ADR-0010): timestep sweep of the
//! parked scenarios, the stiction-to-sliding transition, the discretisation
//! against the exact relaxation lag at speed, and the implicit wheel spin.

use skidpad_core::definition::VehicleModelKind;
use skidpad_core::tire::{FeelTireParams, TireInput, TireModel, TireTransient};
use skidpad_core::validation::{parked, ParkedConfig};
use skidpad_core::vehicle::{FourWheelVehicle, FL, FR, RL, RR};
use skidpad_core::{VehicleDefinition, VehicleInput};
use skidpad_math as m;

fn parked_cases() -> Vec<(&'static str, ParkedConfig)> {
    vec![
        ("flat rest", ParkedConfig::default()),
        (
            "30 % grade, service brake",
            ParkedConfig {
                grade: 0.3,
                brake: 1.0,
                ..ParkedConfig::default()
            },
        ),
        (
            "20 % grade, handbrake",
            ParkedConfig {
                grade: 0.2,
                handbrake: 1.0,
                ..ParkedConfig::default()
            },
        ),
        (
            "20 % cross slope, brakes",
            ParkedConfig {
                cross_slope: 0.2,
                brake: 1.0,
                handbrake: 1.0,
                ..ParkedConfig::default()
            },
        ),
    ]
}

#[test]
fn parked_scenarios_hold_across_the_substep_rate_sweep() {
    for model in [VehicleModelKind::FourWheel, VehicleModelKind::SingleTrack] {
        for rate in [250.0, 500.0, 1000.0, 2000.0] {
            let mut d = VehicleDefinition::default();
            d.simulation.model = model;
            d.simulation.substep_rate_hz = rate;
            for (name, cfg) in parked_cases() {
                let r = parked::run(&d, &cfg).unwrap();
                assert!(
                    r.holds,
                    "{model:?} at {rate} Hz, {name}: settle {:.2e} m/s, drift {:.3} mm, rms {:.2e} m/s",
                    r.settle_speed,
                    1e3 * r.drift,
                    r.velocity_rms
                );
                // The settling transient stays small: placed with unloaded
                // tire springs, the car moves a few millimetres while they
                // wind up (handbrake only: the rear springs alone, peak
                // about g sin θ / ω_n ≈ 6 cm/s for the default car) and
                // must not lurch further.
                assert!(
                    r.settle_max_speed < 0.15,
                    "{model:?} at {rate} Hz, {name}: settling peak {} m/s",
                    r.settle_max_speed
                );
            }
        }
    }
}

#[test]
fn parked_car_holds_a_static_deflection_not_a_creep() {
    // On a 20 % grade facing uphill with the service brake on, the tires
    // carry m g sin θ through a static longitudinal deflection: the
    // transient slip ratio settles to a steady negative value (the car
    // wants to roll backward, the locked tires push it forward) and the
    // wheels stay locked.
    let d = VehicleDefinition::default();
    let mut car = FourWheelVehicle::new(d.clone());
    car.set_ground_slope(0.2, 0.0);
    let input = VehicleInput {
        brake: 1.0,
        ..Default::default()
    };
    for _ in 0..5000 {
        car.substep(0.001, &input);
    }
    let fx: f64 = car.wheels.iter().map(|w| w.out.fx).sum();
    let want = d.chassis.mass * skidpad_core::GRAVITY * 0.2 / m::sqrt(1.04);
    assert!(
        (fx - want).abs() < 0.01 * want,
        "holding force {fx} vs {want}"
    );
    for w in &car.wheels {
        assert!(w.locked);
        assert!(w.transient.slip_ratio > 0.0 && w.transient.slip_ratio < 0.12);
        assert!(w.omega == 0.0);
    }
    let k0 = car.wheels[FL].transient.slip_ratio;
    for _ in 0..5000 {
        car.substep(0.001, &input);
    }
    assert!((car.wheels[FL].transient.slip_ratio - k0).abs() < 1e-9);
    assert!(car.vel.length() < 1e-6);
}

/// Push a parked, locked car sideways at a constant speed and read the
/// lateral force the tires produce once the deflection has saturated,
/// together with the wheel loads under the push (lateral load transfer
/// lowers the total friction through load sensitivity).
fn sideways_push_force(vy: f64) -> (f64, [f64; 4]) {
    let d = VehicleDefinition::default();
    let mut car = FourWheelVehicle::new(d.clone());
    let input = VehicleInput {
        brake: 1.0,
        handbrake: 1.0,
        ..Default::default()
    };
    for _ in 0..1000 {
        car.substep(0.001, &input);
    }
    let mut fy = 0.0;
    let mut loads = [0.0; 4];
    for _ in 0..3000 {
        // Hold the body on a rail: constant sideways velocity, no yaw.
        car.vel = skidpad_core::geom::Vec3::new(0.0, vy, car.vel.z);
        car.omega.z = 0.0;
        car.substep(0.001, &input);
        fy = car.wheels.iter().map(|w| w.out.fy).sum();
        for (i, w) in car.wheels.iter().enumerate() {
            loads[i] = w.load;
        }
    }
    (fy, loads)
}

#[test]
fn standstill_slide_off_gives_sliding_friction() {
    let d = VehicleDefinition::default();
    let p = match &d.axles[0].tire {
        TireModel::Feel(p) => p.clone(),
        _ => unreachable!(),
    };
    let (fy, loads) = sideways_push_force(1.0);
    // Sliding force: the lateral falloff times the load-dependent peak
    // friction, summed over the wheels at their loads under the push.
    let slide: f64 = loads
        .iter()
        .map(|&fz| p.falloff_lat * p.friction_at_load(fz) * fz)
        .sum();
    assert!(fy < 0.0, "force opposes the +y push: {fy}");
    assert!(
        (fy.abs() - slide).abs() < 0.05 * slide,
        "sliding sideways at 1 m/s gives {} N, sliding friction is {slide} N",
        fy.abs()
    );
    // A slow push is held by stiction at the peak, not the sliding value.
    let (fy_slow, loads_slow) = sideways_push_force(0.02);
    let peak: f64 = loads_slow
        .iter()
        .map(|&fz| p.friction_at_load(fz) * fz)
        .sum();
    assert!(
        fy_slow.abs() > 0.97 * peak && fy_slow.abs() <= 1.0001 * peak,
        "slow push {} N vs peak {peak} N",
        fy_slow.abs()
    );
    assert!(
        fy_slow.abs() > fy.abs(),
        "stiction exceeds sliding friction"
    );
}

#[test]
fn deflection_update_matches_the_exact_lag_at_speed_to_first_order() {
    // At speed the deflection ODE is the relaxation of the transient slip
    // toward the kinematic slip at rate |Vx| / σ. Compare one second of the
    // linearly implicit update against the exact exponential response to a
    // step in slip: the two differ only through discretisation, and the
    // difference shrinks with the step.
    let (vx, sigma) = (20.0, 0.25);
    let kappa_kin = 0.05;
    let mut errs = Vec::new();
    for dt in [4e-3, 1e-3, 2.5e-4] {
        let mut t = TireTransient::default();
        let mut worst: f64 = 0.0;
        let mut time = 0.0;
        while time < 0.2 {
            t.update(kappa_kin * vx, 0.0, vx, dt, sigma, 0.35, 1.0, 1.0);
            time += dt;
            let exact = kappa_kin * (1.0 - m::exp(-vx * time / sigma));
            worst = worst.max((t.slip_ratio - exact).abs());
        }
        errs.push(worst);
        assert!(
            (t.slip_ratio - kappa_kin).abs() < 1e-6,
            "settles to the kinematic slip"
        );
    }
    assert!(errs[0] > errs[1] && errs[1] > errs[2], "{errs:?}");
    assert!(errs[0] < 0.1 * kappa_kin, "4 ms error {}", errs[0]);
    // The lateral deflection likewise settles to tan α' = Vy / |Vx|.
    let mut t = TireTransient::default();
    for _ in 0..2000 {
        t.update(0.0, 1.0, vx, 1e-3, sigma, 0.35, 1.0, 1.0);
    }
    assert!((m::tan(t.slip_angle) - 1.0 / vx).abs() < 1e-6);
}

#[test]
fn deflection_bound_caps_the_static_spring_at_the_peak() {
    let mut t = TireTransient::default();
    // Standstill: Vx = 0, a slow lateral drift. The deflection grows
    // linearly, then stops at the bound.
    for _ in 0..100_000 {
        t.update(0.0, 0.01, 0.0, 1e-3, 0.25, 0.35, 0.12, 0.1228);
    }
    assert!((m::tan(t.slip_angle) - 0.1228).abs() < 1e-9);
    assert_eq!(t.slip_ratio, 0.0);
    for _ in 0..100_000 {
        t.update(-0.01, 0.0, 0.0, 1e-3, 0.25, 0.35, 0.12, 0.1228);
    }
    assert!((t.slip_ratio + 0.12).abs() < 1e-9);
}

#[test]
fn implicit_wheel_spin_is_stable_at_every_rate_with_damping() {
    // At 250 Hz the explicit damping term c·R²·h/I is above 2 for the
    // default car; the implicit treatment must keep a free-rolling wheel
    // from oscillating when it is dropped onto the road at speed.
    for rate in [250.0, 500.0, 1000.0, 2000.0] {
        let mut d = VehicleDefinition::default();
        d.simulation.substep_rate_hz = rate;
        let dt = 1.0 / rate;
        let mut car = FourWheelVehicle::new(d);
        car.vel = skidpad_core::geom::Vec3::new(1.0, 0.0, 0.0);
        // Wheels stopped while the body moves at 1 m/s: inside the damping
        // fade, with the wheel spinning up through the tire.
        let mut flips = 0;
        let mut last = 0.0;
        for _ in 0..(2.0 * rate) as usize {
            car.substep(dt, &VehicleInput::default());
            let w = car.wheels[FL].omega;
            if w * last < 0.0 {
                flips += 1;
            }
            last = w;
            assert!(car.vel.is_finite() && w.is_finite());
        }
        assert!(
            flips <= 1,
            "{rate} Hz: wheel speed oscillates ({flips} flips)"
        );
        let expect = car.vel.x / car.geometry()[FL].radius;
        assert!(
            (car.wheels[FL].omega - expect).abs() < 0.05 * expect.abs() + 0.01,
            "{rate} Hz: wheel {} vs rolling {expect}",
            car.wheels[FL].omega
        );
    }
}

#[test]
fn low_speed_damping_is_capped_for_explicit_stability() {
    let model = TireModel::Feel(FeelTireParams::default());
    let (cx, cy) = model.low_speed_damping_coefficients(3200.0, 1e-3);
    assert!(cx > 1000.0 && cy > 1000.0);
    // At 60 Hz the cap (corner mass over twice the step) binds.
    let (cx60, cy60) = model.low_speed_damping_coefficients(3200.0, 1.0 / 60.0);
    let cap = 3200.0 / skidpad_core::GRAVITY / (2.0 / 60.0);
    assert!(cx60 <= cap * (1.0 + 1e-12) && cy60 <= cap * (1.0 + 1e-12));
    assert!(cx60 < cx || cy60 < cy);
    let off = TireModel::Feel(FeelTireParams {
        low_speed_damping: 0.0,
        ..FeelTireParams::default()
    });
    assert_eq!(off.low_speed_damping_coefficients(3200.0, 1e-3), (0.0, 0.0));
}

#[test]
fn sliding_force_bound_is_reported_by_both_models() {
    for model in [
        TireModel::Feel(FeelTireParams::default()),
        TireModel::MagicFormula(Default::default()),
    ] {
        let o = model.eval(&TireInput {
            fz: 4000.0,
            slip_ratio: 0.0,
            slip_angle: 0.0,
            camber: 0.0,
            vx: 10.0,
        });
        assert!(o.fx_slide > 0.0 && o.fx_slide <= o.fx_max);
        assert!(o.fy_slide > 0.0 && o.fy_slide <= o.fy_max);
        // The pure curves really tend to it.
        let big = model.eval(&TireInput {
            fz: 4000.0,
            slip_ratio: 50.0,
            slip_angle: 0.0,
            camber: 0.0,
            vx: 10.0,
        });
        assert!(
            (big.fx - o.fx_slide).abs() < 0.03 * o.fx_slide,
            "{} vs {}",
            big.fx,
            o.fx_slide
        );
    }
}

#[test]
fn single_track_matches_four_wheel_on_a_slope_at_rest() {
    for model in [VehicleModelKind::FourWheel, VehicleModelKind::SingleTrack] {
        let mut d = VehicleDefinition::default();
        d.simulation.model = model;
        let mut car = skidpad_core::VehicleModel::new(d);
        car.set_ground_slope(0.1, 0.1);
        let input = VehicleInput {
            brake: 1.0,
            handbrake: 1.0,
            ..Default::default()
        };
        for _ in 0..8000 {
            car.substep(0.001, &input);
        }
        // Placed with unloaded tire springs, the car settles a few
        // millimetres down the slope while they wind up, then stops.
        let (x, y, _) = car.pose2d();
        assert!(
            m::hypot(x, y) < 2e-2,
            "{model:?}: moved {} mm",
            1e3 * m::hypot(x, y)
        );
        assert!(car.speed() < 1e-5, "{model:?}: speed {}", car.speed());
    }
    let _ = (FR, RL, RR);
}
