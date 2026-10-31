//! Load-dependent lateral relaxation length (ADR-0038): the feel tire's
//! `lateralRelaxationFollowsLoad` and the Magic Formula's `PTY1`/`PTY2`.

use skidpad_core::tire::{tir, FeelTireParams, MagicFormulaParams, TireModel};
use skidpad_core::validation::{step_steer, StepSteerConfig};
use skidpad_core::VehicleDefinition;
use skidpad_math as m;

#[test]
fn feel_relaxation_is_fixed_unless_it_follows_the_load() {
    let base = FeelTireParams::default();
    let fixed = TireModel::Feel(base.clone());
    for fz in [0.0, 1000.0, 4000.0, 9000.0] {
        assert_eq!(fixed.relaxation_length_lat(fz), base.relaxation_length_lat);
        let shape = fixed.shape();
        assert_eq!(
            fixed.at_load(&shape, fz).relaxation_length_lat(),
            base.relaxation_length_lat
        );
    }
}

#[test]
fn feel_relaxation_following_the_load_scales_with_the_cornering_stiffness() {
    let p = FeelTireParams {
        lateral_relaxation_follows_load: true,
        ..FeelTireParams::default()
    };
    let tire = TireModel::Feel(p.clone());
    let shape = tire.shape();
    let s0 = p.relaxation_length_lat;
    let at_nominal = tire.relaxation_length_lat(p.nominal_load);
    assert!(m::abs(at_nominal - s0) < 1e-12 * s0, "{at_nominal}");
    let c0 = p.cornering_stiffness(p.nominal_load);
    for fz in [500.0, 2000.0, 6000.0, 12000.0] {
        let s = tire.relaxation_length_lat(fz);
        let want = s0 * p.cornering_stiffness(fz) / c0;
        assert!(m::abs(s - want) < 1e-12 * want, "{fz}: {s} vs {want}");
        // The per-substep path gives the same value.
        assert_eq!(tire.at_load(&shape, fz).relaxation_length_lat(), s);
    }
    // Longer above the nominal load, shorter below, nothing at no load.
    assert!(tire.relaxation_length_lat(2.0 * p.nominal_load) > s0);
    assert!(tire.relaxation_length_lat(0.5 * p.nominal_load) < s0);
    assert_eq!(tire.relaxation_length_lat(0.0), 0.0);
}

#[test]
fn magic_formula_relaxation_uses_pty1_and_pty2_when_both_are_set() {
    let fixed = MagicFormulaParams::default();
    assert_eq!(
        fixed.relaxation_length_lat_at(6000.0),
        fixed.relaxation_length_lat
    );
    let only_one = MagicFormulaParams {
        pty1: 2.0,
        ..MagicFormulaParams::default()
    };
    assert_eq!(
        only_one.relaxation_length_lat_at(6000.0),
        only_one.relaxation_length_lat
    );
    let p = MagicFormulaParams {
        pty1: 2.1439,
        pty2: 1.9829,
        fz0: 4850.0,
        unloaded_radius: 0.344,
        ..MagicFormulaParams::default()
    };
    // σα = PTY1 · sin(2 · atan(Fz / (PTY2 · Fz0))) · R0.
    for fz in [1000.0, 4850.0, 9617.0, 15000.0] {
        let want = 2.1439 * m::sin(2.0 * m::atan(fz / (1.9829 * 4850.0))) * 0.344;
        let got = p.relaxation_length_lat_at(fz);
        assert!(m::abs(got - want) < 1e-12, "{fz}: {got} vs {want}");
    }
    // The peak, PTY1 · R0, at Fz = PTY2 · Fz0.
    let peak = p.relaxation_length_lat_at(1.9829 * 4850.0);
    assert!(m::abs(peak - 2.1439 * 0.344) < 1e-12, "{peak}");
}

#[test]
fn tir_import_reads_pty1_and_pty2() {
    let text = include_str!("../../../tools/chrono-compare/reference/sedan/Sedan_Pac02Tire.tir");
    let imp = tir::import_str(text);
    assert_eq!(imp.params.pty1, 2.1439);
    assert_eq!(imp.params.pty2, 1.9829);
    assert!(imp
        .warnings
        .iter()
        .all(|w| w.key != "PTY1" && w.key != "PTY2"));
}

#[test]
fn validation_rejects_negative_pty() {
    let p = MagicFormulaParams {
        pty1: -1.0,
        pty2: f64::NAN,
        ..MagicFormulaParams::default()
    };
    let mut errs = Vec::new();
    p.validate("axles[0].tire", &mut errs);
    assert!(errs
        .iter()
        .any(|e| e.contains("axles[0].tire.pty1 must be zero or positive")));
    assert!(errs
        .iter()
        .any(|e| e.contains("axles[0].tire.pty2 must be zero or positive")));
}

/// The vehicle steps the transient at the wheel's own load. A car whose
/// relaxation follows the load from a long length quoted at a high nominal
/// load answers a step steer close to a car with the shorter fixed length
/// its mean static wheel load gives, and well apart from one with the
/// quoted length. (Not exactly: the front wheels carry more than the mean,
/// and the outer wheels more again once the car turns.)
#[test]
fn a_car_whose_relaxation_follows_the_load_responds_at_its_wheel_loads() {
    let quoted = 8.0;
    let nominal = 12000.0;
    let car = |follows: bool, sigma: f64| {
        let mut d = VehicleDefinition::default();
        for a in d.axles.iter_mut() {
            if let TireModel::Feel(t) = &mut a.tire {
                t.lateral_relaxation_follows_load = follows;
                t.nominal_load = nominal;
                t.relaxation_length_lat = sigma;
            }
        }
        d
    };
    let cfg = StepSteerConfig {
        host_dt: 1.0 / 1000.0,
        ..StepSteerConfig::default()
    };
    let response = |d: &VehicleDefinition| {
        step_steer::run(d, &cfg)
            .unwrap()
            .yaw_rate_response_time
            .unwrap()
    };
    let follows = car(true, quoted);
    let mean_load = follows.chassis.mass * skidpad_core::GRAVITY / 4.0;
    let at_static = match &follows.axles[0].tire {
        TireModel::Feel(t) => t.relaxation_length_lat_with(t.cornering_stiffness(mean_load)),
        TireModel::MagicFormula(_) => unreachable!(),
    };
    assert!(at_static < 0.8 * quoted, "{at_static}");
    let t_follows = response(&follows);
    let t_static = response(&car(false, at_static));
    let t_quoted = response(&car(false, quoted));
    assert!(
        t_quoted > t_static + 0.005,
        "the quoted length answers later: {t_quoted} s vs {t_static} s"
    );
    assert!(
        m::abs(t_follows - t_static) < 0.5 * (t_quoted - t_static),
        "follows {t_follows} s, fixed at the static load's length {t_static} s, quoted {t_quoted} s"
    );
}
