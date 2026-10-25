//! Exact-answer tests for the MF 6.x camber equations, which apply when a
//! `.tir` file's `FITTYP` is 61 or 62.
//!
//! Source: H. B. Pacejka, *Tire and Vehicle Dynamics*, 3rd ed. (2012),
//! §4.3.2, and I. J. M. Besselink, A. J. C. Schmeitz and H. B. Pacejka, "An
//! improved Magic Formula/Swift tyre model that can handle inflation pressure
//! changes", Vehicle System Dynamics 48, sup. 1 (2010), with inflation
//! pressure and turn slip left out. These check the implementation against
//! the equations; they do not say the equations describe a tire. Tolerances
//! were set before the first run, on the same reasoning as
//! `magic_formula_tests.rs`; results are in `docs/validation/magic-formula.md`.

use skidpad_core::tire::{tir, MagicFormulaParams, TireInput, TireOutput};
use skidpad_math as m;

const SYNTHETIC: &str = include_str!("fixtures/synthetic_passenger.tir");

/// The synthetic tire read as MF 6.1, with every 6.x camber term switched on
/// and the 5.2-only ones (`PHY3`, `QBZ4`, `LGAY`, `LGAZ`) set to values that
/// would show if they leaked in. The values are made up for the test, at a
/// passenger tire's order of magnitude.
fn mf6() -> MagicFormulaParams {
    let mut p = tir::import_str(SYNTHETIC).params;
    for (k, v) in [
        ("FITTYP", 61.0),
        // Shifts, as in the 5.2 "shifted" set
        ("PHX1", 0.002),
        ("PVX1", 0.01),
        ("PHY1", 0.003),
        ("PHY2", -0.002),
        ("PVY1", 0.02),
        ("PVY2", -0.01),
        ("PEY3", 0.1),
        ("PKY4", 2.05),
        ("RHX1", 0.001),
        ("RBY3", 0.002),
        ("RHY1", 0.005),
        ("RVY1", 0.05),
        ("RVY4", 50.0),
        ("QHZ1", 0.002),
        ("QDZ6", 0.002),
        ("SSZ1", 0.01),
        ("SSZ2", 0.03),
        // MF 6.x camber
        ("PKY5", 0.4),
        ("PKY6", -0.9),
        ("PKY7", -0.15),
        ("PVY3", -0.2),
        ("PVY4", 0.05),
        ("PDY3", 2.0),
        ("PEY4", 0.4),
        ("PEY5", -1.5),
        ("RBX3", 20.0),
        ("RBY4", 15.0),
        ("RVY3", 0.3),
        ("QBZ5", -0.3),
        ("QBZ6", 2.0),
        ("QDZ3", 0.5),
        ("QDZ4", 1.0),
        ("QDZ8", -0.15),
        ("QDZ9", 0.02),
        ("QDZ10", 0.3),
        ("QDZ11", -0.1),
        ("QEZ5", 0.2),
        ("QHZ3", 0.01),
        ("QHZ4", 0.005),
        ("SSZ3", 0.1),
        ("SSZ4", 0.05),
        ("LKYC", 1.1),
        ("LKZC", 0.9),
        // MF 5.2 only: must have no effect
        ("PHY3", 0.05),
        ("QBZ4", 0.5),
        ("LGAY", 0.7),
        ("LGAZ", 1.3),
    ] {
        assert!(p.set_by_key(k, v), "{k}");
    }
    assert!(p.is_mf6());
    p
}

/// `mf6()` with the shifts that don't come from camber set to zero, so the
/// curve passes through the origin at zero camber.
fn mf6_centred() -> MagicFormulaParams {
    let mut p = mf6();
    for k in [
        "PHX1", "PVX1", "PHY1", "PHY2", "PVY1", "PVY2", "RHX1", "RHY1", "RVY1", "QHZ1", "QDZ6",
        "SSZ1",
    ] {
        assert!(p.set_by_key(k, 0.0), "{k}");
    }
    p
}

const LOADS: [f64; 4] = [0.5, 1.0, 1.5, 2.0];

fn eval(p: &MagicFormulaParams, fz: f64, kappa: f64, alpha: f64, gamma: f64) -> TireOutput {
    p.eval(&TireInput {
        fz,
        slip_ratio: kappa,
        slip_angle: m::atan(alpha),
        camber: gamma,
        vx: 20.0,
        ..TireInput::default()
    })
}

fn rel(a: f64, b: f64) -> f64 {
    m::abs(a / b - 1.0)
}

fn slope(f: impl Fn(f64) -> f64, x: f64, h: f64) -> f64 {
    (f(x + h) - f(x - h)) / (2.0 * h)
}

