//! Theoretical-slip combined slip of the feel tire (ADR-0008, change A).

use skidpad_core::curve::MagicCurve;
use skidpad_core::tire::feel::THEORETICAL_SLIP_MIN_DENOM;
use skidpad_core::tire::{FeelTireParams, TireInput, TireModel};
use skidpad_math as m;

fn feel() -> FeelTireParams {
    FeelTireParams::default()
}

fn eval(p: &FeelTireParams, fz: f64, kappa: f64, alpha: f64, vx: f64) -> skidpad_core::TireOutput {
    p.eval(&TireInput {
        fz,
        slip_ratio: kappa,
        slip_angle: alpha,
        camber: 0.0,
        vx,
        ..TireInput::default()
    })
}

/// The pure-slip curves exactly as the pre-change feel model produced them:
/// `Fx = cx(κ)` and `Fy = −cy(α)` with the same curve construction.
fn reference_curves(p: &FeelTireParams, fz: f64) -> (MagicCurve, MagicCurve) {
    let peak = p.friction_at_load(fz) * fz;
    let cx = MagicCurve::from_feel(
        peak,
        p.longitudinal_stiffness(fz),
        p.peak_slip_ratio,
        p.falloff_long,
    );
    let cy = MagicCurve::from_feel(
        peak,
        p.cornering_stiffness(fz),
        p.peak_slip_angle(),
        p.falloff_lat,
    );
    (cx, cy)
}

fn rel_close(a: f64, b: f64, tol: f64) -> bool {
    (a - b).abs() <= tol * a.abs().max(b.abs()).max(1e-12)
}

#[test]
fn pure_slip_is_unchanged_by_the_combined_slip_method() {
    for p in [
        feel(),
        FeelTireParams {
            peak_slip_ratio: 0.08,
            peak_slip_angle_deg: 10.0,
            falloff_long: 0.6,
            ..feel()
        },
        FeelTireParams {
            peak_slip_ratio: 0.2,
            peak_slip_angle_deg: 5.0,
            longitudinal_stiffness: 35.0,
            ..feel()
        },
    ] {
        for fz in [1500.0, 4000.0, 7000.0] {
            let (cx, cy) = reference_curves(&p, fz);
            for i in -200..=200 {
                let kappa = i as f64 * 0.005; // −1 … 1
                let fx = eval(&p, fz, kappa, 0.0, 10.0).fx;
                assert!(
                    rel_close(fx, cx.eval(kappa), 1e-9),
                    "fx({kappa}) = {fx} vs reference {}",
                    cx.eval(kappa)
                );
                let alpha = i as f64 * m::deg_to_rad(0.2); // ±40°
                let fy = eval(&p, fz, 0.0, alpha, 10.0).fy;
                assert!(
                    rel_close(fy, -cy.eval(alpha), 1e-9),
                    "fy({alpha}) = {fy} vs reference {}",
                    -cy.eval(alpha)
                );
            }
        }
    }
}

#[test]
fn pure_slip_is_unchanged_in_reverse_too() {
    let p = feel();
    let (cx, cy) = reference_curves(&p, 4000.0);
    for i in -100..=100 {
        let kappa = i as f64 * 0.01;
        let fx = eval(&p, 4000.0, kappa, 0.0, -10.0).fx;
        assert!(rel_close(fx, cx.eval(kappa), 1e-9), "fx({kappa}) = {fx}");
        let alpha = i as f64 * m::deg_to_rad(0.3);
        let fy = eval(&p, 4000.0, 0.0, alpha, -10.0).fy;
        assert!(rel_close(fy, -cy.eval(alpha), 1e-9), "fy({alpha}) = {fy}");
    }
}

