//! Parking twist (ADR-0039): a steered wheel turned on the spot winds its
//! contact patch up like a torsional spring until the moment slides the
//! whole patch, `⅔·μ·Fz·a` for a round patch under uniform pressure, and
//! rolling unwinds it. The exact-answer tests check the spring rate and the
//! slide limit against those closed forms; the rest check that the option
//! is off by default, changes nothing above walking pace, and restores
//! from a snapshot bit for bit. Tolerances were set before the first run.

use skidpad_core::snapshot::{SnapshotError, Snapshottable};
use skidpad_core::tire::TireModel;
use skidpad_core::validation::weave::{self, WeaveConfig};
use skidpad_core::vehicle::four_wheel::patch_twist_step;
use skidpad_core::vehicle::{FourWheelVehicle, FL, FR, RL};
use skidpad_core::{VehicleDefinition, VehicleInput};
use skidpad_math as m;

/// Substep, s (the default 1 kHz).
const DT: f64 = 0.001;
/// Contact-patch radius, m, and torsional stiffness per kN, N·m/rad.
const A: f64 = 0.08;
const K_PER_KN: f64 = 1000.0;

fn with_twist(mut d: VehicleDefinition, a: f64, k: f64) -> VehicleDefinition {
    for axle in d.axles.iter_mut() {
        match &mut axle.tire {
            TireModel::Feel(p) => {
                p.contact_radius = a;
                p.torsional_stiffness = k;
            }
            TireModel::MagicFormula(p) => {
                p.contact_radius = a;
                p.torsional_stiffness = k;
            }
        }
    }
    d
}

fn twisted() -> VehicleDefinition {
    with_twist(VehicleDefinition::default(), A, K_PER_KN)
}

/// Let the parked car settle on its springs with the wheel straight.
fn settle(car: &mut FourWheelVehicle) {
    for _ in 0..1500 {
        car.substep(DT, &VehicleInput::default());
    }
}

/// Turn the steering input linearly from `from` to `to` over `secs`.
fn ramp(car: &mut FourWheelVehicle, from: f64, to: f64, secs: f64) {
    let n = (secs / DT).round() as usize;
    for k in 1..=n {
        let steer = from + (to - from) * k as f64 / n as f64;
        car.substep(
            DT,
            &VehicleInput {
                steer,
                ..Default::default()
            },
        );
    }
}

fn hold(car: &mut FourWheelVehicle, steer: f64, secs: f64) {
    ramp(car, steer, steer, secs);
}

// --- the step on its own ---------------------------------------------------

/// Parked, the twist follows the wheel's turn exactly and the moment is the
/// spring's; past `⅔·μ·Fz·a` the patch slips and the twist stays there;
/// rolling unwinds it as `1 / (1 + |vx|·dt / 2a)` per step.
#[test]
fn the_step_is_a_spring_then_a_slide_and_rolling_unwinds_it() {
    let (k, fy_max) = (4000.0, 4000.0);
    let limit = 2.0 / 3.0 * fy_max * A;
    // Elastic: the twist is the turn, the moment −k·twist.
    let (tw, mz) = patch_twist_step(0.0, 0.01, 0.0, DT, A, k, fy_max);
    assert_eq!(tw, 0.01);
    assert_eq!(mz, -k * 0.01);
    // Sliding either way: the moment sits at the limit.
    let (tw, mz) = patch_twist_step(0.0, 0.2, 0.0, DT, A, k, fy_max);
    assert!(rel(mz, -limit) < 1e-12, "{mz} vs {limit}");
    assert!(rel(tw, limit / k) < 1e-12);
    let (_, mz) = patch_twist_step(-0.05, -0.2, 0.0, DT, A, k, fy_max);
    assert!(rel(mz, limit) < 1e-12);
    // Turning back from the limit unloads elastically at once.
    let (tw2, _) = patch_twist_step(tw, -0.001, 0.0, DT, A, k, fy_max);
    assert!(m::abs(tw2 - (tw - 0.001)) < 1e-15);
    // Rolling a distance d unwinds it by (1 + dt·v / 2a)^(−steps); over
    // one patch length 2a in fine steps that is close to e^(−1).
    let v = 1.0;
    let steps = (2.0 * A / (v * DT)).round() as usize;
    let mut tw = 0.01;
    for _ in 0..steps {
        tw = patch_twist_step(tw, 0.0, v, DT, A, k, fy_max).0;
    }
    let expect = 0.01 * m::pow(1.0 + v * DT / (2.0 * A), -(steps as f64));
    assert!(rel(tw, expect) < 1e-12);
    assert!(rel(tw, 0.01 * m::exp(-1.0)) < 0.01);
}

