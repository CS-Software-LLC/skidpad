//! Unsprung mass (ADR-0028): each wheel rides on its own spring between the
//! body and a tire spring, the two-mass quarter car. The exact-answer tests
//! drive the symmetric "two-mass car" of `common::textbook`, whose heave is
//! that quarter car times four, and compare with the closed form. The rest
//! check that the option changes nothing it should not: ride height, the
//! external-host contract, snapshots, stability across rates, and the
//! massless limit. Tolerances were set before the first run; results are
//! in `docs/validation/analytic.md`.

mod common;

use common::textbook::*;
use skidpad_core::definition::{SuspensionKind, VehicleModelKind};
use skidpad_core::geom::Vec3;
use skidpad_core::snapshot::{SnapshotError, Snapshottable};
use skidpad_core::telemetry as t;
use skidpad_core::tire::tir;
use skidpad_core::validation::understeer::{self, UndersteerConfig};
use skidpad_core::validation::{timestep_sweep, TimestepSweepConfig};
use skidpad_core::vehicle::{FourWheelVehicle, HostMode, FL, FR, RR};
use skidpad_core::world::{HOST_CONTACT_STRIDE, HOST_IN_BODY_LEN, HOST_IN_STRIDE, HOST_OUT_STRIDE};
use skidpad_core::{VehicleDefinition, VehicleInput, VehicleModel, World, GRAVITY};
use skidpad_math as m;

/// Substep of the free-decay and limit runs, s (the default 1 kHz).
const DT: f64 = 0.001;
/// Substep of the rig runs, s (4 kHz). Both masses are stepped at first
/// order, which lags each response by about one substep: at the top of the
/// supported range (2 kHz) that is 4.75° on the tire load at 25 Hz, beyond
/// the 3° set before the run, and it halves at 4 kHz. The convergence test
/// below covers the integration error itself.
const DT_RIG: f64 = 0.00025;

fn rel(a: f64, b: f64) -> f64 {
    m::abs(a / b - 1.0)
}

fn default_with_unsprung() -> VehicleDefinition {
    with_unsprung(VehicleDefinition::default(), 40.0, 250_000.0, 500.0)
}

/// The wheels' mean height change, from the body's and each wheel's travel
/// (bump lifts the wheel toward the body). Valid while the body is level.
fn wheel_z(car: &FourWheelVehicle, rest: f64) -> f64 {
    let s: f64 = car.wheels.iter().map(|w| w.hub_travel).sum::<f64>() / 4.0;
    car.pos.z - rest + s
}

// --- ride height and the option off ------------------------------------------

/// Switching unsprung mass on keeps the definition's ride height and static
/// tire loads: the spring and the tire are both preloaded, and the body
/// stays where it was put.
#[test]
fn rests_at_ride_height_with_the_massless_static_loads() {
    let massless = FourWheelVehicle::new(VehicleDefinition::default());
    let mut car = FourWheelVehicle::new(default_with_unsprung());
    for _ in 0..2000 {
        car.substep(DT, &VehicleInput::default());
    }
    let h = VehicleDefinition::default().chassis.cg_height;
    assert!(
        m::abs(car.pos.z - h) < 1e-9,
        "ride height {} vs {h}",
        car.pos.z
    );
    for i in 0..4 {
        let (got, want) = (car.wheels[i].load, massless.wheels[i].load);
        assert!(m::abs(got - want) < 1e-6, "wheel {i}: load {got} vs {want}");
        assert!(m::abs(car.wheels[i].hub_travel) < 1e-9);
    }
    let mut rec = vec![0.0; t::STRIDE];
    car.write_telemetry(&VehicleInput::default(), &mut rec);
    let g = car.geometry()[FL];
    assert!(m::abs(rec[t::TIRE_DEFLECTION_FL] - g.tire_static_deflection) < 1e-9);
    assert!(m::abs(g.tire_static_deflection - g.static_load / 250_000.0) < 1e-15);
    massless.write_telemetry(&VehicleInput::default(), &mut rec);
    assert_eq!(rec[t::TIRE_DEFLECTION_FL], 0.0);
}