fn dfz(p: &MagicFormulaParams, fz: f64) -> f64 {
    (fz - p.fz0) / p.fz0
}

/// `Kyα` of MF 6.x, signed as `PKY1`, at `γ* = sin γ`.
fn kya(p: &MagicFormulaParams, fz: f64, gamma: f64) -> f64 {
    let gs = m::sin(gamma);
    p.pky1
        * p.fz0
        * (1.0 - p.pky3 * m::abs(gs))
        * m::sin(p.pky4 * m::atan((fz / p.fz0) / (p.pky2 + p.pky5 * gs * gs)))
        * p.lky
}

// --- closed-form properties ----------------------------------------------

/// The point of MF 6.x camber: at zero slip, `∂Fy/∂γ` is the camber
/// stiffness `Kyγ0 = Fz (PKY6 + PKY7 dfz) λKyγ`, whatever `PVY3`, `PVY4` say
/// about how much of it is a vertical shift.
#[test]
fn camber_stiffness_is_kyg0() {
    let p = mf6_centred();
    for l in LOADS {
        let fz = l * p.fz0;
        let k = slope(|g| eval(&p, fz, 0.0, 0.0, g).fy, 0.0, 1e-5);
        let k_book = fz * (p.pky6 + p.pky7 * dfz(&p, fz)) * p.lkyc;
        assert!(rel(k, k_book) < 1e-6, "{l}: Kyγ {k} vs {k_book}");
    }
}

/// The split between shift and vertical offset changes the curve away from
/// the origin, not the camber stiffness at it.
#[test]
fn camber_stiffness_does_not_depend_on_pvy3() {
    let base = mf6_centred();
    let fz = base.fz0;
    let k = |p: &MagicFormulaParams| slope(|g| eval(p, fz, 0.0, 0.0, g).fy, 0.0, 1e-5);
    for pvy3 in [-0.5, 0.0, 0.5] {
        let mut p = base.clone();
        p.pvy3 = pvy3;
        assert!(rel(k(&p), k(&base)) < 1e-6, "PVY3 {pvy3}");
    }
}

/// `Kyα` is scaled by `1 − PKY3 |γ*|`, and its peak against load moves to
/// `Fz = (PKY2 + PKY5 γ*²) F'z0 tan(π / 2 PKY4)`. The slope is read at the
/// shifted origin `α* = −SHy`, where the curve's `E` drops out.
#[test]
fn camber_scales_and_moves_the_cornering_stiffness() {
    let p = mf6_centred();
    for gamma in [-0.1, -0.03, 0.03, 0.1] {
        let gs = m::sin(gamma);
        let shy = |fz: f64| {
            let df = dfz(&p, fz);
            let kyg0 = fz * (p.pky6 + p.pky7 * df) * p.lkyc;
            let svyg = fz * (p.pvy3 + p.pvy4 * df) * gs * p.lkyc;
            (kyg0 * gs - svyg) / kya(&p, fz, gamma)
        };
        let ky = |fz: f64| slope(|a| eval(&p, fz, 0.0, a, gamma).fy, -shy(fz), 1e-5);
        for l in LOADS {
            let fz = l * p.fz0;
            let k_book = kya(&p, fz, gamma);
            assert!(
                rel(ky(fz), k_book) < 1e-6,
                "γ {gamma} {l}: {} vs {k_book}",
                ky(fz)
            );
        }
        let f_peak = (p.pky2 + p.pky5 * gs * gs) * p.fz0 * m::tan(m::PI / (2.0 * p.pky4));
        let k_peak = p.pky1 * p.fz0 * (1.0 - p.pky3 * m::abs(gs)) * p.lky;
        assert!(rel(kya(&p, f_peak, gamma), k_peak) < 1e-12);
        assert!(
            rel(ky(f_peak), k_peak) < 1e-6,
            "γ {gamma}: peak {}",
            ky(f_peak)
        );
    }
}

/// At zero slip the trail term carries no camber in MF 6.x (`F'y` is taken
/// at `γ = 0`), so the camber moment is `Mzr`, with slope
/// `Fz R0 (QDZ8 + QDZ9 dfz) λKzγ λμy` at `γ = 0`. `QDZ10`, `QDZ11` are
/// zeroed here: their `|γ*| γ*` is odd, so a central difference picks up
/// `h (QDZ10 + QDZ11 dfz)` from them, about 2e-5 of the slope at this step.
/// The every-term check covers them.
#[test]
fn camber_moment_stiffness_is_the_residual_moment() {
    let mut p = mf6_centred();
    p.qdz10 = 0.0;
    p.qdz11 = 0.0;
    for l in LOADS {
        let fz = l * p.fz0;
        let k = slope(|g| eval(&p, fz, 0.0, 0.0, g).mz, 0.0, 1e-5);
        let k_book = fz * p.unloaded_radius * (p.qdz8 + p.qdz9 * dfz(&p, fz)) * p.lkzc;
        assert!(rel(k, k_book) < 1e-6, "{l}: Kzγ {k} vs {k_book}");
    }
}

