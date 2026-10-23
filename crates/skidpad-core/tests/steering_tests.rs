//! Steering geometry and rack force (ADR-0012): kingpin torque composition,
//! torque steer through the scrub radius, power assist, the single-track
//! equivalence, and jacking.

use skidpad_core::definition::VehicleModelKind;
use skidpad_core::drivetrain::DifferentialKind;
use skidpad_core::telemetry as t;
use skidpad_core::vehicle::{FourWheelVehicle, FL, FR, RL, RR};
use skidpad_core::{VehicleDefinition, VehicleInput, World};
use skidpad_math as m;

fn settle(w: &mut World, input: VehicleInput, seconds: f64) {
    w.set_input(0, input).unwrap();
    for _ in 0..(seconds * 100.0) as usize {
        w.step(0.01);
    }
}

fn cornering() -> VehicleInput {
    VehicleInput {
        steer: 0.25,
        throttle: 0.35,
        ..VehicleInput::default()
    }
}

#[test]
fn kingpin_torque_composes_trail_scrub_and_assist() {
    let d = VehicleDefinition::default();
    // Pure aligning moment, no forces.
    assert_eq!(d.kingpin_torque(10.0, 0.0, 0.0, 1.0), 10.0);
    // Mechanical trail acts like the pneumatic trail: `−t·Fy`.
    assert!((d.kingpin_torque(0.0, 1000.0, 0.0, 1.0) + 0.02 * 1000.0).abs() < 1e-12);
    // Scrub radius: a forward force on the left wheel steers right (negative
    // about z), on the right wheel left; equal forces cancel.
    let l = d.kingpin_torque(0.0, 0.0, 500.0, 1.0);
    let r = d.kingpin_torque(0.0, 0.0, 500.0, -1.0);
    assert!((l + 0.01 * 500.0).abs() < 1e-12 && (r - 0.01 * 500.0).abs() < 1e-12);
    assert_eq!(l + r, 0.0);
    // Hand wheel: through the ratio, in the input sign, less the assist.
    assert!((d.hand_wheel_torque(14.0) + 1.0).abs() < 1e-12);
    let mut assisted = d.clone();
    assisted.steering.power_assist = 0.75;
    assert!((assisted.hand_wheel_torque(14.0) + 0.25).abs() < 1e-12);
}

#[test]
fn the_boost_curve_leaves_the_centre_manual_and_tends_to_the_assist_fraction() {
    // ADR-0029: Tm = −T_kp / ratio, T_h = (1 − a)·Tm + a·Tm / √(1 + (Tm/T₀)²).
    let mut d = VehicleDefinition::default();
    d.steering.ratio = 14.0;
    d.steering.power_assist = 0.75;
    d.steering.power_assist_onset = 1.0;
    // At the onset itself: 0.25 + 0.75 / √2 of the manual torque.
    let at_onset = d.hand_wheel_torque(-14.0);
    let expect = 0.25 + 0.75 / 2f64.sqrt();
    assert!((at_onset - expect).abs() < 1e-12, "{at_onset} vs {expect}");
    // Odd in the torque.
    assert_eq!(d.hand_wheel_torque(14.0), -at_onset);
    // On centre the slope is the manual one.
    let small = 1e-6;
    let slope0 = d.hand_wheel_torque(-14.0 * small) / small;
    assert!((slope0 - 1.0).abs() < 1e-9, "slope on centre {slope0}");
    // Far above the onset: (1 − a)·Tm plus a·T₀.
    let big = 1000.0;
    let far = d.hand_wheel_torque(-14.0 * big);
    assert!((far - (0.25 * big + 0.75)).abs() < 1e-3, "{far}");
    // Rising everywhere, even at full assist.
    d.steering.power_assist = 1.0;
    let mut last = 0.0;
    for i in 1..=2000 {
        let tm = 0.01 * i as f64;
        let th = d.hand_wheel_torque(-14.0 * tm);
        assert!(th > last, "falls at {tm}: {th} after {last}");
        last = th;
    }
    // Zero onset is the constant fraction exactly.
    d.steering.power_assist = 0.75;
    d.steering.power_assist_onset = 0.0;
    assert_eq!(d.hand_wheel_torque(14.0), -(1.0 - 0.75) * 14.0 / 14.0);
}