// --- heave: free decay and energy -------------------------------------------

/// Released with the body and wheels 5 mm low, the body and the wheels
/// follow the two-mass quarter car's free response within 2 % of the drop.
#[test]
fn heave_free_decay_follows_the_two_mass_quarter_car() {
    let d = two_mass_car();
    let q = two_mass(&d);
    let mut car = FourWheelVehicle::new(d);
    let rest = car.pos.z;
    let drop = 0.005;
    car.pos.z -= drop;
    let exact = two_mass_free(&q, -drop, -drop, DT, 3000);
    let (mut worst_s, mut worst_u) = (0.0, 0.0);
    for (zs_th, zu_th) in exact {
        car.substep(DT, &VehicleInput::default());
        worst_s = m::max(worst_s, m::abs(car.pos.z - rest - zs_th));
        worst_u = m::max(worst_u, m::abs(wheel_z(&car, rest) - zu_th));
    }
    assert!(
        worst_s < 0.02 * drop,
        "body off the quarter car by {worst_s} m"
    );
    assert!(
        worst_u < 0.02 * drop,
        "wheels off the quarter car by {worst_u} m"
    );
}

/// The energy the same release loses is what the four dampers and the four
/// tire dampers absorb, less the integrator's own damping of the wheel
/// hop. The implicit wheel step damps the hop numerically by about
/// `ω dt / 2`: at 1 kHz the residual is 3.7 % of the initial energy (the
/// release puts nearly all of it in the tires), beyond the 0.5 % set before
/// the run, and it halves as the rate doubles, as a first-order error does.
#[test]
fn heave_energy_balance_misses_only_by_first_order_numerical_damping() {
    let residual = |dt: f64| {
        let d = two_mass_car();
        let q = two_mass(&d);
        let mut car = FourWheelVehicle::new(d);
        let rest = car.pos.z;
        car.pos.z -= 0.005;
        let energy = |car: &FourWheelVehicle| {
            let (zs, vs) = (car.pos.z - rest, car.vel.z);
            let s: f64 = car.wheels.iter().map(|w| w.hub_travel).sum::<f64>() / 4.0;
            let r: f64 = car.wheels.iter().map(|w| w.hub_rate).sum::<f64>() / 4.0;
            let (zu, vu) = (zs + s, vs + r);
            0.5 * q.ms * vs * vs + 0.5 * q.mu * vu * vu + 0.5 * q.ks * s * s + 0.5 * q.kt * zu * zu
        };
        let rates = |car: &FourWheelVehicle| {
            let r: f64 = car.wheels.iter().map(|w| w.hub_rate).sum::<f64>() / 4.0;
            (r, car.vel.z + r)
        };
        let e0 = energy(&car);
        let (mut absorbed, mut worst) = (0.0, 0.0);
        for _ in 0..m::round(3.0 / dt) as usize {
            let (r0, vu0) = rates(&car);
            car.substep(dt, &VehicleInput::default());
            let (r1, vu1) = rates(&car);
            absorbed += 0.5 * (q.cs * (r0 * r0 + r1 * r1) + q.ct * (vu0 * vu0 + vu1 * vu1)) * dt;
            worst = m::max(worst, m::abs(energy(&car) - (e0 - absorbed)));
        }
        worst / e0
    };
    let (coarse, fine) = (residual(0.001), residual(0.0005));
    assert!(
        coarse < 0.04,
        "energy residual {coarse} of the initial energy at 1 kHz"
    );
    let ratio = fine / coarse;
    assert!(
        (0.4..=0.6).contains(&ratio),
        "residual ratio {ratio} from 1 to 2 kHz"
    );
}

// --- four-post rig -------------------------------------------------------------