// --- the parked car --------------------------------------------------------

/// A small turn at standstill loads each front patch as the spring:
/// moment = −k·Fz·Δδ with k per kN times the wheel's own load, within 2 %
/// (the body yaws a little against it). The rear wheels do not twist.
#[test]
fn a_small_turn_parked_winds_each_patch_as_a_spring() {
    let mut car = FourWheelVehicle::new(twisted());
    settle(&mut car);
    let start = [car.wheels[FL].steer, car.wheels[FR].steer];
    // 0.004 of the input is about 0.15° at the road wheels, well inside the
    // slide limit.
    ramp(&mut car, 0.0, 0.004, 0.5);
    hold(&mut car, 0.004, 0.2);
    for (i, &s0) in [FL, FR].iter().zip(&start) {
        let w = &car.wheels[*i];
        let turn = w.steer - s0;
        assert!(m::abs(turn) > 1e-4, "the wheel turned {turn}");
        let k = K_PER_KN * 1e-3 * w.load;
        let expect = -k * turn;
        assert!(
            rel(w.twist_moment, expect) < 0.02,
            "wheel {i}: {} vs {expect}",
            w.twist_moment
        );
        assert!(m::abs(w.twist_moment) < 2.0 / 3.0 * w.out.fy_max * A);
    }
    assert_eq!(car.wheels[RL].twist_moment, 0.0);
    assert_eq!(car.wheels[RL].patch_twist, 0.0);
}

/// A big turn at standstill slides both front patches: the moment is the
/// textbook `⅔·μ·Fz·a` within 0.1 %, against the turn, and the hand wheel
/// feels it.
#[test]
fn a_big_turn_parked_slides_at_the_textbook_moment() {
    let mut off = FourWheelVehicle::new(VehicleDefinition::default());
    let mut car = FourWheelVehicle::new(twisted());
    settle(&mut off);
    settle(&mut car);
    ramp(&mut off, 0.0, 0.3, 1.0);
    ramp(&mut car, 0.0, 0.3, 1.0);
    for i in [FL, FR] {
        let w = &car.wheels[i];
        let limit = 2.0 / 3.0 * w.out.fy_max * A;
        // A positive input steers right, a negative road-wheel angle, so
        // the patch pushes back about +z.
        assert!(w.twist_moment > 0.0, "wheel {i}: {}", w.twist_moment);
        assert!(
            rel(w.twist_moment, limit) < 1e-3,
            "wheel {i}: {} vs {limit}",
            w.twist_moment
        );
    }
    // The hand wheel resists the turn, far more than the kingpin return
    // alone.
    assert!(car.steering_torque < 0.0, "{}", car.steering_torque);
    assert!(
        m::abs(car.steering_torque) > 5.0 * m::abs(off.steering_torque),
        "{} vs {}",
        car.steering_torque,
        off.steering_torque
    );
    // Held there, the parked car stays put: no yaw creeping in.
    hold(&mut car, 0.3, 3.0);
    assert!(m::abs(car.omega.z) < 1e-3, "{}", car.omega.z);
    assert!(car.vel.length() < 1e-2, "{}", car.vel.length());
}

/// Turning back from the slide unloads each patch elastically at once:
/// the moment drops by the spring rate times the wheel's turn, within 2 %.
#[test]
fn turning_back_unloads_the_patch_as_a_spring() {
    let mut car = FourWheelVehicle::new(twisted());
    settle(&mut car);
    ramp(&mut car, 0.0, 0.3, 1.0);
    let (wound, steer) = (car.wheels[FL].twist_moment, car.wheels[FL].steer);
    ramp(&mut car, 0.3, 0.29, 0.1);
    let w = &car.wheels[FL];
    let k = K_PER_KN * 1e-3 * w.load;
    let expect = -k * (w.steer - steer);
    let drop = w.twist_moment - wound;
    assert!(
        expect < 0.0 && rel(drop, expect) < 0.02,
        "{drop} vs {expect}"
    );
}

// --- the option off and at speed -------------------------------------------