#[test]
fn mechanical_trail_adds_to_the_steering_torque_in_a_turn() {
    let mut w = World::new(1);
    w.add_vehicle(VehicleDefinition::default()).unwrap();
    settle(&mut w, cornering(), 6.0);
    let base = w.telemetry_of(0)[t::STEERING_TORQUE];
    let mut d = VehicleDefinition::default();
    d.steering.mechanical_trail = 0.06;
    let mut w2 = World::new(1);
    w2.add_vehicle(d).unwrap();
    settle(&mut w2, cornering(), 6.0);
    let more = w2.telemetry_of(0)[t::STEERING_TORQUE];
    // Turning right (positive input) the tires push the wheel back toward
    // centre: a negative torque in the input sign, which is what a
    // force-feedback wheel is driven with.
    assert!(base < -0.5, "turning right the wheel pulls back: {base}");
    assert!(more < 1.3 * base, "trail 0.06 m: {more} vs {base}");
    assert!(w2.telemetry_of(0)[t::RACK_FORCE].abs() > w.telemetry_of(0)[t::RACK_FORCE].abs());
}

#[test]
fn a_front_limited_slip_differential_gives_torque_steer_through_the_scrub_radius() {
    // FWD default car: open front differential puts equal force on both
    // front wheels and the scrub terms cancel; an LSD biases torque to the
    // slower (inner) wheel and the rack feels the difference.
    let run = |kind: DifferentialKind, scrub: f64| {
        let mut d = VehicleDefinition::default();
        d.drivetrain.front.kind = kind;
        d.drivetrain.front.bias_drive = 3.0;
        d.drivetrain.front.preload = 100.0;
        d.steering.scrub_radius = scrub;
        d.steering.mechanical_trail = 0.0;
        let mut w = World::new(1);
        w.add_vehicle(d).unwrap();
        settle(
            &mut w,
            VehicleInput {
                steer: 0.3,
                throttle: 0.8,
                ..VehicleInput::default()
            },
            6.0,
        );
        let v = w.telemetry_of(0);
        (
            v[t::STEERING_TORQUE],
            v[t::DIFF_LOCK_TORQUE_F],
            v[t::FX_FL] - v[t::FX_FR],
        )
    };
    let (open_no_scrub, _, _) = run(DifferentialKind::Open, 0.0);
    let (open_scrub, _, dfx_open) = run(DifferentialKind::Open, 0.04);
    let (lsd_scrub, lock, dfx_lsd) = run(DifferentialKind::Lsd, 0.04);
    // Equal torques; the forces differ only by the rolling resistance of
    // the unequal loads.
    assert!(
        dfx_open.abs() < 150.0,
        "open diff: equal drive torques ({dfx_open} N)"
    );
    // Near-symmetric forces: the scrub term is only the rolling-resistance
    // difference of the unequal loads.
    assert!(
        (open_scrub - open_no_scrub).abs() < 0.4,
        "scrub alone is nearly silent: {open_scrub} vs {open_no_scrub}"
    );
    assert!(lock.abs() > 50.0, "the LSD is working: {lock} N·m");
    assert!(
        dfx_lsd.abs() > 2.0 * dfx_open.abs() + 200.0,
        "LSD biases the drive force: {dfx_lsd} N"
    );
    assert!(
        (lsd_scrub - open_scrub).abs() > 3.0 * (open_scrub - open_no_scrub).abs() + 0.3,
        "torque steer: {lsd_scrub} vs {open_scrub} N·m"
    );
}