#[test]
fn braked_tire_reaches_its_lateral_peak_at_a_smaller_slip_angle() {
    // The brush model's `1 + κ` denominator inflates the lateral theoretical
    // slip under braking (Pacejka ch. 3), so at the same slip angle a braked
    // tire is further along its lateral curve than a driven one: it carries
    // slightly more lateral force below the peak, and its lateral peak sits
    // at a smaller slip angle, i.e. it saturates laterally sooner. The
    // spec's acceptance criterion (|Fy| smaller under braking at 0.7 αp) is
    // the opposite of what the cited model does; ADR-0008 records this.
    let p = feel();
    let ap = p.peak_slip_angle();
    let peak_alpha = |kappa: f64| {
        let mut best = (0.0, 0.0);
        let mut a = 0.0;
        while a < 0.6 {
            let fy = -eval(&p, 4000.0, kappa, a, 10.0).fy;
            if fy > best.1 {
                best = (a, fy);
            }
            a += 1e-4;
        }
        best
    };
    let (a_brake, f_brake) = peak_alpha(-0.05);
    let (a_drive, f_drive) = peak_alpha(0.05);
    let (a_pure, f_pure) = peak_alpha(0.0);
    assert!(
        (a_pure - ap).abs() < 0.02 * ap,
        "pure peak at {} vs αp {ap}",
        a_pure
    );
    assert!(
        a_brake < a_drive,
        "lateral peak: braking at {a_brake} should come before driving at {a_drive}"
    );
    assert!(a_brake > ap && a_drive > ap);
    assert!(f_brake < f_pure && f_drive < f_pure);
    // Below the peak the braked tire carries slightly more lateral force,
    // the driven one slightly less; both are within a few percent of each
    // other, the size of the 1 ± κ factor.
    for frac in [0.2, 0.5, 0.7] {
        let alpha = frac * ap;
        let braking = eval(&p, 4000.0, -0.05, alpha, 10.0).fy.abs();
        let driving = eval(&p, 4000.0, 0.05, alpha, 10.0).fy.abs();
        let pure = eval(&p, 4000.0, 0.0, alpha, 10.0).fy.abs();
        assert!(
            braking > driving,
            "{frac} αp: braking {braking} vs driving {driving}"
        );
        assert!(braking < pure && driving < pure);
        assert!((braking - driving) / pure < 0.15);
    }
}

#[test]
fn resultant_never_exceeds_the_peak_at_that_load() {
    for p in [
        feel(),
        FeelTireParams {
            peak_slip_ratio: 0.08,
            peak_slip_angle_deg: 12.0,
            ..feel()
        },
    ] {
        for fz in [800.0, 4000.0, 9000.0] {
            for i in -60..=60 {
                for j in -45..=45 {
                    let kappa = i as f64 * 0.05; // −3 … 3
                    let alpha = j as f64 * m::deg_to_rad(2.0); // ±90°
                    for vx in [10.0, -10.0, 0.0] {
                        let o = eval(&p, fz, kappa, alpha, vx);
                        assert!(o.fx.is_finite() && o.fy.is_finite() && o.mz.is_finite());
                        let r = m::hypot(o.fx, o.fy);
                        assert!(
                            r <= o.fx_max * (1.0 + 1e-9),
                            "({kappa}, {alpha}, {vx}): resultant {r} exceeds peak {}",
                            o.fx_max
                        );
                    }
                }
            }
        }
    }
}

/// Angle, in degrees, between the force and the direction opposing the
/// contact-patch sliding velocity, for a locked wheel (`κ = −1`, `ω = 0`).
fn locked_direction_error_deg(p: &FeelTireParams, alpha: f64) -> f64 {
    let vx = 10.0;
    let vy = vx * m::tan(alpha);
    let o = eval(p, 4000.0, -1.0, alpha, vx);
    // Sliding velocity of the tread relative to the road is (vx − ωR, vy);
    // friction opposes it.
    let want = m::atan2(-vy, -vx);
    let got = m::atan2(o.fy, o.fx);
    let mut d = got - want;
    while d > m::PI {
        d -= m::TAU;
    }
    while d < -m::PI {
        d += m::TAU;
    }
    m::rad_to_deg(d).abs()
}

