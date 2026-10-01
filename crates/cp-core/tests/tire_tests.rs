use cp_core::tire::{tir, FeelTireParams, MagicFormulaParams, TireInput, TireModel};
use cp_math as m;

const TIR: &str = include_str!("fixtures/synthetic_passenger.tir");

fn models() -> Vec<(&'static str, TireModel)> {
    let mf = tir::import_str(TIR);
    assert!(
        mf.warnings.iter().all(|w| !w.message.contains("must")),
        "fixture should validate: {:?}",
        mf.warnings
    );
    vec![
        ("feel", TireModel::Feel(FeelTireParams::default())),
        (
            "mf-default",
            TireModel::MagicFormula(MagicFormulaParams::default()),
        ),
        ("mf-tir", TireModel::MagicFormula(mf.params)),
    ]
}

fn eval(model: &TireModel, fz: f64, kappa: f64, alpha: f64) -> cp_core::TireOutput {
    model.eval(&TireInput {
        fz,
        slip_ratio: kappa,
        slip_angle: alpha,
        camber: 0.0,
        vx: 10.0,
    })
}

#[test]
fn lateral_curve_has_a_peak_near_the_quoted_slip_angle() {
    for (name, model) in models() {
        let fz = 4000.0;
        let mut best = (0.0, 0.0);
        let mut a = 0.0;
        while a < m::deg_to_rad(30.0) {
            let fy = -eval(&model, fz, 0.0, a).fy;
            if fy > best.1 {
                best = (a, fy);
            }
            a += m::deg_to_rad(0.05);
        }
        let peak_deg = m::rad_to_deg(best.0);
        assert!(
            (4.0..12.0).contains(&peak_deg),
            "{name}: lateral peak at {peak_deg} deg"
        );
        let mu = best.1 / fz;
        assert!((0.85..1.2).contains(&mu), "{name}: peak lateral mu {mu}");
    }
}

#[test]
fn longitudinal_curve_has_a_peak_near_the_quoted_slip_ratio() {
    for (name, model) in models() {
        let fz = 4000.0;
        let mut best = (0.0, 0.0);
        let mut k = 0.0;
        while k < 1.0 {
            let fx = eval(&model, fz, k, 0.0).fx;
            if fx > best.1 {
                best = (k, fx);
            }
            k += 0.001;
        }
        assert!(
            (0.06..0.25).contains(&best.0),
            "{name}: longitudinal peak at {}",
            best.0
        );
        let mu = best.1 / fz;
        assert!(
            (0.85..1.25).contains(&mu),
            "{name}: peak longitudinal mu {mu}"
        );
    }
}

#[test]
fn curves_are_odd_symmetric_at_zero_camber() {
    for (name, model) in models() {
        let fz = 3500.0;
        for i in 1..40 {
            let a = i as f64 * 0.01;
            let k = i as f64 * 0.01;
            let p = eval(&model, fz, k, a);
            let n = eval(&model, fz, -k, -a);
            assert!((p.fx + n.fx).abs() < 1e-6 * fz, "{name}: fx not odd at {k}");
            assert!((p.fy + n.fy).abs() < 1e-6 * fz, "{name}: fy not odd at {a}");
            assert!((p.mz + n.mz).abs() < 1e-6 * fz, "{name}: mz not odd at {a}");
        }
    }
}

#[test]
fn iso_sign_convention_positive_slip_angle_gives_negative_fy_and_positive_mz() {
    for (name, model) in models() {
        let o = eval(&model, 4000.0, 0.0, m::deg_to_rad(2.0));
        assert!(o.fy < 0.0, "{name}: fy = {}", o.fy);
        assert!(o.mz > 0.0, "{name}: mz = {}", o.mz);
        assert!(o.trail > 0.0, "{name}: trail = {}", o.trail);
        let o = eval(&model, 4000.0, 0.05, 0.0);
        assert!(o.fx > 0.0, "{name}: fx = {}", o.fx);
    }
}

#[test]
fn combined_slip_reduces_lateral_force_and_respects_the_friction_circle() {
    for (name, model) in models() {
        let fz = 4000.0;
        let pure = -eval(&model, fz, 0.0, m::deg_to_rad(5.0)).fy;
        let combined = eval(&model, fz, 0.10, m::deg_to_rad(5.0));
        assert!(
            -combined.fy < pure,
            "{name}: braking in a corner must reduce fy"
        );
        let resultant = m::hypot(combined.fx, combined.fy);
        // The MF combined weighting functions can overshoot a pure circle by a
        // few percent; that is a property of the published model.
        let limit = 1.1 * m::max(combined.fx_max, combined.fy_max);
        assert!(
            resultant <= limit,
            "{name}: resultant {resultant} exceeds friction circle {limit}"
        );
        // Sweep the whole plane.
        for i in -20..=20 {
            for j in -20..=20 {
                let k = i as f64 * 0.05;
                let a = j as f64 * m::deg_to_rad(1.0);
                let o = eval(&model, fz, k, a);
                let r = m::hypot(o.fx, o.fy);
                assert!(
                    r <= 1.1 * m::max(o.fx_max, o.fy_max) + 1.0,
                    "{name}: ({k},{a}) r={r}"
                );
                assert!(o.fx.is_finite() && o.fy.is_finite() && o.mz.is_finite());
            }
        }
    }
}