#[test]
fn single_track_and_four_wheel_agree_on_the_hand_wheel_torque_in_the_linear_range() {
    let mut four = World::new(1);
    four.add_vehicle(VehicleDefinition::default()).unwrap();
    let mut d = VehicleDefinition::default();
    d.simulation.model = VehicleModelKind::SingleTrack;
    let mut single = World::new(1);
    single.add_vehicle(d).unwrap();
    let gentle = VehicleInput {
        steer: 0.1,
        throttle: 0.3,
        ..VehicleInput::default()
    };
    settle(&mut four, gentle, 8.0);
    settle(&mut single, gentle, 8.0);
    let a = four.telemetry_of(0)[t::STEERING_TORQUE];
    let b = single.telemetry_of(0)[t::STEERING_TORQUE];
    assert!(a < -0.2 && b < -0.2, "{a} {b}");
    assert!(
        (a - b).abs() < 0.35 * a.abs().max(b.abs()),
        "four-wheel {a} vs single-track {b} N·m"
    );
}

#[test]
fn jacking_unloads_the_inner_rear_wheel_and_is_absent_at_zero_rate() {
    let kart: VehicleDefinition = serde_json::from_str(include_str!(
        "../../../packages/presets/src/vehicles/kart.json"
    ))
    .unwrap();
    assert!(kart.steering.jacking_rate > 0.0, "the kart preset jacks");
    let loads = |rate: f64| {
        let mut d = kart.clone();
        d.steering.jacking_rate = rate;
        let mut car = FourWheelVehicle::new(d);
        car.set_speed(8.0);
        // Steer left (negative input) at a steady throttle.
        let input = VehicleInput {
            steer: -0.5,
            throttle: 0.3,
            ..VehicleInput::default()
        };
        for _ in 0..3000 {
            car.substep(0.001, &input);
        }
        [
            car.wheels[FL].load,
            car.wheels[FR].load,
            car.wheels[RL].load,
            car.wheels[RR].load,
        ]
    };
    let flat = loads(0.0);
    let jacked = loads(kart.steering.jacking_rate);
    // Left turn: inner = left. Jacking loads the inner front and unloads the
    // inner rear, diagonally. The tires' vertical compliance (ADR-0028),
    // in series with the kart's stiff frame, takes some of the rear's
    // share.
    assert!(
        jacked[0] > flat[0] + 30.0,
        "inner front {} vs {}",
        jacked[0],
        flat[0]
    );
    assert!(
        jacked[1] < flat[1] - 30.0,
        "outer front {} vs {}",
        jacked[1],
        flat[1]
    );
    assert!(
        jacked[2] < flat[2] - 40.0,
        "inner rear {} vs {}",
        jacked[2],
        flat[2]
    );
    assert!(
        jacked[3] > flat[3] + 40.0,
        "outer rear {} vs {}",
        jacked[3],
        flat[3]
    );
    let total: f64 = jacked.iter().sum();
    let total_flat: f64 = flat.iter().sum();
    assert!(
        (total - total_flat).abs() < 0.05 * total_flat,
        "weight is conserved"
    );
}

#[test]
fn bad_steering_geometry_is_rejected() {
    let mut d = VehicleDefinition::default();
    d.steering.power_assist = 1.5;
    assert!(d.validate().is_err());
    let mut d = VehicleDefinition::default();
    d.steering.steering_arm = 0.0;
    assert!(d.validate().is_err());
    let mut d = VehicleDefinition::default();
    d.steering.jacking_rate = 2.0;
    assert!(d.validate().is_err());
    let mut d = VehicleDefinition::default();
    d.steering.power_assist_onset = -1.0;
    assert!(d.validate().is_err());
    d.steering.power_assist_onset = 25.0;
    assert!(d.validate().is_err());
}