/// Drive all four contact planes up and down together and record the
/// body's height and the sum of the four tire loads. Returns the measured
/// `Z_s/Y` and `ΔF/Y`.
fn heave_rig(d: &VehicleDefinition, hz: f64) -> (Cx, Cx) {
    let w = m::TAU * hz;
    let amp = 0.002;
    let mut car = FourWheelVehicle::new(d.clone());
    let settle = 6.0;
    let end = settle + m::ceil(4.0 * hz) / hz;
    let (mut ts, mut road, mut body, mut load) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    let n = m::round(end / DT_RIG) as usize;
    for i in 0..n {
        let ti = i as f64 * DT_RIG;
        for c in car.contacts.iter_mut() {
            c.point.z = amp * m::sin(w * ti);
            c.surface_velocity.z = amp * w * m::cos(w * ti);
        }
        car.substep(DT_RIG, &VehicleInput::default());
        let te = ti + DT_RIG;
        if te >= settle {
            ts.push(te);
            road.push(amp * m::sin(w * te));
            body.push(car.pos.z);
            // The loads were computed at the start of the substep, from the
            // road at `ti`.
            load.push(car.wheels.iter().map(|w| w.load).sum::<f64>());
        }
    }
    let y = phasor(&ts, &road, w);
    let t_load: Vec<f64> = ts.iter().map(|&x| x - DT_RIG).collect();
    let y_load = phasor(&t_load, &road, w);
    (
        phasor(&ts, &body, w).div(y),
        phasor(&t_load, &load, w).div(y_load),
    )
}

/// Road motion reaches the body and the tire loads as the two-mass quarter
/// car says, in gain and phase, through the body resonance and the wheel
/// hop.
#[test]
fn four_post_rig_matches_the_two_mass_quarter_car() {
    let d = two_mass_car();
    let q = two_mass(&d);
    for hz in [0.5, 1.0, 1.4, 3.0, 6.0, 10.0, 12.0, 14.0, 20.0, 25.0] {
        let (body, load) = heave_rig(&d, hz);
        let (want_body, _, want_load) = two_mass_response(&q, hz);
        for (name, got, want) in [("body", body, want_body), ("tire load", load, want_load)] {
            let dphase = phase_diff(got.arg_deg(), want.arg_deg());
            assert!(
                rel(got.abs(), want.abs()) < 0.03,
                "{hz} Hz {name}: gain {} vs {}",
                got.abs(),
                want.abs()
            );
            assert!(
                m::abs(dphase) < 3.0,
                "{hz} Hz {name}: phase off by {dphase}°"
            );
        }
    }
}

// --- convergence order -----------------------------------------------------------

/// The body and the wheels are both stepped at first order, so with the
/// wheel hop excited the error against a 16 kHz reference halves as the
/// rate doubles: observed order between 0.85 and 1.15 from 500 Hz to 2 kHz.
#[test]
fn integration_error_falls_at_first_order() {
    let run = |rate: f64| -> (Vec<f64>, Vec<f64>) {
        let dt = 1.0 / rate;
        let per_sample = m::round(rate / 500.0) as usize;
        let mut car = FourWheelVehicle::new(two_mass_car());
        let rest = car.pos.z;
        car.pos.z -= 0.005;
        let (mut zs, mut zu) = (Vec::new(), Vec::new());
        for _ in 0..500 {
            for _ in 0..per_sample {
                car.substep(dt, &VehicleInput::default());
            }
            zs.push(car.pos.z);
            zu.push(wheel_z(&car, rest));
        }
        (zs, zu)
    };
    let rms = |a: &[f64], b: &[f64]| {
        m::sqrt(a.iter().zip(b).map(|(x, y)| (x - y) * (x - y)).sum::<f64>() / a.len() as f64)
    };
    let reference_rate = 16_000.0;
    let (ref_s, ref_u) = run(reference_rate);
    let rates = [500.0, 1000.0, 2000.0];
    let runs = rates.map(run);
    for (name, pick) in [("body", 0usize), ("wheels", 1)] {
        let reference = if pick == 0 { &ref_s } else { &ref_u };
        let errors = [0, 1, 2].map(|i| {
            let r = if pick == 0 { &runs[i].0 } else { &runs[i].1 };
            rms(r, reference)
        });
        for i in 0..2 {
            let p = convergence_order(
                1.0 / rates[i],
                errors[i],
                1.0 / rates[i + 1],
                errors[i + 1],
                1.0 / reference_rate,
            );
            assert!(
                (0.85..=1.15).contains(&p),
                "{name}: order {p} between {} Hz and {} Hz (errors {errors:?})",
                rates[i],
                rates[i + 1]
            );
        }
    }
}

