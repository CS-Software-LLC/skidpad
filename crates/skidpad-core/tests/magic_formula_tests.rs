//! Exact-answer tests for the Magic Formula tire: properties that Pacejka's
//! equations guarantee in closed form, checked against what
//! `MagicFormulaParams::eval` returns.
//!
//! Source: H. B. Pacejka, *Tire and Vehicle Dynamics*, 2nd ed. (2006), §4.3.1
//! (the meaning of `B`, `C`, `D`, `E`: peak `D`, slope at the origin `BCD`,
//! sliding asymptote `D sin(πC/2)`, peak where `Bx − E(Bx − atan Bx) =
//! tan(π/2C)`) and §4.3.2 (eq. 4.E9–4.E78). These verify the implementation
//! against the equations; they do not say the equations describe a tire.
//! Tolerances were set before the first run; results and reasoning are in
//! `docs/validation/magic-formula.md`.

use skidpad_core::tire::{tir, MagicFormulaParams, TireInput, TireOutput};
use skidpad_math as m;

const SYNTHETIC: &str = include_str!("fixtures/synthetic_passenger.tir");

/// Every parameter set the closed-form checks run on, with the shift terms
/// that move the curve off the origin set to zero (camber thrust included),
/// so `D`, `BCD` and the asymptote read straight off the curve. The camber
/// terms that change the curve's shape stay.
fn sets() -> Vec<(&'static str, MagicFormulaParams)> {
    vec![
        ("synthetic", centred(tir::import_str(SYNTHETIC).params)),
        ("shifted", centred(shifted())),
    ]
}

fn centred(mut p: MagicFormulaParams) -> MagicFormulaParams {
    for k in [
        "PHX1", "PHX2", "PVX1", "PVX2", "PHY1", "PHY2", "PHY3", "PVY1", "PVY2", "PVY3", "PVY4",
        "QHZ1", "QHZ2", "QHZ3", "QHZ4", "RHX1", "RHY1", "RHY2",
    ] {
        assert!(p.set_by_key(k, 0.0), "{k}");
    }
    p
}

/// The loads every check sweeps, as multiples of `F'z0`.
const LOADS: [f64; 4] = [0.5, 1.0, 1.5, 2.0];

fn fz0(p: &MagicFormulaParams) -> f64 {
    p.fz0 * p.lfzo
}

fn dfz(p: &MagicFormulaParams, fz: f64) -> f64 {
    (fz - fz0(p)) / fz0(p)
}

/// Evaluate at lateral slip `α* = tan α` (eq. 4.E3), the variable every
/// lateral equation takes, so the checks below read in the book's terms.
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

/// Central difference, step `h`.
fn slope(f: impl Fn(f64) -> f64, x: f64, h: f64) -> f64 {
    (f(x + h) - f(x - h)) / (2.0 * h)
}

/// Golden-section search for the maximum of a unimodal `f` on `[a, b]`.
fn argmax(f: impl Fn(f64) -> f64, mut a: f64, mut b: f64) -> f64 {
    let g = (m::sqrt(5.0) - 1.0) / 2.0;
    while b - a > 1e-12 * m::max(m::abs(a) + m::abs(b), 1e-12) {
        let (c, d) = (b - g * (b - a), a + g * (b - a));
        if f(c) > f(d) {
            b = d;
        } else {
            a = c;
        }
    }
    0.5 * (a + b)
}