/// Height of the lowest rim point of a wheel turned by `delta` about the
/// kingpin axis, found by sampling the rim: an independent check on the
/// closed form in `kingpin_lift_torque` (left wheel, y outboard).
fn lowest_rim_point(d: &VehicleDefinition, delta: f64, radius: f64) -> f64 {
    let st = &d.steering;
    let (tl, tc) = (
        m::tan(m::deg_to_rad(st.kingpin_inclination_deg)),
        m::tan(m::deg_to_rad(st.caster_deg)),
    );
    let n = m::sqrt(1.0 + tl * tl + tc * tc);
    let u = [-tc / n, -tl / n, 1.0 / n];
    let p0 = [st.mechanical_trail, -st.scrub_radius, 0.0];
    let rot = |v: [f64; 3]| {
        let (s, c) = (m::sin(delta), m::cos(delta));
        let ud = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
        let x = [
            u[1] * v[2] - u[2] * v[1],
            u[2] * v[0] - u[0] * v[2],
            u[0] * v[1] - u[1] * v[0],
        ];
        [0, 1, 2].map(|k| v[k] * c + x[k] * s + u[k] * ud * (1.0 - c))
    };
    let mut lowest = f64::INFINITY;
    for k in 0..200_000 {
        let th = std::f64::consts::TAU * k as f64 / 200_000.0;
        // Rim point in the wheel plane (x forward, z up), relative to the axis.
        let p = [
            radius * m::sin(th) - p0[0],
            -p0[1],
            radius - radius * m::cos(th),
        ];
        lowest = lowest.min(rot(p)[2]);
    }
    lowest
}

#[test]
fn kingpin_lift_torque_matches_the_sampled_rim_geometry() {
    // ADR-0030: T = Fz · dh/dδ, with h the lowest point of the turned wheel.
    let mut d = VehicleDefinition::default();
    d.steering.kingpin_inclination_deg = 13.0;
    d.steering.caster_deg = 6.0;
    d.steering.scrub_radius = 0.01;
    d.steering.mechanical_trail = 0.025;
    let (r, fz) = (0.31, 4000.0);
    for delta in [-0.3, -0.1, 0.05, 0.2, 0.4] {
        let e = 2e-3;
        let dh =
            (lowest_rim_point(&d, delta + e, r) - lowest_rim_point(&d, delta - e, r)) / (2.0 * e);
        let t = d.kingpin_lift_torque(fz, delta, 1.0, r);
        assert!(
            (t - fz * dh).abs() < 0.02 * (fz * dh).abs() + 0.05,
            "δ {delta}: closed form {t} vs sampled {}",
            fz * dh
        );
    }
}

#[test]
fn kingpin_inclination_centres_and_caster_cancels_between_the_wheels() {
    let mut d = VehicleDefinition::default();
    let (r, fz) = (0.31, 4000.0);
    // No angles: nothing, exactly.
    assert_eq!(d.kingpin_lift_torque(fz, 0.2, 1.0, r), 0.0);
    // Inclination alone, with no trail (trail with inclination tilts the
    // lift like caster does): zero straight ahead, against the steer either
    // way and on either side, the same on both wheels.
    d.steering.kingpin_inclination_deg = 12.0;
    d.steering.scrub_radius = 0.01;
    d.steering.mechanical_trail = 0.0;
    assert!(d.kingpin_lift_torque(fz, 0.0, 1.0, r).abs() < 1e-9);
    for side in [1.0, -1.0] {
        let left_turn = d.kingpin_lift_torque(fz, 0.1, side, r);
        let right_turn = d.kingpin_lift_torque(fz, -0.1, side, r);
        assert!(
            left_turn < 0.0 && right_turn > 0.0,
            "side {side}: {left_turn} {right_turn}"
        );
        assert!((left_turn + right_turn).abs() < 1e-9);
    }
    let pair = d.kingpin_lift_torque(fz, 0.1, 1.0, r) + d.kingpin_lift_torque(fz, 0.1, -1.0, r);
    // About 2·Fz·e·sin λ·sin δ with e the axis offset at the hub, s + R tan λ
    // (the small-angle lift of the wheel centre), to within the camber term.
    let e = 0.01 + r * m::tan(m::deg_to_rad(12.0));
    let approx = -2.0 * fz * e * m::sin(m::deg_to_rad(12.0)) * m::sin(0.1);
    assert!(
        (pair - approx).abs() < 0.25 * approx.abs(),
        "{pair} vs {approx}"
    );
    // Caster alone: equal and opposite on the two wheels at equal loads, a
    // pull toward the lighter side when they differ.
    d.steering.kingpin_inclination_deg = 0.0;
    d.steering.caster_deg = 6.0;
    let l = d.kingpin_lift_torque(fz, 0.0, 1.0, r);
    let rr = d.kingpin_lift_torque(fz, 0.0, -1.0, r);
    // About Fz·s·sin ν per wheel with only the scrub radius as the offset.
    let approx = fz * 0.01 * m::sin(m::deg_to_rad(6.0));
    assert!(
        (l.abs() - approx).abs() < 0.1 * approx && (l + rr).abs() < 1e-9,
        "{l} {rr}"
    );
}

