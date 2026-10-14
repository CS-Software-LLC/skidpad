//! Exact-answer tests: the core driven where textbook theory has a closed
//! form, and compared with it. These verify the implementation (does the
//! code solve the equations it claims to); the Chrono and NHTSA comparisons
//! validate the model (do those equations describe a car).
//!
//! Every test runs the "textbook car" of `common::textbook`, whose ride modes
//! are decoupled and whose non-textbook effects are off. The wheels are
//! massless (see `vehicle/four_wheel.rs`), so each body mode is a single
//! spring, mass and damper. Tolerances were set from the theory before the
//! first run; results and reasoning are in `docs/validation/analytic.md`.

mod common;

use common::textbook::*;
use skidpad_core::definition::VehicleModelKind;
use skidpad_core::geom::Quat;
use skidpad_core::telemetry as t;
use skidpad_core::tire::TireModel;
use skidpad_core::vehicle::{FourWheelVehicle, FL, FR, RL, RR};
use skidpad_core::{VehicleDefinition, VehicleInput, VehicleModel, World, GRAVITY};
use skidpad_math as m;

/// Substep of every run, s (the default 1 kHz).
const DT: f64 = 0.001;

fn rel(a: f64, b: f64) -> f64 {
    m::abs(a / b - 1.0)
}

// --- body modes: free decay ----------------------------------------------

/// Released 20 mm low, the body bounces at `√(K/m)` with damping ratio
/// `C / 2√(Km)` (Gillespie ch. 5), and the spring and kinetic energy it
/// loses is exactly what the dampers absorb, to integration error.
#[test]
fn heave_free_decay_matches_the_spring_mass_damper() {
    let d = textbook_car();
    let mass = d.chassis.mass;
    let (k, c) = heave_rates(&d);
    let mut car = FourWheelVehicle::new(d.clone());
    let rest = car.pos.z;
    car.pos.z -= 0.02;
    let energy = |car: &FourWheelVehicle| {
        let dz = car.pos.z - rest;
        0.5 * mass * car.vel.z * car.vel.z + 0.5 * k * dz * dz
    };
    let e0 = energy(&car);
    let mut absorbed = 0.0;
    let mut worst = 0.0;
    let mut z = Vec::new();
    for _ in 0..3000 {
        let v0 = car.vel.z;
        car.substep(DT, &VehicleInput::default());
        let v1 = car.vel.z;
        absorbed += c * 0.5 * (v0 * v0 + v1 * v1) * DT;
        worst = m::max(worst, m::abs(energy(&car) - (e0 - absorbed)));
        z.push(car.pos.z);
    }
    let (f, zeta) = free_decay(DT, &z);
    let (f_th, zeta_th) = mode(mass, k, c);
    assert!(rel(f, f_th) < 0.02, "heave {f} Hz vs {f_th} Hz");
    assert!(m::abs(zeta - zeta_th) < 0.02, "damping {zeta} vs {zeta_th}");
    assert!(worst < 0.005 * e0, "energy residual {worst} J of {e0} J");
}

/// Released pitched 0.01 rad, the body pitches at `√(K_θ/I)` with
/// `K_θ = Σ k x² − m g h`: the contacts slide `h θ` past the centre of mass
/// as the rays tilt, and the static loads then help the rotation. The same
/// slide spins the wheels, which adds their inertia to `I`.
#[test]
fn pitch_free_decay_matches_the_spring_mass_damper() {
    let d = textbook_car();
    let (k, c) = pitch_rates(&d);
    let mut car = FourWheelVehicle::new(d.clone());
    car.orient = Quat::from_yaw_pitch_roll(0.0, 0.01, 0.0);
    let mut pitch = Vec::new();
    for _ in 0..3000 {
        car.substep(DT, &VehicleInput::default());
        pitch.push(car.orient.to_yaw_pitch_roll().1);
    }
    let (f, zeta) = free_decay(DT, &pitch);
    let (f_th, zeta_th) = mode(pitch_inertia(&d), k, c);
    assert!(rel(f, f_th) < 0.02, "pitch {f} Hz vs {f_th} Hz");
    assert!(m::abs(zeta - zeta_th) < 0.02, "damping {zeta} vs {zeta_th}");
}

// --- four-post rig: road input ---------------------------------------------