#[test]
fn locked_wheel_force_tracks_the_slide_within_the_documented_error() {
    // The direction cosines are taken in normalised slip space, so at full
    // sliding the force direction differs from the slide direction by the
    // ratio r = (κp / (1 − κp)) / tan αp between the two normalisations:
    // the worst-case error is atan(√r) − atan(1/√r) [DERIVED]. With the
    // defaults r = 1.11 and the worst case is 3.0°; ADR-0008 documents how
    // it grows for tires whose peaks differ more and the fix if it matters.
    let p = feel();
    let kp = p.peak_slip_ratio;
    let r = (kp / (1.0 - kp)) / m::tan(p.peak_slip_angle());
    let predicted = m::rad_to_deg(m::atan(m::sqrt(r)) - m::atan(1.0 / m::sqrt(r))).abs();
    assert!(predicted < 3.5, "predicted worst case {predicted}°");
    let mut worst: f64 = 0.0;
    for i in 1..90 {
        let alpha = m::deg_to_rad(i as f64);
        let e = locked_direction_error_deg(&p, alpha);
        worst = worst.max(e);
        assert!(e < 3.5, "alpha {i}°: direction error {e}°");
    }
    // The prediction ignores that the longitudinal curve at κ = −1 is a few
    // percent above its asymptote while the lateral one is at it.
    assert!(
        (worst - predicted).abs() < 0.5,
        "measured worst {worst}° vs predicted {predicted}°"
    );
    // The force magnitude of a locked wheel is the sliding value: between the
    // falloff and the peak, since the pure curve only reaches its asymptote
    // at infinite slip.
    let o = eval(&p, 4000.0, -1.0, m::deg_to_rad(20.0), 10.0);
    let peak = p.friction_at_load(4000.0) * 4000.0;
    let r = m::hypot(o.fx, o.fy);
    assert!(
        r >= p.falloff_lat * peak && r <= peak,
        "locked wheel resultant {r} outside [{}, {peak}]",
        p.falloff_lat * peak
    );
    // A tire whose peaks differ a lot has a much larger error; this is the
    // number the ADR quotes.
    let wide = FeelTireParams {
        peak_slip_ratio: 0.08,
        peak_slip_angle_deg: 10.0,
        ..feel()
    };
    let mut worst_wide: f64 = 0.0;
    for i in 1..90 {
        worst_wide = worst_wide.max(locked_direction_error_deg(&wide, m::deg_to_rad(i as f64)));
    }
    assert!(
        worst_wide > 15.0 && worst_wide < 25.0,
        "wide-peak tire error {worst_wide}°"
    );
}

#[test]
fn locked_and_reverse_spun_wheels_are_finite_and_fully_sliding() {
    let p = feel();
    let (cx, _) = reference_curves(&p, 4000.0);
    let locked = cx.eval(-1.0);
    let peak = p.friction_at_load(4000.0) * 4000.0;
    assert!(-locked > p.falloff_long * peak && -locked < peak);
    // At and beyond κ = −1 the denominator floor makes every slip ratio
    // evaluate as the locked wheel: finite, and at the pure curve's value
    // for κ = −1 to within the floor's resolution.
    for kappa in [
        -1.0,
        -1.0 - 0.5 * THEORETICAL_SLIP_MIN_DENOM,
        -1.5,
        -5.0,
        -50.0,
    ] {
        let o = eval(&p, 4000.0, kappa, 0.0, 10.0);
        assert!(o.fx.is_finite() && o.fy.is_finite());
        assert!(
            rel_close(o.fx, locked, 1e-6),
            "κ = {kappa}: fx {} vs locked {locked}",
            o.fx
        );
        assert_eq!(o.fy, 0.0);
    }
    // And at an angle, both components are at their sliding values.
    let o = eval(&p, 4000.0, -3.0, m::deg_to_rad(30.0), 10.0);
    assert!(o.fx < 0.0 && o.fy < 0.0);
    assert!(m::hypot(o.fx, o.fy) <= peak);
    assert!(m::hypot(o.fx, o.fy) >= p.falloff_lat * peak);
}