// --- the massless limit -----------------------------------------------------------

/// A very light wheel on a tire ten times stiffer than usual behaves like the
/// massless strut: the body's heave and the four-wheel step steer move by
/// under 1 %. The implicit wheel step keeps this stiff corner stable at
/// 1 kHz (its hop is near 250 Hz).
#[test]
fn a_light_wheel_on_a_stiff_tire_approaches_the_massless_strut() {
    // The textbook car has no anti-roll bars and rolls 5.7° in this step
    // steer. At that angle the two models' different projections of the
    // strut force onto the tire load (the massless strut takes `F cos φ`,
    // the wheel `F / cos φ`) differ by 1 %, independent of the wheel, so
    // the bars go back on; the car then rolls under 3°.
    let mut base = textbook_car();
    base.axles[0].suspension.anti_roll_stiffness = 15_000.0;
    base.axles[1].suspension.anti_roll_stiffness = 8_000.0;
    let massless = base.clone();
    let stiff = with_unsprung(base, 1.0, 2_500_000.0, 0.0);

    let heave = |d: &VehicleDefinition| {
        let mut car = FourWheelVehicle::new(d.clone());
        car.pos.z -= 0.02;
        // The massless strut compresses by the drop with its contacts on
        // the ground; start the wheels the same way.
        if d.has_unsprung_mass() {
            for w in car.wheels.iter_mut() {
                w.hub_travel = 0.02;
            }
        }
        (0..2000)
            .map(|_| {
                car.substep(DT, &VehicleInput::default());
                car.pos.z
            })
            .collect::<Vec<_>>()
    };
    let (a, b) = (heave(&massless), heave(&stiff));
    let worst = a
        .iter()
        .zip(&b)
        .map(|(x, y)| m::abs(x - y))
        .fold(0.0, f64::max);
    assert!(worst < 0.01 * 0.02, "heave differs by {worst} m");

    let steer = |d: &VehicleDefinition| {
        let mut car = FourWheelVehicle::new(d.clone());
        car.set_speed(22.22);
        let mut out = Vec::new();
        for k in 0..3000 {
            let time = (k + 1) as f64 * DT;
            let input = VehicleInput {
                steer: if time < 0.5 { 0.0 } else { 0.1 },
                ..VehicleInput::default()
            };
            car.substep(DT, &input);
            out.push(car.yaw_rate());
        }
        out
    };
    let (a, b) = (steer(&massless), steer(&stiff));
    let steady = m::abs(a[a.len() - 1]);
    let worst = a
        .iter()
        .zip(&b)
        .map(|(x, y)| m::abs(x - y))
        .fold(0.0, f64::max);
    assert!(steady > 0.05, "steady yaw rate {steady}");
    assert!(
        worst < 0.01 * steady,
        "yaw rate differs by {worst} of {steady} rad/s"
    );
}

// --- external host ------------------------------------------------------------------