/// Off by default; with it on, nothing changes above the low-speed fade:
/// a run at 15 m/s with a sine steer is bit for bit the same.
#[test]
fn nothing_changes_above_walking_pace() {
    assert!(!VehicleDefinition::default().has_patch_twist());
    assert!(twisted().has_patch_twist());
    let mut off = FourWheelVehicle::new(VehicleDefinition::default());
    let mut on = FourWheelVehicle::new(twisted());
    off.set_speed(15.0);
    on.set_speed(15.0);
    for k in 0..4000 {
        let t = k as f64 * DT;
        let input = VehicleInput {
            steer: 0.1 * m::sin(m::TAU * 0.5 * t),
            throttle: 0.3,
            ..Default::default()
        };
        off.substep(DT, &input);
        on.substep(DT, &input);
    }
    assert_eq!(off.pos, on.pos);
    assert_eq!(off.omega, on.omega);
    assert_eq!(off.steering_torque, on.steering_torque);
    assert_eq!(on.wheels[FL].twist_moment, 0.0);
}

/// The on-centre weave at 100 km/h gives exactly the same steering-feel
/// numbers with the option on.
#[test]
fn the_weave_is_unchanged() {
    let cfg = WeaveConfig::default();
    let off = weave::run(&VehicleDefinition::default(), &cfg).unwrap();
    let on = weave::run(&twisted(), &cfg).unwrap();
    assert_eq!(off, on);
}

/// An unsteered axle never twists, so a car with the settings only on its
/// rear tires has the option off.
#[test]
fn only_steered_axles_count() {
    let mut d = VehicleDefinition::default();
    if let TireModel::Feel(p) = &mut d.axles[1].tire {
        p.contact_radius = A;
        p.torsional_stiffness = K_PER_KN;
    }
    assert!(!d.has_patch_twist());
}

// --- snapshot and validation -------------------------------------------------

/// The snapshot grows by the twist state only when the option is on, and
/// restoring mid-turn continues bit for bit.
#[test]
fn snapshot_carries_the_twist_and_restores_exactly() {
    let off = FourWheelVehicle::new(VehicleDefinition::default());
    let mut a = FourWheelVehicle::new(twisted());
    assert_eq!(a.state_len(), off.state_len() + 9);
    settle(&mut a);
    ramp(&mut a, 0.0, 0.15, 0.4);
    let mut scratch = vec![0.0; 256];
    let mut buf = vec![0u8; a.snapshot_len()];
    a.snapshot_into(&mut buf, &mut scratch);
    let mut b = FourWheelVehicle::new(twisted());
    b.restore_from(&buf, &mut scratch).unwrap();
    assert_eq!(a.state_hash(&mut scratch), b.state_hash(&mut scratch));
    ramp(&mut a, 0.15, 0.3, 0.4);
    ramp(&mut b, 0.15, 0.3, 0.4);
    assert_eq!(a.state_hash(&mut scratch), b.state_hash(&mut scratch));
    assert_eq!(a.wheels[FR].patch_twist, b.wheels[FR].patch_twist);
    assert_ne!(a.wheels[FR].patch_twist, 0.0);

    let mut small = vec![0u8; off.snapshot_len()];
    off.snapshot_into(&mut small, &mut scratch);
    assert!(matches!(
        b.restore_from(&small, &mut scratch),
        Err(SnapshotError::WrongLength { .. })
    ));
}

/// A reset does not count the wheel's first angle as a turn: placing a car
/// with the wheel already turned leaves the patches relaxed.
#[test]
fn a_reset_with_the_wheel_turned_starts_relaxed() {
    let mut car = FourWheelVehicle::new(twisted());
    car.reset(0.0, 0.0, 0.0);
    hold(&mut car, 0.5, 0.05);
    assert!(
        m::abs(car.wheels[FL].twist_moment) < 1.0,
        "{}",
        car.wheels[FL].twist_moment
    );
}

#[test]
fn validation_rejects_negative_or_huge_settings() {
    assert!(twisted().validate().is_ok());
    let e = with_twist(VehicleDefinition::default(), -0.1, K_PER_KN)
        .validate()
        .unwrap_err()
        .join("\n");
    assert!(e.contains("contactRadius"), "{e}");
    let e = with_twist(VehicleDefinition::default(), 0.6, K_PER_KN)
        .validate()
        .unwrap_err()
        .join("\n");
    assert!(e.contains("contactRadius"), "{e}");
    let e = with_twist(VehicleDefinition::default(), A, f64::NAN)
        .validate()
        .unwrap_err()
        .join("\n");
    assert!(e.contains("torsionalStiffness"), "{e}");
}

fn rel(a: f64, b: f64) -> f64 {
    m::abs(a / b - 1.0)
}