/// Where the Magic Formula `D sin(C atan(Bx − E(Bx − atan Bx)))` peaks:
/// the root of `Bx − E(Bx − atan Bx) = tan(π/2C)`, by bisection. Needs
/// `1 < C < 2` and `E < 1`, where the left side rises monotonically.
fn peak_slip(b: f64, c: f64, e: f64) -> f64 {
    let target = m::tan(m::PI / (2.0 * c));
    let h = |x: f64| b * x - e * (b * x - m::atan(b * x)) - target;
    let (mut lo, mut hi) = (0.0, 1.0);
    while h(hi) < 0.0 {
        hi *= 2.0;
    }
    for _ in 0..200 {
        let mid = 0.5 * (lo + hi);
        if h(mid) < 0.0 {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    0.5 * (lo + hi)
}

/// Pure longitudinal coefficients `(B, C, D, E)` for `κ > 0`, γ = 0
/// (eq. 4.E10–4.E16), written out here from the book rather than read from
/// the implementation.
fn bcde_x(p: &MagicFormulaParams, fz: f64) -> (f64, f64, f64, f64) {
    let df = dfz(p, fz);
    let c = p.pcx1 * p.lcx;
    let d = (p.pdx1 + p.pdx2 * df) * p.lmux * fz;
    let e = (p.pex1 + p.pex2 * df + p.pex3 * df * df) * (1.0 - p.pex4) * p.lex;
    let k = fz * (p.pkx1 + p.pkx2 * df) * m::exp(p.pkx3 * df) * p.lkx;
    (k / (c * d), c, d, e)
}

/// Pure lateral coefficients for `α > 0`, γ = 0 (eq. 4.E20–4.E26), with
/// the ISO sign: `D` and `K` come out negative, so `B` is positive.
fn bcde_y(p: &MagicFormulaParams, fz: f64) -> (f64, f64, f64, f64) {
    let df = dfz(p, fz);
    let c = p.pcy1 * p.lcy;
    let d = (p.pdy1 + p.pdy2 * df) * p.lmuy * fz;
    let e = (p.pey1 + p.pey2 * df) * (1.0 - p.pey3) * p.ley;
    let k = cornering_stiffness(p, fz, 0.0);
    (m::abs(k) / (c * d), c, d, e)
}

/// `Kyα` (eq. 4.E25), signed as `PKY1`.
fn cornering_stiffness(p: &MagicFormulaParams, fz: f64, gamma: f64) -> f64 {
    let f0 = fz0(p);
    p.pky1
        * f0
        * m::sin(p.pky4 * m::atan(fz / (p.pky2 * f0)))
        * (1.0 - p.pky3 * m::abs(gamma * p.lgay))
        * p.lky
}

// --- pure slip: the four characteristic values ---------------------------

/// The slope of `Fx(κ)` at the origin is `BCD = Kxκ` (eq. 4.E15), and the
/// slope of `Fy(α)` is `Kyα` (eq. 4.E25), at every load.
#[test]
fn slope_at_the_origin_is_the_slip_stiffness() {
    for (name, p) in sets() {
        for l in LOADS {
            let fz = l * fz0(&p);
            let kx = slope(|k| eval(&p, fz, k, 0.0, 0.0).fx, 0.0, 1e-5);
            let df = dfz(&p, fz);
            let kx_book = fz * (p.pkx1 + p.pkx2 * df) * m::exp(p.pkx3 * df) * p.lkx;
            assert!(rel(kx, kx_book) < 1e-6, "{name} {l}: Kx {kx} vs {kx_book}");
            let ky = slope(|a| eval(&p, fz, 0.0, a, 0.0).fy, 0.0, 1e-5);
            let ky_book = cornering_stiffness(&p, fz, 0.0);
            assert!(rel(ky, ky_book) < 1e-6, "{name} {l}: Ky {ky} vs {ky_book}");
        }
    }
}

/// The peak force is `D = μ Fz` with `μ = PD1 + PD2 dfz`, and it sits where
/// `Bx − E(Bx − atan Bx) = tan(π/2C)`.
#[test]
fn peak_is_d_and_sits_where_the_formula_says() {
    for (name, p) in sets() {
        for l in LOADS {
            let fz = l * fz0(&p);

            let (b, c, d, e) = bcde_x(&p, fz);
            let fx = |k: f64| eval(&p, fz, k, 0.0, 0.0).fx;
            let k_peak = argmax(fx, 0.0, 1.0);
            assert!(
                rel(fx(k_peak), d) < 1e-9,
                "{name} {l}: Fx peak {} vs D {d}",
                fx(k_peak)
            );
            let k_book = peak_slip(b, c, e);
            assert!(
                rel(k_peak, k_book) < 1e-5,
                "{name} {l}: κ peak {k_peak} vs {k_book}"
            );

            let (b, c, d, e) = bcde_y(&p, fz);
            let fy = |a: f64| -eval(&p, fz, 0.0, a, 0.0).fy;
            let a_peak = argmax(fy, 0.0, 1.0);
            assert!(
                rel(fy(a_peak), d) < 1e-9,
                "{name} {l}: Fy peak {} vs D {d}",
                fy(a_peak)
            );
            let a_book = peak_slip(b, c, e);
            assert!(
                rel(a_peak, a_book) < 1e-5,
                "{name} {l}: α peak {a_peak} vs {a_book}"
            );

            let out = eval(&p, fz, 0.0, 0.0, 0.0);
            assert!(
                rel(out.fx_max, m::abs(bcde_x(&p, fz).2)) < 1e-12,
                "{name}: fx_max"
            );
            assert!(rel(out.fy_max, m::abs(d)) < 1e-12, "{name}: fy_max");
        }
    }
}

/// At full sliding the curve tends to `D sin(πC/2)`. `κ = 10⁶` leaves the
/// arctangent within `1/((1 − E)Bκ)` of `π/2`.
#[test]
fn sliding_force_is_the_asymptote() {
    for (name, p) in sets() {
        for l in LOADS {
            let fz = l * fz0(&p);
            let (_, c, d, _) = bcde_x(&p, fz);
            let slide = d * m::sin(c * m::FRAC_PI_2);
            let out = eval(&p, fz, 1e6, 0.0, 0.0);
            assert!(
                rel(out.fx, slide) < 1e-5,
                "{name} {l}: {} vs {slide}",
                out.fx
            );
            assert!(
                rel(out.fx_slide, m::abs(slide)) < 1e-12,
                "{name} {l}: fx_slide"
            );
        }
    }
}

/// `Kyα` rises with load to its maximum `|PKY1| F'z0` where
/// `sin(PKY4 atan(Fz / PKY2 F'z0))` reaches 1 (eq. 4.E25), at
/// `Fz = PKY2 F'z0 tan(π / 2 PKY4)`: `PKY2 F'z0` itself when `PKY4 = 2`.
#[test]
fn cornering_stiffness_peaks_where_the_load_term_reaches_one() {
    for (name, p) in sets() {
        let ky = |fz: f64| -slope(|a| eval(&p, fz, 0.0, a, 0.0).fy, 0.0, 1e-5);
        let f_peak = argmax(ky, 0.2 * fz0(&p), 5.0 * fz0(&p));
        let f_book = p.pky2 * fz0(&p) * m::tan(m::PI / (2.0 * p.pky4));
        assert!(
            rel(f_peak, f_book) < 1e-4,
            "{name}: peak at {f_peak} vs {f_book}"
        );
        let k_book = m::abs(p.pky1) * fz0(&p) * p.lky;
        assert!(
            rel(ky(f_book), k_book) < 1e-6,
            "{name}: {} vs {k_book}",
            ky(f_book)
        );
    }
}

/// Camber scales the cornering stiffness by `1 − PKY3 |γ|` (eq. 4.E25). The
/// camber thrust shifts the curve but not its slope at the shifted origin.
#[test]
fn camber_scales_the_cornering_stiffness() {
    for (name, p) in sets() {
        let fz = fz0(&p);
        for gamma in [-0.06, -0.02, 0.02, 0.06] {
            let k = slope(|a| eval(&p, fz, 0.0, a, gamma).fy, 0.0, 1e-5);
            let k_book = cornering_stiffness(&p, fz, gamma);
            assert!(rel(k, k_book) < 1e-6, "{name} γ {gamma}: {k} vs {k_book}");
        }
    }
}

/// `λμ` scales the peak and leaves the slope; `λK` scales the slope and
/// leaves the peak (Pacejka §4.3.2, the user scaling factors). The surface
/// grip multiplies `λμ` (ADR-0014), so it must behave the same way.
#[test]
fn scaling_factors_scale_what_they_name() {
    for (name, base) in sets() {
        let fz = fz0(&base);
        let peak = |p: &MagicFormulaParams, grip: f64| {
            let f = |a: f64| {
                -p.eval(&TireInput {
                    fz,
                    slip_angle: m::atan(a),
                    vx: 20.0,
                    grip,
                    ..TireInput::default()
                })
                .fy
            };
            f(argmax(f, 0.0, 1.0))
        };
        let stiff = |p: &MagicFormulaParams| slope(|a| eval(p, fz, 0.0, a, 0.0).fy, 0.0, 1e-5);
        let (p0, k0) = (peak(&base, 1.0), stiff(&base));

        let mut p = base.clone();
        p.lmuy = 0.8;
        assert!(rel(peak(&p, 1.0), 0.8 * p0) < 1e-9, "{name}: λμy peak");
        assert!(rel(stiff(&p), k0) < 1e-6, "{name}: λμy slope");
        assert!(rel(peak(&base, 0.8), 0.8 * p0) < 1e-9, "{name}: grip peak");

        let mut p = base.clone();
        p.lky = 1.2;
        assert!(rel(peak(&p, 1.0), p0) < 1e-9, "{name}: λKy peak");
        assert!(rel(stiff(&p), 1.2 * k0) < 1e-6, "{name}: λKy slope");
    }
}

// --- combined slip -------------------------------------------------------

/// The combined-slip weights in closed form (eq. 4.E54–4.E57, 4.E62–4.E66):
/// `G = cos(C atan(Bs − E(Bs − atan Bs)))` normalised by its value at zero
/// slip, so `Fx(κ, α) = Gxα Fx0(κ)` and `Fy(κ, α) = Gyκ Fy0(α) + SVyκ`.
#[test]
fn combined_slip_matches_the_weighting_functions() {
    let g = |b: f64, c: f64, e: f64, s: f64| {
        let bs = b * s;
        m::cos(c * m::atan(bs - e * (bs - m::atan(bs))))
    };
    for (name, p) in sets() {
        for l in LOADS {
            let fz = l * fz0(&p);
            let df = dfz(&p, fz);
            for kappa in [-0.3, -0.08, -0.02, 0.02, 0.08, 0.3] {
                for alpha in [-0.2, -0.06, -0.01, 0.01, 0.06, 0.2] {
                    let out = eval(&p, fz, kappa, alpha, 0.0);
                    let fx0 = eval(&p, fz, kappa, 0.0, 0.0).fx;
                    let fy0 = eval(&p, fz, 0.0, alpha, 0.0).fy;

                    let bxa = p.rbx1 * m::cos(m::atan(p.rbx2 * kappa)) * p.lxal;
                    let exa = p.rex1 + p.rex2 * df;
                    let gxa = g(bxa, p.rcx1, exa, alpha) / g(bxa, p.rcx1, exa, 0.0);
                    assert!(
                        rel(out.fx, gxa * fx0) < 1e-9,
                        "{name} {l} κ {kappa} α {alpha}: Fx {} vs {}",
                        out.fx,
                        gxa * fx0
                    );

                    let byk = p.rby1 * m::cos(m::atan(p.rby2 * (alpha - p.rby3))) * p.lyka;
                    let eyk = p.rey1 + p.rey2 * df;
                    let gyk = g(byk, p.rcy1, eyk, kappa) / g(byk, p.rcy1, eyk, 0.0);
                    let muy = (p.pdy1 + p.pdy2 * df) * p.lmuy;
                    let dvyk = muy * fz * (p.rvy1 + p.rvy2 * df) * m::cos(m::atan(p.rvy4 * alpha));
                    let svyk = dvyk * m::sin(p.rvy5 * m::atan(p.rvy6 * kappa)) * p.lvyka;
                    let fy_book = gyk * fy0 + svyk;
                    assert!(
                        m::abs(out.fy - fy_book) < 1e-9 * m::abs(fy0),
                        "{name} {l} κ {kappa} α {alpha}: Fy {} vs {fy_book}",
                        out.fy
                    );
                }
            }
        }
    }
}

// --- aligning moment -----------------------------------------------------

/// At zero slip the pneumatic trail is `Dt = Fz (QDZ1 + QDZ2 dfz) R0 / F'z0`
/// (eq. 4.E42), and for small slip angles `Mz ≈ −t Fy`, so the aligning
/// stiffness is `−Dt Kyα` (the residual moment `Mzr` is even in α and zero
/// here without camber or `QDZ6`).
#[test]
fn aligning_stiffness_is_trail_times_cornering_stiffness() {
    for (name, p) in sets() {
        for l in LOADS {
            let fz = l * fz0(&p);
            let dt = fz * (p.qdz1 + p.qdz2 * dfz(&p, fz)) * p.unloaded_radius / fz0(&p) * p.ltr;
            let out = eval(&p, fz, 0.0, 0.0, 0.0);
            assert!(
                rel(out.trail, dt) < 1e-12,
                "{name} {l}: trail {} vs {dt}",
                out.trail
            );

            let k_mz = slope(|a| eval(&p, fz, 0.0, a, 0.0).mz, 0.0, 1e-6);
            let dr = slope(
                |a| {
                    let o = eval(&p, fz, 0.0, a, 0.0);
                    o.mz + o.trail * o.fy
                },
                0.0,
                1e-6,
            );
            let k_book = -dt * cornering_stiffness(&p, fz, 0.0);
            assert!(m::abs(dr) < 1e-6 * k_book, "{name} {l}: Mzr slope {dr}");
            assert!(
                rel(k_mz, k_book) < 1e-6,
                "{name} {l}: K_Mz {k_mz} vs {k_book}"
            );
        }
    }
}

// --- every term at once --------------------------------------------------

/// The synthetic tire with every shift term this subset reads switched on,
/// `PKY4` moved off MF 5.2's fixed 2, and the residual moment and the `Fx`
/// arm of `Mz` made non-zero. The values are made up for the test; they are
/// a passenger tire's order of magnitude.
fn shifted() -> MagicFormulaParams {
    let mut p = tir::import_str(SYNTHETIC).params;
    for (k, v) in [
        ("PHX1", 0.002),
        ("PHX2", 0.001),
        ("PVX1", 0.01),
        ("PVX2", 0.005),
        ("PEX4", 0.05),
        ("PHY1", 0.003),
        ("PHY2", -0.002),
        ("PVY1", 0.02),
        ("PVY2", -0.01),
        ("PEY3", 0.1),
        ("PKY4", 2.05),
        ("RHX1", 0.001),
        ("RBY3", 0.002),
        ("RHY1", 0.005),
        ("RHY2", 0.002),
        ("RVY1", 0.05),
        ("RVY4", 50.0),
        ("QHZ1", 0.002),
        ("QHZ2", -0.001),
        ("QDZ6", 0.002),
        ("QDZ7", -0.001),
        ("SSZ1", 0.01),
        ("SSZ2", 0.03),
    ] {
        assert!(p.set_by_key(k, v), "{k}");
    }
    p
}

struct Reference {
    fx: f64,
    fy: f64,
    mz: f64,
}

/// Pacejka's equations at zero camber with every shift term in (eq. 4.E9 to
/// 4.E67, and 4.E31 to 4.E49 for `Mz` at `κ = 0`, where the equivalent slip
/// angles of 4.E77 and 4.E78 are the plain ones). Scaling factors are 1.
fn reference(p: &MagicFormulaParams, fz: f64, kappa: f64, alpha: f64) -> Reference {
    let f0 = p.fz0;
    let df = (fz - f0) / f0;
    let r0 = p.unloaded_radius;
    let mf = |b: f64, c: f64, d: f64, e: f64, x: f64| {
        let bx = b * x;
        d * m::sin(c * m::atan(bx - e * (bx - m::atan(bx))))
    };
    let mf_cos = |b: f64, c: f64, e: f64, x: f64| {
        let bx = b * x;
        m::cos(c * m::atan(bx - e * (bx - m::atan(bx))))
    };

    let kx = kappa + p.phx1 + p.phx2 * df;
    let cx = p.pcx1;
    let dx = (p.pdx1 + p.pdx2 * df) * fz;
    let ex = (p.pex1 + p.pex2 * df + p.pex3 * df * df) * (1.0 - p.pex4 * m::signum(kx));
    let kxk = fz * (p.pkx1 + p.pkx2 * df) * m::exp(p.pkx3 * df);
    let fx0 = mf(kxk / (cx * dx), cx, dx, ex, kx) + fz * (p.pvx1 + p.pvx2 * df);

    let kya = p.pky1 * f0 * m::sin(p.pky4 * m::atan(fz / (p.pky2 * f0)));
    let shy = p.phy1 + p.phy2 * df;
    let svy = fz * (p.pvy1 + p.pvy2 * df);
    let ay = alpha + shy;
    let cy = p.pcy1;
    let muy = p.pdy1 + p.pdy2 * df;
    let dy = muy * fz;
    let ey = (p.pey1 + p.pey2 * df) * (1.0 - p.pey3 * m::signum(ay));
    let by = kya / (cy * dy);
    let fy0 = mf(by, cy, dy, ey, ay) + svy;

    let bxa = p.rbx1 * m::cos(m::atan(p.rbx2 * kappa));
    let exa = p.rex1 + p.rex2 * df;
    let gxa = mf_cos(bxa, p.rcx1, exa, alpha + p.rhx1) / mf_cos(bxa, p.rcx1, exa, p.rhx1);
    let fx = gxa * fx0;
    let byk = p.rby1 * m::cos(m::atan(p.rby2 * (alpha - p.rby3)));
    let eyk = p.rey1 + p.rey2 * df;
    let shyk = p.rhy1 + p.rhy2 * df;
    let gyk = mf_cos(byk, p.rcy1, eyk, kappa + shyk) / mf_cos(byk, p.rcy1, eyk, shyk);
    let dvyk = muy * fz * (p.rvy1 + p.rvy2 * df) * m::cos(m::atan(p.rvy4 * alpha));
    let svyk = dvyk * m::sin(p.rvy5 * m::atan(p.rvy6 * kappa));
    let fy = gyk * fy0 + svyk;

    let alpha_t = alpha + p.qhz1 + p.qhz2 * df;
    let bt = p.qbz1 + p.qbz2 * df + p.qbz3 * df * df;
    let ct = p.qcz1;
    let dt = fz * (r0 / f0) * (p.qdz1 + p.qdz2 * df);
    let et = (p.qez1 + p.qez2 * df + p.qez3 * df * df)
        * (1.0 + p.qez4 * (2.0 / m::PI) * m::atan(bt * ct * alpha_t));
    let cos_a = m::cos(m::atan(alpha));
    let t = dt * mf_cos(bt, ct, et, alpha_t) * cos_a;
    let alpha_r = alpha + shy + svy / kya;
    let br = p.qbz9 + p.qbz10 * by * cy;
    let dr = fz * r0 * (p.qdz6 + p.qdz7 * df);
    let mzr = dr * m::cos(m::atan(br * alpha_r)) * cos_a;
    let s = r0 * (p.ssz1 + p.ssz2 * fy / f0);
    let mz = -t * (fy - svyk) + mzr + s * fx;
    Reference { fx, fy, mz }
}

/// With every shift on, skidpad's forces and aligning moment equal the
/// equations over 0.5 to 2 `F'z0`, |κ| up to 0.5 and |α| up to 0.3 (`Mz`
/// at `κ = 0`).
#[test]
fn every_term_together_matches_the_equations_at_zero_camber() {
    let p = shifted();
    let kappas = [-0.5, -0.1, -0.03, -0.005, 0.0, 0.005, 0.03, 0.1, 0.5];
    let alphas = [-0.3, -0.1, -0.03, -0.005, 0.0, 0.005, 0.03, 0.1, 0.3];
    for l in LOADS {
        let fz = l * p.fz0;
        for kappa in kappas {
            for alpha in alphas {
                let got = eval(&p, fz, kappa, alpha, 0.0);
                let want = reference(&p, fz, kappa, alpha);
                let at = format!("Fz {fz} κ {kappa} α {alpha}");
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
                if kappa == 0.0 {
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

/// The slip angle the vehicle passes is the angle `α`; the formula is fed
/// `α* = tan α` (eq. 4.E3), not the angle itself.
#[test]
fn the_formula_is_fed_tan_alpha() {
    let p = shifted();
    for deg in [-20.0, -8.0, -2.0, 2.0, 8.0, 20.0] {
        let a = m::deg_to_rad(deg);
        let got = p.eval(&TireInput {
            fz: p.fz0,
            slip_angle: a,
            vx: 20.0,
            ..TireInput::default()
        });
        let want = reference(&p, p.fz0, 0.0, m::tan(a));
        assert!(
            m::abs(got.fy - want.fy) < 1e-9 * p.fz0,
            "{deg}°: Fy {} vs {}",
            got.fy,
            want.fy
        );
        assert!(
            m::abs(got.mz - want.mz) < 1e-9 * p.fz0 * p.unloaded_radius,
            "{deg}°: Mz {} vs {}",
            got.mz,
            want.mz
        );
    }
}