/// With unsprung mass the host keeps the whole car's mass and gravity: the
/// reported impulse plus gravity is the body's velocity change, and at rest
/// it is exactly the massless car's.
#[test]
fn external_host_impulse_equals_builtin_velocity_change() {
    let d = default_with_unsprung();
    let mut builtin = World::new(1);
    builtin.add_vehicle(d.clone()).unwrap();
    let mut external = World::new(1);
    external.add_vehicle(d.clone()).unwrap();
    external.set_host_mode(0, HostMode::External).unwrap();
    let input = VehicleInput {
        steer: 0.3,
        throttle: 0.8,
        ..Default::default()
    };
    let dt = 1.0 / 60.0;
    let mass = d.chassis.mass;
    for k in 0..180 {
        // The first step is at rest with no input; the throttle's pitch
        // would otherwise heave the body frame, as the sprung mass's centre
        // is not the whole car's.
        if k == 1 {
            builtin.set_input(0, input).unwrap();
            external.set_input(0, input).unwrap();
        }
        let (pos, orient, vel, angvel) = {
            let c = builtin.vehicle(0).unwrap().model.as_four_wheel().unwrap();
            (c.pos, c.orient, c.vel, c.orient.rotate(c.omega))
        };
        {
            let rec = &mut external.host_in_mut()[..HOST_IN_STRIDE];
            rec[0] = pos.x;
            rec[1] = pos.y;
            rec[2] = pos.z;
            rec[3] = orient.x;
            rec[4] = orient.y;
            rec[5] = orient.z;
            rec[6] = orient.w;
            rec[7] = vel.x;
            rec[8] = vel.y;
            rec[9] = vel.z;
            rec[10] = angvel.x;
            rec[11] = angvel.y;
            rec[12] = angvel.z;
            for k in 0..4 {
                let o = HOST_IN_BODY_LEN + k * HOST_CONTACT_STRIDE;
                rec[o] = 1.0;
                rec[o + 6] = 1.0;
            }
        }
        builtin.step(dt);
        external.step(dt);
        let b = builtin.vehicle(0).unwrap().model.as_four_wheel().unwrap();
        let e = external.vehicle(0).unwrap().model.as_four_wheel().unwrap();
        assert!((b.vel - e.vel).length() < 1e-12);
        assert!((b.omega - e.omega).length() < 1e-12);
        let out = &external.host_out()[..HOST_OUT_STRIDE];
        let dv = b.vel - vel;
        let predicted =
            Vec3::new(out[0], out[1], out[2]) * (1.0 / mass) + Vec3::new(0.0, 0.0, -GRAVITY * dt);
        assert!(
            (dv - predicted).length() < 1e-9,
            "dv {dv:?} vs {predicted:?}"
        );
        if k == 0 {
            // At rest the impulse holds up the whole car.
            assert!(m::abs(out[2] - mass * GRAVITY * dt) < 1e-3 * mass * GRAVITY * dt);
        }
    }
    let b = builtin.vehicle(0).unwrap().model.as_four_wheel().unwrap();
    assert!(b.speed() > 5.0);
    // The hosts cast the longer ray; the massless car's is unchanged.
    let g = b.geometry()[RR];
    let massless = FourWheelVehicle::new(VehicleDefinition::default());
    let gm = massless.geometry()[RR];
    assert_eq!(g.ray_length, gm.ray_length + g.tire_static_deflection);
}

// --- stability across rates --------------------------------------------------------

/// The default car with unsprung mass meets the same thresholds across the
/// corners of the timestep grid as without it.
#[test]
fn stable_across_the_timestep_grid() {
    let cfg = TimestepSweepConfig {
        substep_rates: vec![250.0, 2000.0],
        host_rates: vec![30.0, 240.0],
        ..TimestepSweepConfig::default()
    };
    let r = timestep_sweep::run(&default_with_unsprung(), &cfg).unwrap();
    assert!(r.all_finite, "non-finite cell");
    assert!(r.all_hold, "{:?}", r.cells);
    assert!(r.clean_stops, "{:?}", r.cells);
    assert!(
        r.gradient_spread_deg_per_g < 0.01,
        "gradient spread {} deg/g",
        r.gradient_spread_deg_per_g
    );
    assert!(
        r.braking_distance_spread < 0.005,
        "braking spread {}",
        r.braking_distance_spread
    );
    assert!(r.stable);
}