/// Drive all four contact planes up and down together (a four-post rig)
/// and record the body's height. Returns the measured transmissibility
/// `Z/Y` at each frequency.
fn heave_rig(d: &VehicleDefinition, hz: f64) -> Cx {
    let w = m::TAU * hz;
    let amp = 0.01;
    let mut car = FourWheelVehicle::new(d.clone());
    let settle = 6.0;
    let end = settle + m::ceil(4.0 * hz) / hz;
    let (mut ts, mut road, mut body) = (Vec::new(), Vec::new(), Vec::new());
    let n = m::round(end / DT) as usize;
    for i in 0..n {
        let ti = i as f64 * DT;
        for c in car.contacts.iter_mut() {
            c.point.z = amp * m::sin(w * ti);
            c.surface_velocity.z = amp * w * m::cos(w * ti);
        }
        car.substep(DT, &VehicleInput::default());
        let te = ti + DT;
        if te >= settle {
            ts.push(te);
            road.push(amp * m::sin(w * te));
            body.push(car.pos.z);
        }
    }
    phasor(&ts, &body, w).div(phasor(&ts, &road, w))
}

/// The same rig in pitch: the front pads move by `−a θ_r` and the rear by
/// `+b θ_r`, a road pitch `θ_r` about the point under the centre of mass.
/// Returns the measured `θ/θ_r`.
fn pitch_rig(d: &VehicleDefinition, hz: f64) -> Cx {
    let w = m::TAU * hz;
    let amp = 0.005;
    let a = d.chassis.cg_to_front_axle;
    let b = d.cg_to_rear_axle();
    let mut car = FourWheelVehicle::new(d.clone());
    let settle = 6.0;
    let end = settle + m::ceil(4.0 * hz) / hz;
    let (mut ts, mut road, mut body) = (Vec::new(), Vec::new(), Vec::new());
    let n = m::round(end / DT) as usize;
    for i in 0..n {
        let ti = i as f64 * DT;
        let (th, th_rate) = (amp * m::sin(w * ti), amp * w * m::cos(w * ti));
        for (wheel, arm) in [(FL, -a), (FR, -a), (RL, b), (RR, b)] {
            let c = &mut car.contacts[wheel];
            c.point.z = arm * th;
            c.surface_velocity.z = arm * th_rate;
        }
        car.substep(DT, &VehicleInput::default());
        let te = ti + DT;
        if te >= settle {
            ts.push(te);
            road.push(amp * m::sin(w * te));
            body.push(car.orient.to_yaw_pitch_roll().1);
        }
    }
    phasor(&ts, &body, w).div(phasor(&ts, &road, w))
}

/// Base-excited spring, mass and damper (Gillespie ch. 5):
/// `X/Y = (K_r + iωC) / (K − Mω² + iωC)`, where `K_r` is the stiffness the
/// road acts through and `K` the stiffness the body sees.
fn transmissibility(mass: f64, k_road: f64, k: f64, c: f64, hz: f64) -> Cx {
    let w = m::TAU * hz;
    Cx::new(k_road, w * c).div(Cx::new(k - mass * w * w, w * c))
}

/// Ground motion reaches the body through the ray, spring and damper as
/// the base-excited oscillator says, in gain and phase, from below the
/// heave resonance to well above it. This pins the road-to-load path that
/// carried the circuit's turn bounce.
#[test]
fn four_post_rig_heave_matches_base_excitation() {
    let d = textbook_car();
    let (k, c) = heave_rates(&d);
    for hz in [0.5, 1.0, 1.4, 2.0, 4.0, 8.0] {
        let got = heave_rig(&d, hz);
        let want = transmissibility(d.chassis.mass, k, k, c, hz);
        let dphase = phase_diff(got.arg_deg(), want.arg_deg());
        assert!(
            rel(got.abs(), want.abs()) < 0.02,
            "{hz} Hz: gain {} vs {}",
            got.abs(),
            want.abs()
        );
        assert!(m::abs(dphase) < 2.0, "{hz} Hz: phase off by {dphase}°");
    }
}

