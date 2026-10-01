//! Feel-tire aligning moment with a trail that crosses zero (ADR-0008,
//! amendment B).

use skidpad_core::tire::{FeelTireParams, MagicFormulaParams, TireInput, TireModel};
use skidpad_math as m;

fn feel() -> FeelTireParams {
    FeelTireParams::default()
}

fn eval(p: &FeelTireParams, fz: f64, kappa: f64, alpha: f64) -> skidpad_core::TireOutput {
    p.eval(&TireInput {
        fz,
        slip_ratio: kappa,
        slip_angle: alpha,
        camber: 0.0,
        vx: 10.0,
    })
}

/// Slip angle (rad) and value at which `f` is largest over `0 … 4 αp`.
fn argmax(p: &FeelTireParams, f: impl Fn(skidpad_core::TireOutput) -> f64) -> (f64, f64) {
    let ap = p.peak_slip_angle();
    let mut best = (0.0, f64::MIN);
    let mut a = 0.0;
    while a <= 4.0 * ap {
        let v = f(eval(p, 4000.0, 0.0, a));
        if v > best.1 {
            best = (a, v);
        }
        a += ap * 1e-3;
    }
    best
}

#[test]
fn small_slip_trail_is_the_configured_trail() {
    for p in [
        feel(),
        FeelTireParams {
            trail_zero_crossing: 1.3,
            trail_reversal: 0.3,
            ..feel()
        },
    ] {
        let model = TireModel::Feel(p.clone());
        for fz in [1000.0, 4000.0, 8000.0] {
            let t = model.static_trail(fz);
            assert!(
                (t - p.pneumatic_trail).abs() < 1e-6 * p.pneumatic_trail,
                "static trail {t} vs t0 {}",
                p.pneumatic_trail
            );
        }
        let o = eval(&p, 4000.0, 0.0, 0.0);
        assert_eq!(o.trail, p.pneumatic_trail);
        assert_eq!(o.mz, 0.0);
    }
}

#[test]
fn trail_crosses_zero_at_the_configured_slip_angle_and_goes_negative() {
    for crossing in [0.8, 1.0, 1.2, 2.0] {
        let p = FeelTireParams {
            trail_zero_crossing: crossing,
            ..feel()
        };
        let a0 = crossing * p.peak_slip_angle();
        let at = eval(&p, 4000.0, 0.0, a0).trail;
        assert!(
            at.abs() < 1e-9,
            "crossing {crossing}: trail {at} at α = {a0}"
        );
        let before = eval(&p, 4000.0, 0.0, 0.98 * a0).trail;
        let after = eval(&p, 4000.0, 0.0, 1.02 * a0).trail;
        assert!(before > 0.0 && after < 0.0, "{before} / {after}");
        // The aligning moment follows the trail: positive before, zero at,
        // negative after the crossing (ISO: positive α, negative Fy).
        assert!(eval(&p, 4000.0, 0.0, 0.98 * a0).mz > 0.0);
        assert!(eval(&p, 4000.0, 0.0, 1.02 * a0).mz < 0.0);
        // And it returns toward zero at large slip.
        let far = eval(&p, 4000.0, 0.0, 6.0 * a0).trail;
        assert!(
            far < 0.0 && far.abs() < 0.05 * p.pneumatic_trail,
            "far trail {far}"
        );
    }
}

#[test]
fn negative_lobe_depth_matches_trail_reversal() {
    for depth in [0.02, 0.1, 0.2, 0.37, 0.5] {
        let p = FeelTireParams {
            trail_reversal: depth,
            ..feel()
        };
        let mut deepest = 0.0f64;
        let mut a = 0.0;
        while a < 1.2 {
            deepest = deepest.min(eval(&p, 4000.0, 0.0, a).trail);
            a += 1e-4;
        }
        let got = -deepest / p.pneumatic_trail;
        assert!(
            (got - depth).abs() < 0.01 * depth,
            "reversal {depth}: deepest trail {got} of t0"
        );
    }
    // The published reference points of the shape factor k [DERIVED]:
    // k = 2 → 0.11, k = 1 → 0.21, k = 0.5 → 0.37 of t0.
    for (k, want) in [(2.0, 0.112), (1.0, 0.207), (0.5, 0.366)] {
        let depth = (m::sqrt(1.0 + 1.0 / k) - 1.0) / 2.0;
        assert!((depth - want).abs() < 2e-3, "k {k}: {depth} vs {want}");
        let back = 1.0 / (4.0 * depth * (1.0 + depth));
        assert!((back - k).abs() < 1e-9);
    }
}