#[test]
fn load_sensitivity_lowers_friction_coefficient_with_load() {
    for (name, model) in models() {
        let mu_low = eval(&model, 2000.0, 0.0, m::deg_to_rad(7.0)).fy_max / 2000.0;
        let mu_high = eval(&model, 8000.0, 0.0, m::deg_to_rad(7.0)).fy_max / 8000.0;
        assert!(
            mu_high < mu_low,
            "{name}: mu should fall with load ({mu_low} -> {mu_high})"
        );
        // But the absolute force still rises.
        let f_low = -eval(&model, 2000.0, 0.0, m::deg_to_rad(7.0)).fy;
        let f_high = -eval(&model, 8000.0, 0.0, m::deg_to_rad(7.0)).fy;
        assert!(f_high > f_low, "{name}");
    }
}

#[test]
fn stiffness_per_unit_load_falls_at_high_load() {
    for (name, model) in models() {
        let k1 = model.cornering_stiffness(2000.0) / 2000.0;
        let k2 = model.cornering_stiffness(8000.0) / 8000.0;
        assert!(
            k2 < k1,
            "{name}: normalised cornering stiffness should fall with load"
        );
        let slope = -eval(&model, 4000.0, 0.0, 1e-4).fy / 1e-4;
        let k = model.cornering_stiffness(4000.0);
        assert!(
            (slope - k).abs() / k < 0.02,
            "{name}: slope {slope} vs K {k}"
        );
    }
}

#[test]
fn zero_or_negative_load_gives_zero_output() {
    for (_, model) in models() {
        let o = eval(&model, 0.0, 0.2, 0.3);
        assert_eq!(o.fx, 0.0);
        assert_eq!(o.fy, 0.0);
        let o = eval(&model, -100.0, 0.2, 0.3);
        assert_eq!(o.fx, 0.0);
    }
}

#[test]
fn camber_produces_lateral_force_at_zero_slip() {
    let model = TireModel::Feel(FeelTireParams::default());
    let o = model.eval(&TireInput {
        fz: 4000.0,
        slip_ratio: 0.0,
        slip_angle: 0.0,
        camber: 0.05,
        vx: 10.0,
    });
    assert!(
        o.fy > 0.0,
        "positive camber should push toward +y: {}",
        o.fy
    );
}

#[test]
fn tir_import_reads_coefficients_and_warns_on_ignored_keys() {
    let imp = tir::import_str(TIR);
    assert_eq!(imp.params.fz0, 4500.0);
    assert_eq!(imp.params.unloaded_radius, 0.316);
    assert_eq!(imp.params.pky1, -19.0);
    assert_eq!(imp.params.qbz9, 10.0);
    let ignored: Vec<&str> = imp.warnings.iter().map(|w| w.key.as_str()).collect();
    assert!(ignored.contains(&"PTX1"));
    assert!(ignored.contains(&"WIDTH"));
    assert!(imp.warnings.iter().any(|w| w.section == "MDI_HEADER"));
}

#[test]
fn feel_validation_reports_readable_messages() {
    let p = FeelTireParams {
        peak_friction: 0.0,
        falloff_lat: 1.5,
        ..FeelTireParams::default()
    };
    let mut errs = Vec::new();
    p.validate("axles[0].tire", &mut errs);
    assert!(errs
        .iter()
        .any(|e| e.contains("axles[0].tire.peakFriction must be a positive number")));
    assert!(errs
        .iter()
        .any(|e| e.contains("falloffLat must be in (0, 1]")));
}

#[test]
fn tire_model_serialises_as_tagged_json() {
    let model = TireModel::Feel(FeelTireParams::default());
    let json = serde_json::to_string(&model).unwrap();
    assert!(json.contains("\"model\":\"feel\""));
    let back: TireModel = serde_json::from_str(&json).unwrap();
    assert_eq!(back, model);
    let mf: TireModel = serde_json::from_str("{\"model\":\"magicFormula\",\"pky1\":-25}").unwrap();
    match mf {
        TireModel::MagicFormula(p) => assert_eq!(p.pky1, -25.0),
        _ => panic!("wrong variant"),
    }
}
