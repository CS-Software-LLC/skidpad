//! Coast-down (EPA road load): with no aero lift and no drivetrain drag the
//! fitted road load is the closed form `A = Crr·m·g`, `B = 0`,
//! `C = ½·ρ·Cd·A`. Tolerances were set before the first run; the preset
//! comparison with EPA's test cars is in `docs/validation/epa-coast-down.md`.

use skidpad_core::drivetrain::PowerUnitDef;
use skidpad_core::tire::TireModel;
use skidpad_core::validation::coast_down::{self, CoastDownConfig, LBF, MPH};
use skidpad_core::{VehicleDefinition, GRAVITY};
use skidpad_math as m;

fn no_lift() -> VehicleDefinition {
    let mut d = VehicleDefinition::default();
    d.aero.lift_coefficient_front = 0.0;
    d.aero.lift_coefficient_rear = 0.0;
    d
}

fn crr(d: &VehicleDefinition) -> f64 {
    match &d.axles[0].tire {
        TireModel::Feel(t) => t.rolling_resistance,
        TireModel::MagicFormula(_) => unreachable!(),
    }
}

/// `A` within 1 % of `Crr·m·g`, `C` within 1 % of `½ρCdA`, and `B·v` at
/// 80 mph under 1 % of the load there.
#[test]
fn the_fit_is_rolling_resistance_plus_drag() {
    let d = no_lift();
    let r = coast_down::run(&d, &CoastDownConfig::default()).unwrap();
    assert!(r.completed);
    let a = crr(&d) * d.chassis.mass * GRAVITY;
    let c = 0.5 * d.aero.air_density * d.aero.drag_coefficient * d.aero.frontal_area;
    assert!(m::abs(r.a / a - 1.0) < 0.01, "A {} vs {a}", r.a);
    assert!(m::abs(r.c / c - 1.0) < 0.01, "C {} vs {c}", r.c);
    let v = 80.0 * MPH;
    assert!(m::abs(r.b * v) < 0.01 * r.force_at(v), "B {}", r.b);
    assert!(r.fit_spread < 0.01, "{}", r.fit_spread);
    // EPA's units.
    assert!(m::abs(r.a_lbf * LBF - r.a) < 1e-9);
    assert!(m::abs(r.c_lbf_mph2 * LBF / (MPH * MPH) - r.c) < 1e-12);
    let f50 = r.force_at(50.0 / 3.6);
    assert!(m::abs(r.force_50 - f50) < 1e-9);
}

/// Doubling the drag area doubles `C` and leaves `A`; doubling the
/// rolling resistance doubles `A` and leaves `C`. Within 1 %.
#[test]
fn the_terms_follow_their_own_parameters() {
    let base = coast_down::run(&no_lift(), &CoastDownConfig::default()).unwrap();
    let mut d = no_lift();
    d.aero.frontal_area *= 2.0;
    let drag = coast_down::run(&d, &CoastDownConfig::default()).unwrap();
    assert!(m::abs(drag.c / base.c - 2.0) < 0.02, "{}", drag.c / base.c);
    assert!(m::abs(drag.a / base.a - 1.0) < 0.01, "{}", drag.a / base.a);
    let mut d = no_lift();
    for axle in d.axles.iter_mut() {
        if let TireModel::Feel(t) = &mut axle.tire {
            t.rolling_resistance *= 2.0;
        }
    }
    let roll = coast_down::run(&d, &CoastDownConfig::default()).unwrap();
    assert!(m::abs(roll.a / base.a - 2.0) < 0.02, "{}", roll.a / base.a);
    assert!(m::abs(roll.c / base.c - 1.0) < 0.01, "{}", roll.c / base.c);
}

/// An electric car coasts without regeneration, as in an EPA coast-down.
#[test]
fn an_electric_car_coasts_without_regeneration() {
    let mut d = no_lift();
    d.drivetrain.power_unit = PowerUnitDef::Electric(Default::default());
    let base = coast_down::run(&no_lift(), &CoastDownConfig::default()).unwrap();
    let ev = coast_down::run(&d, &CoastDownConfig::default()).unwrap();
    assert!(ev.completed);
    assert!(m::abs(ev.a / base.a - 1.0) < 0.02, "{} vs {}", ev.a, base.a);
}

#[test]
fn rejects_a_backwards_speed_range() {
    let cfg = CoastDownConfig {
        start_speed: 5.0,
        end_speed: 10.0,
        ..Default::default()
    };
    assert!(coast_down::run(&no_lift(), &cfg).is_err());
}