/// With every 6.x camber term at zero and `γ = 0`, the 6.x and 5.2 paths
/// are the same equations.
#[test]
fn mf6_at_zero_camber_is_mf52() {
    let v52 = tir::import_str(SYNTHETIC).params;
    let mut v6 = v52.clone();
    v6.fittyp = 61.0;
    for l in LOADS {
        let fz = l * v52.fz0;
        for kappa in [-0.2, 0.0, 0.05] {
            for alpha in [-0.2, -0.01, 0.0, 0.03] {
                let a = eval(&v52, fz, kappa, alpha, 0.0);
                let b = eval(&v6, fz, kappa, alpha, 0.0);
                for (n, x, y) in [("fx", a.fx, b.fx), ("fy", a.fy, b.fy), ("mz", a.mz, b.mz)] {
                    assert!(
                        m::abs(x - y) < 1e-12 * fz,
                        "{n} {l} {kappa} {alpha}: {x} vs {y}"
                    );
                }
            }
        }
    }
}

// --- every term at once ----------------------------------------------------

struct Reference {
    fx: f64,
    fy: f64,
    mz: f64,
}

/// MF 6.x without inflation pressure or turn slip, written out in full with
/// camber: pure slip, combined slip and the aligning moment with its
/// equivalent slips. `F'z0 = Fz0` (`LFZO = 1`).
fn reference(p: &MagicFormulaParams, fz: f64, kappa: f64, alpha: f64, gamma: f64) -> Reference {
    let f0 = p.fz0;
    let df = (fz - f0) / f0;
    let r0 = p.unloaded_radius;
    let gs = m::sin(gamma);
    let mf = |b: f64, c: f64, d: f64, e: f64, x: f64| {
        let bx = b * x;
        d * m::sin(c * m::atan(bx - e * (bx - m::atan(bx))))
    };
    let mf_cos = |b: f64, c: f64, e: f64, x: f64| {
        let bx = b * x;
        m::cos(c * m::atan(bx - e * (bx - m::atan(bx))))
    };

    // Pure longitudinal: camber only through PDX3 (zero here).
    let kx = kappa + p.phx1 + p.phx2 * df;
    let cx = p.pcx1;
    let dx = (p.pdx1 + p.pdx2 * df) * (1.0 - p.pdx3 * gamma * gamma) * fz;
    let ex = (p.pex1 + p.pex2 * df + p.pex3 * df * df) * (1.0 - p.pex4 * m::signum(kx));
    let kxk = fz * (p.pkx1 + p.pkx2 * df) * m::exp(p.pkx3 * df);
    let fx0 = mf(kxk / (cx * dx), cx, dx, ex, kx) + fz * (p.pvx1 + p.pvx2 * df);

    // Pure lateral, at a given γ*.
    let lateral = |gs: f64| {
        let kya = p.pky1
            * f0
            * (1.0 - p.pky3 * m::abs(gs))
            * m::sin(p.pky4 * m::atan((fz / f0) / (p.pky2 + p.pky5 * gs * gs)));
        let kyg0 = fz * (p.pky6 + p.pky7 * df) * p.lkyc;
        let svyg = fz * (p.pvy3 + p.pvy4 * df) * gs * p.lkyc;
        let svy = fz * (p.pvy1 + p.pvy2 * df) + svyg;
        let shy = p.phy1 + p.phy2 * df + (kyg0 * gs - svyg) / kya;
        let ay = alpha + shy;
        let cy = p.pcy1;
        let muy = (p.pdy1 + p.pdy2 * df) * (1.0 - p.pdy3 * gs * gs);
        let dy = muy * fz;
        let ey = (p.pey1 + p.pey2 * df)
            * (1.0 + p.pey5 * gs * gs - (p.pey3 + p.pey4 * gs) * m::signum(ay));
        let by = kya / (cy * dy);
        (mf(by, cy, dy, ey, ay) + svy, kya, shy, svy, muy, by, cy)
    };
    let (fy0, kya, shy, svy, muy, by, cy) = lateral(gs);

    // Combined slip.
    let bxa = (p.rbx1 + p.rbx3 * gs * gs) * m::cos(m::atan(p.rbx2 * kappa));
    let exa = p.rex1 + p.rex2 * df;
    let gxa = mf_cos(bxa, p.rcx1, exa, alpha + p.rhx1) / mf_cos(bxa, p.rcx1, exa, p.rhx1);
    let fx = gxa * fx0;
    let gyk = |gs: f64| {
        let byk = (p.rby1 + p.rby4 * gs * gs) * m::cos(m::atan(p.rby2 * (alpha - p.rby3)));
        let eyk = p.rey1 + p.rey2 * df;
        let shyk = p.rhy1 + p.rhy2 * df;
        mf_cos(byk, p.rcy1, eyk, kappa + shyk) / mf_cos(byk, p.rcy1, eyk, shyk)
    };
    let dvyk = muy * fz * (p.rvy1 + p.rvy2 * df + p.rvy3 * gs) * m::cos(m::atan(p.rvy4 * alpha));
    let svyk = dvyk * m::sin(p.rvy5 * m::atan(p.rvy6 * kappa));
    let fy = gyk(gs) * fy0 + svyk;

    // Aligning moment.
    let (fy0_flat, kya_flat, ..) = lateral(0.0);
    let fy_prime = gyk(0.0) * fy0_flat;
    let alpha_t = alpha + p.qhz1 + p.qhz2 * df + (p.qhz3 + p.qhz4 * df) * gs;
    let alpha_r = alpha + shy + svy / kya;
    let alpha_t_eq = m::sqrt(alpha_t * alpha_t + m::powi(kxk / kya_flat, 2) * kappa * kappa)
        * m::signum(alpha_t);
    let alpha_r_eq =
        m::sqrt(alpha_r * alpha_r + m::powi(kxk / kya, 2) * kappa * kappa) * m::signum(alpha_r);
    let bt =
        (p.qbz1 + p.qbz2 * df + p.qbz3 * df * df) * (1.0 + p.qbz5 * m::abs(gs) + p.qbz6 * gs * gs);
    let ct = p.qcz1;
    let dt =
        fz * (r0 / f0) * (p.qdz1 + p.qdz2 * df) * (1.0 + p.qdz3 * m::abs(gs) + p.qdz4 * gs * gs);
    let et = (p.qez1 + p.qez2 * df + p.qez3 * df * df)
        * (1.0 + (p.qez4 + p.qez5 * gs) * (2.0 / m::PI) * m::atan(bt * ct * alpha_t_eq));
    let cos_a = m::cos(m::atan(alpha));
    let t = dt * mf_cos(bt, ct, et, alpha_t_eq) * cos_a;
    let br = p.qbz9 + p.qbz10 * by * cy;
    let dr = fz
        * r0
        * ((p.qdz6 + p.qdz7 * df)
            + ((p.qdz8 + p.qdz9 * df) + (p.qdz10 + p.qdz11 * df) * m::abs(gs)) * gs * p.lkzc);
    let mzr = dr * m::cos(m::atan(br * alpha_r_eq)) * cos_a;
    let s = r0 * (p.ssz1 + p.ssz2 * fy / f0 + (p.ssz3 + p.ssz4 * df) * gs);
    let mz = -t * fy_prime + mzr + s * fx;
    Reference { fx, fy, mz }
}