/// The pitch rig against the same oscillator: the road acts through the
/// springs alone, `Σ k x²`, while the body also feels the `m g h` of its
/// tilting contacts and carries the wheels' spin inertia.
#[test]
fn four_post_rig_pitch_matches_base_excitation() {
    let d = textbook_car();
    let (k, c) = pitch_rates(&d);
    let mgh = d.chassis.mass * GRAVITY * d.chassis.cg_height;
    for hz in [0.5, 1.0, 1.5, 2.0, 4.0, 8.0] {
        let got = pitch_rig(&d, hz);
        let want = transmissibility(pitch_inertia(&d), k + mgh, k, c, hz);
        let dphase = phase_diff(got.arg_deg(), want.arg_deg());
        assert!(
            rel(got.abs(), want.abs()) < 0.02,
            "{hz} Hz: gain {} vs {}",
            got.abs(),
            want.abs()
        );
        assert!(m::abs(dphase) < 2.0, "{hz} Hz: phase off by {dphase}°");
    }
}

// --- coast-down --------------------------------------------------------------

/// Coasting from 30 m/s, speed follows the closed form of
/// `m_eff dv/dt = −(C_rr m g + ½ ρ C_d A v²)`: a straight line without aero,
/// a tangent with it. `m_eff` adds each wheel's `I/r²`.
#[test]
fn coast_down_follows_the_closed_form() {
    for model in [VehicleModelKind::FourWheel, VehicleModelKind::SingleTrack] {
        for cd in [0.0, 0.32] {
            let mut d = textbook_car();
            d.simulation.model = model;
            d.aero.drag_coefficient = cd;
            let mass = d.chassis.mass;
            let wheels: f64 = d
                .axles
                .iter()
                .map(|a| 2.0 * a.wheel_inertia / m::powi(a.tire.unloaded_radius(), 2))
                .sum();
            let m_eff = mass + wheels;
            let crr = match &d.axles[0].tire {
                TireModel::Feel(p) => p.rolling_resistance,
                TireModel::MagicFormula(_) => unreachable!("the default car runs Feel tires"),
            };
            let a = crr * mass * GRAVITY / m_eff;
            let b = 0.5 * d.aero.air_density * cd * d.aero.frontal_area / m_eff;
            let v0 = 30.0;
            let theory = |time: f64| {
                if b == 0.0 {
                    v0 - a * time
                } else {
                    let s = m::sqrt(a / b);
                    s * m::tan(m::atan(v0 / s) - m::sqrt(a * b) * time)
                }
            };
            let mut w = World::new(1);
            w.add_vehicle(d).unwrap();
            w.vehicle_mut(0).unwrap().model.set_speed(v0);
            for i in 1..=3000 {
                w.step(0.01);
                if i % 100 == 0 {
                    let time = i as f64 * 0.01;
                    let v = w.telemetry_of(0)[t::SPEED];
                    let want = theory(time);
                    assert!(
                        rel(v, want) < 0.005,
                        "{model:?}, Cd {cd}, {time} s: {v} m/s vs {want} m/s"
                    );
                }
            }
        }
    }
}

// --- single-track model: transient and frequency response -------------------

/// Samples of a steering run: time, road-wheel angle, forward speed, yaw
/// rate, lateral acceleration.
type Trace = (Vec<f64>, Vec<f64>, Vec<f64>, Vec<f64>, Vec<f64>);

/// Coast at 80 km/h (no throttle) for `seconds` with the steering input
/// `steer(t)`, recording every substep.
fn steer_run(model: VehicleModelKind, steer: impl Fn(f64) -> f64, seconds: f64) -> Trace {
    let mut d = textbook_car();
    d.simulation.model = model;
    let mut car = VehicleModel::new(d);
    car.set_speed(22.22);
    let mut tr: Trace = (
        vec![0.0],
        vec![car.steer_angle()],
        vec![car.vx()],
        vec![car.yaw_rate()],
        vec![car.lat_accel()],
    );
    let n = m::round(seconds / DT) as usize;
    for i in 1..=n {
        let ti = i as f64 * DT;
        let input = VehicleInput {
            steer: steer(ti),
            ..VehicleInput::default()
        };
        car.substep(DT, &input);
        tr.0.push(ti);
        tr.1.push(car.steer_angle());
        tr.2.push(car.vx());
        tr.3.push(car.yaw_rate());
        tr.4.push(car.lat_accel());
    }
    tr
}

/// The step steer: ramped over 0.1 s from t = 0.5 s (ISO 7401 allows a
/// ramp of up to 0.15 s).
fn step(ti: f64) -> f64 {
    let target = 0.012; // 0.42° at the road wheels, about 1.2 m/s²
    m::clamp((ti - 0.5) / 0.1, 0.0, 1.0) * target
}