#[test]
fn kingpin_inclination_returns_the_wheel_at_parking_speed() {
    let torque = |kpi: f64| {
        let mut d = VehicleDefinition::default();
        d.steering.kingpin_inclination_deg = kpi;
        d.steering.caster_deg = 5.0;
        let mut w = World::new(1);
        w.add_vehicle(d).unwrap();
        settle(
            &mut w,
            VehicleInput {
                steer: 0.5,
                ..VehicleInput::default()
            },
            3.0,
        );
        w.telemetry_of(0)[t::STEERING_TORQUE]
    };
    let without = torque(0.0);
    let with = torque(13.0);
    // Parked with the wheel turned right, the load pushes it back left: a
    // negative torque in the input sign, larger than the tires give alone.
    assert!(with < without - 0.3, "with {with} vs without {without}");
}

/// A car with every source of steering torque switched on: trail, scrub,
/// steering lift and a boost-curve assist (ADR-0031).
fn every_torque_source(model: VehicleModelKind) -> VehicleDefinition {
    let mut d = VehicleDefinition::default();
    d.simulation.model = model;
    d.steering.kingpin_inclination_deg = 12.0;
    d.steering.caster_deg = 5.0;
    d.steering.power_assist = 0.6;
    d.steering.power_assist_onset = 1.5;
    d
}

#[test]
fn the_torque_breakdown_sums_to_the_steering_torque() {
    for model in [VehicleModelKind::FourWheel, VehicleModelKind::SingleTrack] {
        let mut w = World::new(1);
        w.add_vehicle(every_torque_source(model)).unwrap();
        settle(&mut w, cornering(), 6.0);
        let rec = w.telemetry_of(0);
        let parts = &rec[t::STEER_TORQUE_MZ..=t::STEER_TORQUE_ASSIST];
        let sum: f64 = parts.iter().sum();
        let total = rec[t::STEERING_TORQUE];
        assert!(total.abs() > 0.2, "{model:?}: {total}");
        assert!(
            (sum - total).abs() < 1e-12 * (1.0 + total.abs()),
            "{model:?}: parts {parts:?} sum {sum} vs {total}"
        );
        // Each share is its kingpin term through the ratio, in the input
        // sign: the aligning moment from the tire channels.
        let ratio = VehicleDefinition::default().steering.ratio;
        let mz = rec[t::MZ_FL] + rec[t::MZ_FR];
        assert!((parts[0] + mz / ratio).abs() < 1e-9, "{model:?}");
        // Assisted and turning right: the tires push back left (negative),
        // the assist takes some of that away (positive), and the lift
        // centres (negative).
        assert!(parts[4] > 0.0 && parts[3] < 0.0, "{model:?}: {parts:?}");
        // The single-track lumped tire has no scrub moment.
        if model == VehicleModelKind::SingleTrack {
            assert_eq!(parts[2], 0.0);
        }
    }
}

