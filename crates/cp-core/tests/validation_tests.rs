use cp_core::tire::{FeelTireParams, TireModel};
use cp_core::validation::{straight_line, understeer, StraightLineConfig, UndersteerConfig};
use cp_core::VehicleDefinition;

fn with_front_rear_stiffness(front: f64, rear: f64) -> VehicleDefinition {
    let mut d = VehicleDefinition::default();
    let f = FeelTireParams {
        cornering_stiffness: front,
        ..FeelTireParams::default()
    };
    let r = FeelTireParams {
        cornering_stiffness: rear,
        ..FeelTireParams::default()
    };
    d.axles[0].tire = TireModel::Feel(f);
    d.axles[1].tire = TireModel::Feel(r);
    d
}

#[test]
fn understeer_gradient_matches_linear_theory_for_the_default_car() {
    let d = VehicleDefinition::default();
    let r = understeer::run(&d, &UndersteerConfig::default()).unwrap();
    // The default car is nose heavy, so it understeers.
    assert!(r.gradient > 0.0, "gradient {} rad/(m/s^2)", r.gradient);
    assert!(
        (r.fitted_intercept - r.ackermann_angle).abs() < 0.15 * r.ackermann_angle,
        "intercept {} vs Ackermann {}",
        r.fitted_intercept,
        r.ackermann_angle
    );
    // The analytic value is the low-lateral-acceleration limit; the fit spans
    // up to ~3.6 m/s² where the tires are mildly nonlinear, so compare with an
    // absolute tolerance in deg/g.
    let diff = (r.gradient_deg_per_g - r.analytic_gradient_deg_per_g).abs();
    assert!(
        diff < 0.15,
        "simulated {} deg/g vs analytic {} deg/g (diff {diff})",
        r.gradient_deg_per_g,
        r.analytic_gradient_deg_per_g
    );
    // Each point actually held the circle.
    for p in &r.points {
        assert!(
            (p.speed - p.target_speed).abs() < 0.3,
            "speed {} vs {}",
            p.speed,
            p.target_speed
        );
        let radius = p.speed / p.yaw_rate;
        assert!((radius - 40.0).abs() < 1.0, "radius {radius}");
    }
}

#[test]
fn stiffer_front_tires_reduce_understeer_and_stiffer_rear_tires_increase_it() {
    let base =
        understeer::run(&VehicleDefinition::default(), &UndersteerConfig::default()).unwrap();
    let front = understeer::run(
        &with_front_rear_stiffness(24.0, 18.0),
        &UndersteerConfig::default(),
    )
    .unwrap();
    let rear = understeer::run(
        &with_front_rear_stiffness(18.0, 24.0),
        &UndersteerConfig::default(),
    )
    .unwrap();
    assert!(
        front.gradient < base.gradient,
        "front {} < base {}",
        front.gradient,
        base.gradient
    );
    assert!(
        rear.gradient > base.gradient,
        "rear {} > base {}",
        rear.gradient,
        base.gradient
    );
    assert!(front.analytic_gradient < base.analytic_gradient);
    assert!(rear.analytic_gradient > base.analytic_gradient);
}

#[test]
fn straight_line_figures_are_plausible_for_the_default_car() {
    let r = straight_line::run(
        &VehicleDefinition::default(),
        &StraightLineConfig::default(),
    )
    .unwrap();
    let t = r.accel_time.expect("should reach 100 km/h");
    assert!((4.0..15.0).contains(&t), "0-100 km/h in {t} s");
    assert!(r.quarter_mile_time.is_some());
    // 100-0 km/h on ~1.0 mu asphalt: roughly 36-50 m.
    assert!(
        (30.0..60.0).contains(&r.braking_distance),
        "braking distance {}",
        r.braking_distance
    );
    assert!(
        r.mean_deceleration > 7.0 && r.mean_deceleration < 11.0,
        "decel {}",
        r.mean_deceleration
    );
}