/// A kart-light 8 kg wheel on a stiff tire, driven over a rough road at
/// 250 Hz, hits its stops and leaves the ground without blowing up.
#[test]
fn a_light_wheel_on_a_rough_road_at_250_hz_stays_bounded() {
    let d = with_unsprung(VehicleDefinition::default(), 8.0, 400_000.0, 100.0);
    let dt = 1.0 / 250.0;
    let mut car = FourWheelVehicle::new(d);
    car.set_speed(25.0);
    let mut airborne = false;
    for k in 0..2500 {
        let x = car.pos.x;
        for (i, c) in car.contacts.iter_mut().enumerate() {
            // 40 mm bumps every 1.7 m, offset per wheel.
            let phase = x * 3.7 + i as f64 * 1.3;
            c.point.z = 0.02 * m::sin(phase) + 0.02 * m::sin(2.9 * phase);
            c.surface_velocity.z = 0.0;
        }
        let input = VehicleInput {
            steer: 0.3 * m::sin(k as f64 * dt),
            throttle: 0.3,
            ..Default::default()
        };
        car.substep(dt, &input);
        assert!(car.vel.is_finite() && car.omega.is_finite() && car.pos.is_finite());
        for w in &car.wheels {
            assert!(
                w.hub_travel.is_finite() && m::abs(w.hub_travel) < 0.3,
                "travel {}",
                w.hub_travel
            );
            assert!(m::abs(w.hub_rate) < 20.0, "rate {}", w.hub_rate);
            airborne |= !w.in_contact || w.tire_force == 0.0;
        }
        assert!(car.omega.length() < 5.0, "angular velocity {:?}", car.omega);
    }
    assert!(airborne, "the road never unloaded a wheel");
}

// --- snapshots ------------------------------------------------------------------------

/// The wheels' travel and rate are appended to the snapshot: restoring and
/// continuing matches the uninterrupted run bit for bit, and the massless
/// layout is unchanged.
#[test]
fn snapshot_carries_the_wheels_and_restores_exactly() {
    let d = default_with_unsprung();
    let massless = FourWheelVehicle::new(VehicleDefinition::default());
    let mut a = FourWheelVehicle::new(d.clone());
    assert_eq!(a.state_len(), massless.state_len() + 8);
    let input = VehicleInput {
        steer: 0.4,
        throttle: 0.7,
        ..Default::default()
    };
    a.set_speed(15.0);
    for _ in 0..700 {
        a.substep(DT, &input);
    }
    let mut scratch = vec![0.0; 256];
    let mut buf = vec![0u8; a.snapshot_len()];
    a.snapshot_into(&mut buf, &mut scratch);
    let mut b = FourWheelVehicle::new(d);
    b.restore_from(&buf, &mut scratch).unwrap();
    assert_eq!(a.state_hash(&mut scratch), b.state_hash(&mut scratch));
    for _ in 0..700 {
        a.substep(DT, &input);
        b.substep(DT, &input);
    }
    assert_eq!(a.state_hash(&mut scratch), b.state_hash(&mut scratch));
    assert_eq!(a.wheels[FR].hub_travel, b.wheels[FR].hub_travel);
    assert_ne!(a.wheels[FR].hub_travel, 0.0);

    // A massless snapshot does not fit a car with unsprung mass.
    let mut small = vec![0u8; massless.snapshot_len()];
    massless.snapshot_into(&mut small, &mut scratch);
    assert!(matches!(
        b.restore_from(&small, &mut scratch),
        Err(SnapshotError::WrongLength { .. })
    ));
}

