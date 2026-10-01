//! The Magic Formula curve shape, shared by both tire models.
//!
//! `y(x) = D · sin(C · atan(B·x − E·(B·x − atan(B·x))))`
//!
//! Source: E. Bakker, L. Nyborg, H. B. Pacejka, "Tyre Modelling for Use in
//! Vehicle Dynamics Studies", SAE 870421 (1987), and H. B. Pacejka, *Tire and
//! Vehicle Dynamics*, ch. 4.

use cp_math as m;

/// Evaluate the Magic Formula shape for the given coefficients.
#[inline]
pub fn magic(b: f64, c: f64, d: f64, e: f64, x: f64) -> f64 {
    let bx = b * x;
    d * m::sin(c * m::atan(bx - e * (bx - m::atan(bx))))
}

/// The cosine variant used for the pneumatic trail and the combined-slip
/// weighting functions: `D · cos(C · atan(B·x − E·(B·x − atan(B·x))))`.
#[inline]
pub fn magic_cos(b: f64, c: f64, d: f64, e: f64, x: f64) -> f64 {
    let bx = b * x;
    d * m::cos(c * m::atan(bx - e * (bx - m::atan(bx))))
}

/// A fully specified curve with the slope at the origin available.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MagicCurve {
    pub b: f64,
    pub c: f64,
    pub d: f64,
    pub e: f64,
}

impl MagicCurve {
    /// Build a curve from feel-style parameters (ADR-0008).
    ///
    /// * `peak` – the peak value `D`.
    /// * `stiffness` – the slope at the origin, `B·C·D`.
    /// * `peak_x` – where the peak should occur.
    /// * `falloff` – the ratio of the asymptotic (sliding) value to the peak.
    ///
    /// `C` follows from the falloff because the curve tends to `D·sin(C·π/2)`
    /// for large `x`. `E` is then solved so that the peak sits at `peak_x`,
    /// and clamped to at most 1 so the shape stays well behaved. If the
    /// stiffness is too low for the peak to be reachable at `peak_x`, `E`
    /// becomes negative, which is allowed and simply moves the peak outward.
    pub fn from_feel(peak: f64, stiffness: f64, peak_x: f64, falloff: f64) -> Self {
        let d = m::max(peak, 1e-9);
        let falloff = m::clamp(falloff, 0.05, 0.999);
        let c = 2.0 - (2.0 / m::PI) * m::asin(falloff);
        let b = m::max(stiffness, 1e-9) / (c * d);
        let bx = b * m::max(peak_x, 1e-9);
        let denom = bx - m::atan(bx);
        let target = m::tan(m::PI / (2.0 * c));
        let e = if denom > 1e-12 {
            (bx - target) / denom
        } else {
            0.0
        };
        let e = m::min(e, 1.0);
        Self { b, c, d, e }
    }

    #[inline]
    pub fn eval(&self, x: f64) -> f64 {
        magic(self.b, self.c, self.d, self.e, x)
    }

    /// Slope at the origin, `B·C·D`.
    #[inline]
    pub fn stiffness(&self) -> f64 {
        self.b * self.c * self.d
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn feel_curve_peaks_where_asked() {
        let c = MagicCurve::from_feel(1.0, 20.0, 0.12, 0.8);
        let mut best_x = 0.0;
        let mut best_y = 0.0;
        let mut x = 0.0;
        while x < 1.0 {
            let y = c.eval(x);
            if y > best_y {
                best_y = y;
                best_x = x;
            }
            x += 0.0005;
        }
        assert!((best_x - 0.12).abs() < 0.005, "peak at {best_x}");
        assert!((best_y - 1.0).abs() < 1e-3, "peak value {best_y}");
        // Asymptote equals peak * falloff.
        assert!((c.eval(50.0) - 0.8).abs() < 0.02);
        // Slope at origin.
        let slope = c.eval(1e-6) / 1e-6;
        assert!((slope - 20.0).abs() < 1e-3, "slope {slope}");
    }

    #[test]
    fn feel_curve_is_odd() {
        let c = MagicCurve::from_feel(1.2, 15.0, 0.1, 0.7);
        for i in 1..50 {
            let x = i as f64 * 0.02;
            assert_eq!(c.eval(x), -c.eval(-x));
        }
    }
}