#[test]
fn steering_lightens_before_grip_runs_out() {
    let p = feel();
    let ap = p.peak_slip_angle();
    let (a_fy, _) = argmax(&p, |o| -o.fy);
    let (a_mz, mz_peak) = argmax(&p, |o| o.mz);
    assert!(
        (a_fy - ap).abs() < 0.02 * ap,
        "Fy peaks at {} αp",
        a_fy / ap
    );
    assert!(
        a_mz > 0.3 * ap && a_mz < 0.6 * ap,
        "Mz peaks at {} αp, expected 0.3 … 0.6",
        a_mz / ap
    );
    // Quick numbers from the change request, confirmed here: Mz peaks near
    // 0.41 αp, is zero at αp, and its deepest value is about −18 % of the
    // peak near 1.5 αp.
    assert!(
        (a_mz / ap - 0.41).abs() < 0.03,
        "Mz peak at {} αp",
        a_mz / ap
    );
    assert!(eval(&p, 4000.0, 0.0, ap).mz.abs() < 1e-9 * mz_peak);
    let (a_min, neg) = argmax(&p, |o| -o.mz);
    assert!(
        (neg / mz_peak - 0.18).abs() < 0.03,
        "deepest Mz is {} of the peak",
        -neg / mz_peak
    );
    assert!(
        (a_min / ap - 1.5).abs() < 0.15,
        "deepest Mz at {} αp",
        a_min / ap
    );
    // A later crossing moves the torque peak outward.
    let late = FeelTireParams {
        trail_zero_crossing: 1.2,
        ..feel()
    };
    let (a_late, _) = argmax(&late, |o| o.mz);
    assert!(
        (a_late / ap - 0.47).abs() < 0.03,
        "Mz peak at {} αp",
        a_late / ap
    );
}

#[test]
fn braking_lightens_the_wheel() {
    let p = feel();
    let ap = p.peak_slip_angle();
    for frac in [0.1, 0.2, 0.3] {
        let alpha = frac * ap;
        let free = eval(&p, 4000.0, 0.0, alpha);
        let braked = eval(&p, 4000.0, -0.05, alpha);
        let driven = eval(&p, 4000.0, 0.05, alpha);
        assert!(
            braked.mz.abs() < free.mz.abs(),
            "{frac} αp: |Mz| braked {} vs free {}",
            braked.mz,
            free.mz
        );
        assert!(driven.mz.abs() < free.mz.abs());
        assert!(braked.trail < free.trail && driven.trail < free.trail);
    }
}

#[test]
fn aligning_moment_and_its_slope_are_continuous() {
    let p = feel();
    let ap = p.peak_slip_angle();
    let h = ap * 1e-3;
    for kappa in [0.0, -0.05, 0.1, -0.5] {
        let mut prev = eval(&p, 4000.0, kappa, -4.0 * ap).mz;
        let mut prev_slope = 0.0;
        let mut max_mz: f64 = 0.0;
        let mut a = -4.0 * ap + h;
        let mut first = true;
        while a <= 4.0 * ap {
            let mz = eval(&p, 4000.0, kappa, a).mz;
            assert!(mz.is_finite());
            max_mz = max_mz.max(mz.abs());
            let slope = (mz - prev) / h;
            if !first {
                // No step in the torque and no kink in its slope: both
                // differences scale with the step.
                assert!(
                    (mz - prev).abs() < 0.01 * (max_mz + 1.0),
                    "κ {kappa} α {a}: Mz steps {prev} → {mz}"
                );
                assert!(
                    (slope - prev_slope).abs() * h < 0.005 * (max_mz + 1.0),
                    "κ {kappa} α {a}: slope kinks {prev_slope} → {slope}"
                );
            }
            first = false;
            prev = mz;
            prev_slope = slope;
            a += h;
        }
    }
}

#[test]
fn fx_moment_arm_has_the_magic_formula_sign() {
    let kappa = 0.08;
    let alpha = m::deg_to_rad(3.0);
    let input = TireInput {
        fz: 4000.0,
        slip_ratio: kappa,
        slip_angle: alpha,
        camber: 0.0,
        vx: 10.0,
    };
    let mf0 = MagicFormulaParams::default().eval(&input);
    let mf = MagicFormulaParams {
        ssz2: 0.2,
        ..MagicFormulaParams::default()
    }
    .eval(&input);
    let d_mf = mf.mz - mf0.mz;
    assert!(d_mf != 0.0);
    let feel0 = feel().eval(&input);
    let with_arm = FeelTireParams {
        fx_moment_arm: 0.05,
        ..feel()
    }
    .eval(&input);
    let d_feel = with_arm.mz - feel0.mz;
    assert!(
        d_feel * d_mf > 0.0,
        "feel ΔMz {d_feel} should have the sign of MF ΔMz {d_mf}"
    );
    // Drive (Fx > 0) with positive slip angle (Fy < 0) and a positive arm
    // reduces the restoring moment.
    assert!(with_arm.fx > 0.0 && with_arm.fy < 0.0 && d_feel < 0.0);
    assert_eq!(with_arm.fx, feel0.fx);
    assert_eq!(with_arm.fy, feel0.fy);
}

#[test]
fn trail_parameters_are_validated() {
    let mut errs = Vec::new();
    FeelTireParams {
        trail_zero_crossing: 0.0,
        trail_reversal: 0.8,
        fx_moment_arm: 3.0,
        ..feel()
    }
    .validate("t", &mut errs);
    assert!(errs.iter().any(|e| e.contains("trailZeroCrossing")));
    assert!(errs.iter().any(|e| e.contains("trailReversal")));
    assert!(errs.iter().any(|e| e.contains("fxMomentArm")));
    let mut ok = Vec::new();
    feel().validate("t", &mut ok);
    assert!(ok.is_empty());
}