#[test]
fn large_slip_angles_with_drive_slip_keep_kappa_star_finite() {
    // A resultant normalised slip above 1 / σx,peak would map to an infinite
    // driving slip ratio; the floor on 1 − σ* keeps it finite and at the
    // asymptote.
    let p = feel();
    let kp = p.peak_slip_ratio / (1.0 + p.peak_slip_ratio);
    let s_needed = 1.0 / kp; // s at which σ* reaches 1
    let alpha = m::atan(s_needed * 2.0 * m::tan(p.peak_slip_angle()));
    let o = eval(&p, 4000.0, 0.1, alpha, 10.0);
    assert!(o.fx.is_finite() && o.fy.is_finite());
    assert!(o.fx > 0.0);
    let r = m::hypot(o.fx, o.fy);
    assert!(r <= o.fx_max);
}

#[test]
fn braking_in_reverse_mirrors_braking_forward() {
    let p = feel();
    for i in 0..30 {
        let alpha = i as f64 * m::deg_to_rad(0.5);
        for kappa in [0.02, 0.05, 0.12, 0.5, 1.0] {
            // In reverse the kinematic slip ratio of a braked wheel is
            // positive (ωR − Vx > 0 with both negative).
            let rev = eval(&p, 4000.0, kappa, alpha, -10.0);
            let fwd = eval(&p, 4000.0, -kappa, alpha, 10.0);
            assert!(
                (rev.fx + fwd.fx).abs() < 1e-9 * 4000.0,
                "κ {kappa} α {alpha}: fx {} vs {}",
                rev.fx,
                fwd.fx
            );
            assert!((rev.fy - fwd.fy).abs() < 1e-9 * 4000.0);
            assert!(rev.fx > 0.0, "braking in reverse pushes forward");
            assert!(fwd.fx < 0.0);
            // And driving in reverse mirrors driving forward.
            let rev_d = eval(&p, 4000.0, -kappa, alpha, -10.0);
            let fwd_d = eval(&p, 4000.0, kappa, alpha, 10.0);
            assert!((rev_d.fx + fwd_d.fx).abs() < 1e-9 * 4000.0);
            assert!((rev_d.fy - fwd_d.fy).abs() < 1e-9 * 4000.0);
        }
    }
}

#[test]
fn combined_force_is_continuous_across_zero_slip_ratio() {
    let p = feel();
    for alpha_frac in [0.2, 0.7, 1.0, 2.0] {
        let alpha = alpha_frac * p.peak_slip_angle();
        let minus = eval(&p, 4000.0, -1e-7, alpha, 10.0);
        let zero = eval(&p, 4000.0, 0.0, alpha, 10.0);
        let plus = eval(&p, 4000.0, 1e-7, alpha, 10.0);
        assert!((minus.fy - zero.fy).abs() < 1e-3 && (plus.fy - zero.fy).abs() < 1e-3);
        assert!(minus.fx.abs() < 1e-1 && plus.fx.abs() < 1e-1);
        assert!(minus.fx < 0.0 && plus.fx > 0.0);
    }
}

#[test]
fn peak_slip_parameters_are_validated() {
    let mut errs = Vec::new();
    FeelTireParams {
        peak_slip_ratio: 1.0,
        peak_slip_angle_deg: 60.0,
        ..feel()
    }
    .validate("t", &mut errs);
    assert!(errs
        .iter()
        .any(|e| e.contains("peakSlipRatio must be below 1")));
    assert!(errs
        .iter()
        .any(|e| e.contains("peakSlipAngleDeg must be at most 45")));
    let _ = TireModel::Feel(feel());
}