/// A step steer follows the linear single-track model (Rajamani ch. 2) with
/// each axle's force lagging by its relaxation length, driven through the
/// same road-wheel angle and speed: yaw rate and lateral acceleration
/// within 2 % of their steady values all along the trace.
#[test]
fn single_track_step_steer_follows_the_linear_model() {
    let d = textbook_car();
    let (ts, delta, speed, yaw, ay) = steer_run(VehicleModelKind::SingleTrack, step, 4.0);
    let theory = single_track_response(&d, &ts, &delta, &speed);
    let (r_ss, ay_ss) = (yaw[yaw.len() - 1], ay[ay.len() - 1]);
    for (i, &(r_th, ay_th)) in theory.iter().enumerate() {
        assert!(
            m::abs(yaw[i] - r_th) < 0.02 * m::abs(r_ss),
            "{} s: yaw rate {} vs {r_th}",
            ts[i],
            yaw[i]
        );
        assert!(
            m::abs(ay[i] - ay_th) < 0.02 * m::abs(ay_ss),
            "{} s: lateral acceleration {} vs {ay_th}",
            ts[i],
            ay[i]
        );
    }
}

/// The four-wheel model at the same small lateral acceleration: yaw rate
/// within 3 % of steady state of the single-track theory. Lateral load
/// transfer costs the more loaded tires a little stiffness, and its
/// `LatAccel` is body-fixed (it carries `g sin φ` from roll), so only yaw
/// rate is compared.
#[test]
fn four_wheel_step_steer_yaw_rate_follows_the_linear_model() {
    let d = textbook_car();
    let (ts, delta, speed, yaw, _) = steer_run(VehicleModelKind::FourWheel, step, 4.0);
    let theory = single_track_response(&d, &ts, &delta, &speed);
    let r_ss = yaw[yaw.len() - 1];
    for (i, &(r_th, _)) in theory.iter().enumerate() {
        assert!(
            m::abs(yaw[i] - r_th) < 0.03 * m::abs(r_ss),
            "{} s: yaw rate {} vs {r_th}",
            ts[i],
            yaw[i]
        );
    }
}