/// The level of detail switches down to the single-track model and back up
/// through a snapshot of either model.
#[test]
fn the_level_of_detail_round_trip_keeps_working() {
    let d = default_with_unsprung();
    let mut w = World::new(1);
    w.add_vehicle(d.clone()).unwrap();
    w.step(1.0 / 60.0);
    let mut full = vec![0u8; w.snapshot_len(0).unwrap()];
    w.snapshot(0, &mut full).unwrap();
    let mut single = d.clone();
    single.simulation.model = VehicleModelKind::SingleTrack;
    let mut s = World::new(1);
    s.add_vehicle(single).unwrap();
    s.step(1.0 / 60.0);
    let mut low = vec![0u8; s.snapshot_len(0).unwrap()];
    s.snapshot(0, &mut low).unwrap();
    w.restore(0, &low).unwrap();
    assert_eq!(
        w.vehicle(0).unwrap().model.kind(),
        VehicleModelKind::SingleTrack
    );
    w.restore(0, &full).unwrap();
    assert_eq!(
        w.vehicle(0).unwrap().model.kind(),
        VehicleModelKind::FourWheel
    );
    let _ = VehicleModel::new(d);
}

// --- light corners -------------------------------------------------------------

/// A light body in roll (the open-wheeler preset: 90 kg·m², of which the
/// wheels carry more than half) drives the same steady skidpad at the
/// slowest supported substep as at its own 1 kHz. Before each wheel took
/// its corner's own acceleration in roll and pitch, and before each strut
/// was stepped against the reduced mass of its wheel and the body's corner,
/// the wheels hopped off the ground at 250 Hz and the gradient moved by
/// 0.8 deg/g. Either change alone passes this test; with both removed it
/// fails.
#[test]
fn a_light_body_in_roll_is_stable_at_250_hz() {
    let d: VehicleDefinition = serde_json::from_str(include_str!(
        "../../../packages/presets/src/vehicles/open-wheeler.json"
    ))
    .unwrap();
    assert!(d.has_unsprung_mass());
    let gradient = |rate: f64| {
        let mut d = d.clone();
        d.simulation.substep_rate_hz = rate;
        understeer::run(
            &d,
            &UndersteerConfig {
                radius: 40.0,
                speeds: vec![4.0, 8.0, 12.0],
                settle_time: 8.0,
                measure_time: 1.0,
                host_dt: 1.0 / 60.0,
            },
        )
        .unwrap()
        .gradient_deg_per_g
    };
    let (coarse, fine) = (gradient(250.0), gradient(1000.0));
    assert!(
        m::abs(coarse - fine) < 0.01,
        "{coarse} deg/g at 250 Hz vs {fine} at 1 kHz"
    );
}

// --- definitions and import ------------------------------------------------------------

#[test]
fn validation_rejects_solid_axles_and_impossible_masses() {
    let mut d = default_with_unsprung();
    d.axles[1].suspension.kind = SuspensionKind::Solid;
    let e = d.validate().unwrap_err().join("\n");
    assert!(e.contains("solid axle"), "{e}");

    let mut d = default_with_unsprung();
    d.axles[0].suspension.unsprung_mass = 400.0;
    let e = d.validate().unwrap_err().join("\n");
    assert!(e.contains("static load"), "{e}");

    let mut d = default_with_unsprung();
    d.axles[0].suspension.unsprung_mass = -1.0;
    assert!(d.validate().is_err());

    let mut d = default_with_unsprung();
    d.chassis.roll_inertia = 60.0;
    let e = d.validate().unwrap_err().join("\n");
    assert!(e.contains("rollInertia"), "{e}");
}

#[test]
fn tir_import_reads_the_vertical_stiffness_and_damping() {
    let imp = tir::import_str(
        "[VERTICAL]\nVERTICAL_STIFFNESS = 280000\nVERTICAL_DAMPING = 60\nFNOMIN = 4850\n",
    );
    assert_eq!(imp.params.vertical_stiffness, 280_000.0);
    assert_eq!(imp.params.vertical_damping, 60.0);
    assert!(!imp
        .warnings
        .iter()
        .any(|w| w.key == "VERTICAL_STIFFNESS" || w.key == "VERTICAL_DAMPING"));
}