/// With every 6.x camber term and every shift on, skidpad's `Fx`, `Fy` and
/// `Mz` equal the equations over 0.5 to 2 `F'z0`, |κ| up to 0.3, |α| up to
/// 0.3 and |γ| up to 0.1 rad.
#[test]
fn every_term_together_matches_the_equations_with_camber() {
    let p = mf6();
    let kappas = [-0.3, -0.05, 0.0, 0.01, 0.1];
    let alphas = [-0.3, -0.05, -0.005, 0.0, 0.01, 0.1];
    let gammas = [-0.1, -0.03, 0.0, 0.02, 0.1];
    for l in LOADS {
        let fz = l * p.fz0;
        for kappa in kappas {
            for alpha in alphas {
                for gamma in gammas {
                    let got = eval(&p, fz, kappa, alpha, gamma);
                    let want = reference(&p, fz, kappa, alpha, gamma);
                    let at = format!("Fz {fz} κ {kappa} α {alpha} γ {gamma}");
                    assert!(
                        m::abs(got.fx - want.fx) < 1e-9 * fz,
                        "{at}: Fx {} vs {}",
                        got.fx,
                        want.fx
                    );
                    assert!(
                        m::abs(got.fy - want.fy) < 1e-9 * fz,
                        "{at}: Fy {} vs {}",
                        got.fy,
                        want.fy
                    );
                    assert!(
                        m::abs(got.mz - want.mz) < 1e-9 * fz * p.unloaded_radius,
                        "{at}: Mz {} vs {}",
                        got.mz,
                        want.mz
                    );
                }
            }
        }
    }
}