/// Sine steer from 0.2 to 3 Hz (ISO 7401's frequency response): yaw-rate
/// and lateral-acceleration gain and phase per road-wheel angle match the
/// single-track transfer function at the run's mean speed, within 3 % and
/// 3°.
#[test]
fn single_track_frequency_response_matches_the_transfer_function() {
    let d = textbook_car();
    for hz in [0.2, 0.5, 1.0, 2.0, 3.0] {
        let w = m::TAU * hz;
        let settle = m::max(2.0, 3.0 / hz);
        let seconds = settle + m::max(4.0 / hz, 2.0);
        let (ts, delta, speed, yaw, ay) = steer_run(
            VehicleModelKind::SingleTrack,
            |ti| 0.008 * m::sin(w * ti),
            seconds,
        );
        let from = ts.iter().position(|&ti| ti >= settle).unwrap();
        let window = |v: &[f64]| v[from..].to_vec();
        let tw = window(&ts);
        let pd = phasor(&tw, &window(&delta), w);
        let got_r = phasor(&tw, &window(&yaw), w).div(pd);
        let got_ay = phasor(&tw, &window(&ay), w).div(pd);
        let v_mean = speed[from..].iter().sum::<f64>() / (speed.len() - from) as f64;
        let (want_r, want_ay) = single_track_frequency_response(&d, v_mean, w);
        for (name, got, want) in [("yaw rate", got_r, want_r), ("lat accel", got_ay, want_ay)] {
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

// --- steady roll and load transfer ---------------------------------------------

/// On a steady circle, the body rolls `φ = m a_y h / (K_φ − m g h)` (roll
/// centres at the ground, Milliken ch. 18), each axle moves
/// `K_φ,axle φ / t` of load across, and the two transfers balance the
/// overturning moment `m a_y h + m g h φ`.
#[test]
fn steady_roll_and_load_transfer_match_roll_stiffness() {
    let mut d = textbook_car();
    d.axles[0].suspension.anti_roll_stiffness = 15_000.0;
    d.axles[1].suspension.anti_roll_stiffness = 8_000.0;
    let (mass, h) = (d.chassis.mass, d.chassis.cg_height);
    let k_axle = axle_roll_stiffness(&d);
    let k_roll = k_axle[0] + k_axle[1];
    for steer in [0.01, 0.02, 0.03] {
        let mut car = FourWheelVehicle::new(d.clone());
        car.set_speed(20.0);
        let input = VehicleInput {
            steer,
            ..VehicleInput::default()
        };
        let (mut ay, mut roll, mut dfz) = (0.0, 0.0, [0.0; 2]);
        let n = 1000;
        for i in 0..6000 {
            car.substep(DT, &input);
            if i >= 6000 - n {
                ay += car.vel_body().x * car.omega.z;
                roll += car.orient.to_yaw_pitch_roll().2;
                dfz[0] += car.wheels[FL].load - car.wheels[FR].load;
                dfz[1] += car.wheels[RL].load - car.wheels[RR].load;
            }
        }
        let k = 1.0 / n as f64;
        let (ay, roll) = (ay * k, roll * k);
        let dfz = dfz.map(|v| v * k);
        let roll_th = mass * ay * h / (k_roll - mass * GRAVITY * h);
        assert!(
            rel(roll, roll_th) < 0.02,
            "a_y {ay}: roll {roll} vs {roll_th}"
        );
        for axle in 0..2 {
            let want = -2.0 * k_axle[axle] * roll / d.axle_track(axle);
            assert!(
                rel(dfz[axle], want) < 0.02,
                "a_y {ay}, axle {axle}: load difference {} vs {want}",
                dfz[axle]
            );
        }
        let moment: f64 = (0..2).map(|i| 0.5 * dfz[i] * d.axle_track(i)).sum();
        let want = -(mass * ay * h + mass * GRAVITY * h * roll);
        assert!(
            rel(moment, want) < 0.01,
            "a_y {ay}: moment {moment} vs {want}"
        );
    }
}

// --- convergence order -----------------------------------------------------------

/// A run that returns its trace sampled at a given substep rate.
type SampledRun = Box<dyn Fn(f64) -> Vec<f64>>;

/// A trace sampled every 4 ms over 2 s at one substep rate.
fn sampled(rate: f64, mut run: impl FnMut(f64) -> f64) -> Vec<f64> {
    let dt = 1.0 / rate;
    let per_sample = m::round(rate / 250.0) as usize;
    (0..500)
        .map(|_| {
            let mut v = 0.0;
            for _ in 0..per_sample {
                v = run(dt);
            }
            v
        })
        .collect()
}

fn rms_error(a: &[f64], b: &[f64]) -> f64 {
    m::sqrt(a.iter().zip(b).map(|(x, y)| (x - y) * (x - y)).sum::<f64>() / a.len() as f64)
}

/// The chassis is integrated by semi-implicit Euler, a first-order method,
/// so against a 16 kHz reference the error should halve as the substep
/// rate doubles: observed order between 0.85 and 1.15 from 500 Hz to 2 kHz.
#[test]
fn integration_error_falls_at_first_order() {
    let heave = |rate: f64| {
        let mut car = FourWheelVehicle::new(textbook_car());
        car.pos.z -= 0.02;
        sampled(rate, |dt| {
            car.substep(dt, &VehicleInput::default());
            car.pos.z
        })
    };
    let steer = |model: VehicleModelKind| {
        move |rate: f64| {
            let mut d = textbook_car();
            d.simulation.model = model;
            let mut car = VehicleModel::new(d);
            car.set_speed(22.22);
            let mut time = 0.0;
            sampled(rate, |dt| {
                time += dt;
                let input = VehicleInput {
                    steer: step(time),
                    ..VehicleInput::default()
                };
                car.substep(dt, &input);
                car.yaw_rate()
            })
        }
    };
    let cases: [(&str, SampledRun); 3] = [
        ("heave", Box::new(heave)),
        (
            "single-track step",
            Box::new(steer(VehicleModelKind::SingleTrack)),
        ),
        (
            "four-wheel step",
            Box::new(steer(VehicleModelKind::FourWheel)),
        ),
    ];
    let reference_rate = 16_000.0;
    for (name, run) in cases {
        let reference = run(reference_rate);
        let rates = [500.0, 1000.0, 2000.0];
        let errors = rates.map(|r| rms_error(&run(r), &reference));
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