#[test]
fn a_manual_car_has_no_assist_share() {
    let mut d = every_torque_source(VehicleModelKind::FourWheel);
    d.steering.power_assist = 0.0;
    let mut w = World::new(1);
    w.add_vehicle(d).unwrap();
    settle(&mut w, cornering(), 3.0);
    assert_eq!(w.telemetry_of(0)[t::STEER_TORQUE_ASSIST], 0.0);
}

#[test]
fn the_mean_steering_torque_is_the_mean_over_the_substeps() {
    // One host step of n substeps is bit for bit n host steps of one
    // substep each, so the mean can be rebuilt from the latter.
    let def = every_torque_source(VehicleModelKind::FourWheel);
    let rate = def.simulation.substep_rate_hz;
    let n = 17;
    let dt = n as f64 / rate;
    let mut coarse = World::new(1);
    coarse.add_vehicle(def.clone()).unwrap();
    let mut fine = World::new(1);
    fine.add_vehicle(def).unwrap();
    let input = VehicleInput {
        steer: 0.3,
        throttle: 0.5,
        ..VehicleInput::default()
    };
    coarse.set_input(0, input).unwrap();
    fine.set_input(0, input).unwrap();
    for step in 0..120 {
        coarse.step(dt);
        let mut sum = 0.0;
        for _ in 0..n {
            fine.step(dt / n as f64);
            sum += fine.telemetry_of(0)[t::STEERING_TORQUE];
            // A one-substep step's mean is its only value.
            assert_eq!(
                fine.telemetry_of(0)[t::STEERING_TORQUE_MEAN],
                fine.telemetry_of(0)[t::STEERING_TORQUE]
            );
        }
        let rec = coarse.telemetry_of(0);
        assert_eq!(
            rec[t::STEERING_TORQUE],
            fine.telemetry_of(0)[t::STEERING_TORQUE]
        );
        assert_eq!(rec[t::STEERING_TORQUE_MEAN], sum / n as f64, "step {step}");
    }
}

#[test]
fn the_torque_slices_are_the_step_in_eight_parts() {
    // As above: rebuild each slice from one-substep steps. 20 substeps
    // fall in slice ⌊8j/20⌋; with fewer substeps than slices, an empty
    // slice repeats the one before.
    let def = every_torque_source(VehicleModelKind::FourWheel);
    let rate = def.simulation.substep_rate_hz;
    for n in [20usize, 8, 5, 1] {
        let dt = n as f64 / rate;
        let mut coarse = World::new(1);
        coarse.add_vehicle(def.clone()).unwrap();
        let mut fine = World::new(1);
        fine.add_vehicle(def.clone()).unwrap();
        let input = VehicleInput {
            steer: 0.3,
            throttle: 0.5,
            ..VehicleInput::default()
        };
        coarse.set_input(0, input).unwrap();
        fine.set_input(0, input).unwrap();
        for _ in 0..30 {
            coarse.step(dt);
            let mut sums = [0.0; 8];
            let mut counts = [0usize; 8];
            for j in 0..n {
                fine.step(dt / n as f64);
                let k = j * 8 / n;
                sums[k] += fine.telemetry_of(0)[t::STEERING_TORQUE];
                counts[k] += 1;
            }
            let rec = coarse.telemetry_of(0);
            let mut prev = f64::NAN;
            for k in 0..8 {
                let want = if counts[k] > 0 {
                    sums[k] / counts[k] as f64
                } else {
                    prev
                };
                assert_eq!(rec[t::STEERING_TORQUE_SLICE_0 + k], want, "n {n} slice {k}");
                prev = want;
            }
            // The last slice ends on the last substep's value when it holds one.
            if n == 8 || n == 1 {
                assert_eq!(rec[t::STEERING_TORQUE_SLICE_7], rec[t::STEERING_TORQUE]);
            }
        }
    }
}
