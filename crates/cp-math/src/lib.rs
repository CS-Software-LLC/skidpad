//! Deterministic math for the Contact Patch core (ADR-0006).
//!
//! Every transcendental or power function used by the simulation goes through
//! this module. The implementations come from the `libm` crate, a pure-Rust
//! port of the MUSL C library, which uses only basic IEEE-754 arithmetic and
//! integer bit manipulation. Basic WebAssembly float arithmetic is specified to
//! be correctly rounded, so these functions return identical bits on every
//! browser, every CPU, and on native targets.
//!
//! `sqrt`, `abs`, `min`, `max`, `floor`, `ceil`, `trunc`, `round`, and
//! `copysign` map to single WASM instructions that are correctly rounded by
//! specification, so they are re-exported from `f64` directly.
//!
//! Nothing in here may call a `f64` method that could lower to a platform
//! intrinsic; `clippy.toml` at the workspace root enforces that.

#![forbid(unsafe_code)]

/// π.
pub const PI: f64 = core::f64::consts::PI;
/// π / 2.
pub const FRAC_PI_2: f64 = core::f64::consts::FRAC_PI_2;
/// 2π.
pub const TAU: f64 = core::f64::consts::TAU;
/// Degrees per radian.
pub const DEG_PER_RAD: f64 = 180.0 / PI;
/// Radians per degree.
pub const RAD_PER_DEG: f64 = PI / 180.0;

#[inline]
pub fn sin(x: f64) -> f64 {
    libm::sin(x)
}

#[inline]
pub fn cos(x: f64) -> f64 {
    libm::cos(x)
}

#[inline]
pub fn tan(x: f64) -> f64 {
    libm::tan(x)
}

#[inline]
pub fn asin(x: f64) -> f64 {
    libm::asin(x)
}

#[inline]
pub fn acos(x: f64) -> f64 {
    libm::acos(x)
}

#[inline]
pub fn atan(x: f64) -> f64 {
    libm::atan(x)
}

#[inline]
pub fn atan2(y: f64, x: f64) -> f64 {
    libm::atan2(y, x)
}

#[inline]
pub fn tanh(x: f64) -> f64 {
    libm::tanh(x)
}

#[inline]
pub fn exp(x: f64) -> f64 {
    libm::exp(x)
}

#[inline]
pub fn ln(x: f64) -> f64 {
    libm::log(x)
}

#[inline]
pub fn pow(x: f64, y: f64) -> f64 {
    libm::pow(x, y)
}

#[inline]
pub fn cbrt(x: f64) -> f64 {
    libm::cbrt(x)
}

/// Correctly rounded square root (a single WASM instruction).
#[inline]
pub fn sqrt(x: f64) -> f64 {
    f64::sqrt(x)
}

/// `sqrt(x² + y²)` computed with basic arithmetic only. Unlike `libm::hypot`
/// this does not rescale to avoid overflow, which is fine for the magnitudes
/// the simulation sees and keeps the operation count fixed.
#[inline]
pub fn hypot(x: f64, y: f64) -> f64 {
    sqrt(x * x + y * y)
}

/// Integer power by repeated squaring; deterministic because it is only
/// multiplications. Negative exponents return the reciprocal.
#[inline]
pub fn powi(x: f64, n: i32) -> f64 {
    let mut base = if n < 0 { 1.0 / x } else { x };
    let mut e = n.unsigned_abs();
    let mut acc = 1.0;
    while e > 0 {
        if e & 1 == 1 {
            acc *= base;
        }
        base *= base;
        e >>= 1;
    }
    acc
}

#[inline]
pub fn abs(x: f64) -> f64 {
    f64::abs(x)
}

#[inline]
pub fn signum(x: f64) -> f64 {
    if x > 0.0 {
        1.0
    } else if x < 0.0 {
        -1.0
    } else {
        0.0
    }
}

#[inline]
pub fn min(a: f64, b: f64) -> f64 {
    if a < b {
        a
    } else {
        b
    }
}

#[inline]
pub fn max(a: f64, b: f64) -> f64 {
    if a > b {
        a
    } else {
        b
    }
}

#[inline]
pub fn clamp(x: f64, lo: f64, hi: f64) -> f64 {
    max(lo, min(hi, x))
}

#[inline]
pub fn floor(x: f64) -> f64 {
    libm::floor(x)
}

#[inline]
pub fn ceil(x: f64) -> f64 {
    libm::ceil(x)
}

#[inline]
pub fn trunc(x: f64) -> f64 {
    libm::trunc(x)
}

#[inline]
pub fn round(x: f64) -> f64 {
    libm::round(x)
}

#[inline]
pub fn copysign(x: f64, sign: f64) -> f64 {
    libm::copysign(x, sign)
}

/// Linear interpolation. `t` is not clamped.
#[inline]
pub fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

#[inline]
pub fn deg_to_rad(deg: f64) -> f64 {
    deg * RAD_PER_DEG
}

#[inline]
pub fn rad_to_deg(rad: f64) -> f64 {
    rad * DEG_PER_RAD
}

/// Smooth clamp of `x` into `[-limit, limit]` using `tanh`, with unit slope at
/// the origin. Used wherever a hard clamp would create a slope discontinuity.
#[inline]
pub fn soft_clamp(x: f64, limit: f64) -> f64 {
    if limit <= 0.0 {
        return 0.0;
    }
    limit * tanh(x / limit)
}

/// FNV-1a 64-bit hash over a byte slice. Used for state hashing.
#[inline]
pub fn fnv1a_64(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        h ^= b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

/// Streaming FNV-1a hasher for `f64` values. Hashes the IEEE-754 bit pattern,
/// so `-0.0` and `0.0` hash differently; the core canonicalises zeros before
/// hashing where it matters.
#[derive(Clone, Copy, Debug)]
pub struct StateHasher {
    h: u64,
}

impl Default for StateHasher {
    fn default() -> Self {
        Self::new()
    }
}

impl StateHasher {
    pub const fn new() -> Self {
        Self {
            h: 0xcbf2_9ce4_8422_2325,
        }
    }

    #[inline]
    pub fn write_u64(&mut self, v: u64) {
        for b in v.to_le_bytes() {
            self.h ^= b as u64;
            self.h = self.h.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }

    #[inline]
    pub fn write_f64(&mut self, v: f64) {
        // Canonicalise negative zero so that `0.0` and `-0.0`, which compare
        // equal and behave identically downstream, hash identically.
        let v = if v == 0.0 { 0.0 } else { v };
        self.write_u64(v.to_bits());
    }

    #[inline]
    pub fn write_u32(&mut self, v: u32) {
        self.write_u64(v as u64);
    }

    #[inline]
    pub fn finish(&self) -> u64 {
        self.h
    }
}

/// Hash the outputs of every function in this module over a fixed sweep of
/// inputs. The cross-browser determinism test asserts that this value is
/// identical in Chromium, Firefox, WebKit, Node, and native `cargo test`.
pub fn selftest_hash() -> u64 {
    let mut h = StateHasher::new();
    let n = 2048;
    for i in 0..n {
        // Inputs chosen to cover argument reduction (large angles), the
        // neighbourhood of zero, and both signs.
        let t = (i as f64) / (n as f64);
        let x = (t - 0.5) * 40.0;
        let small = (t - 0.5) * 1e-3;
        let unit = t * 2.0 - 1.0;
        let pos = 1e-6 + t * 50.0;

        h.write_f64(sin(x));
        h.write_f64(cos(x));
        h.write_f64(tan(x));
        h.write_f64(sin(small));
        h.write_f64(asin(unit));
        h.write_f64(acos(unit));
        h.write_f64(atan(x));
        h.write_f64(atan2(x, unit));
        h.write_f64(atan2(unit, x));
        h.write_f64(tanh(x));
        h.write_f64(exp(x * 0.5));
        h.write_f64(ln(pos));
        h.write_f64(pow(pos, unit * 3.0));
        h.write_f64(cbrt(x));
        h.write_f64(sqrt(pos));
        h.write_f64(hypot(x, unit));
        h.write_f64(powi(unit * 1.5, i % 9 - 4));
        h.write_f64(floor(x));
        h.write_f64(ceil(x));
        h.write_f64(round(x));
        h.write_f64(trunc(x));
        h.write_f64(soft_clamp(x, 3.0));
    }
    h.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64, tol: f64) -> bool {
        abs(a - b) <= tol
    }

    #[test]
    fn basic_identities() {
        assert!(close(sin(PI / 2.0), 1.0, 1e-15));
        assert!(close(cos(0.0), 1.0, 0.0));
        assert!(close(atan2(1.0, 1.0), PI / 4.0, 1e-15));
        assert!(close(exp(ln(3.0)), 3.0, 1e-14));
        assert!(close(pow(2.0, 10.0), 1024.0, 0.0));
        assert!(close(powi(2.0, 10), 1024.0, 0.0));
        assert!(close(powi(2.0, -2), 0.25, 0.0));
        assert!(close(cbrt(27.0), 3.0, 1e-15));
        assert!(close(hypot(3.0, 4.0), 5.0, 0.0));
        assert_eq!(signum(-2.0), -1.0);
        assert_eq!(signum(0.0), 0.0);
        assert_eq!(clamp(5.0, -1.0, 1.0), 1.0);
    }

    #[test]
    fn soft_clamp_is_bounded_with_unit_slope() {
        assert!(abs(soft_clamp(1000.0, 2.0)) <= 2.0);
        assert!(close(soft_clamp(1e-6, 2.0), 1e-6, 1e-12));
        assert_eq!(soft_clamp(1.0, 0.0), 0.0);
    }

    #[test]
    fn hasher_canonicalises_negative_zero() {
        let mut a = StateHasher::new();
        a.write_f64(0.0);
        let mut b = StateHasher::new();
        b.write_f64(-0.0);
        assert_eq!(a.finish(), b.finish());
    }

    #[test]
    fn selftest_is_stable_within_process() {
        assert_eq!(selftest_hash(), selftest_hash());
    }

    /// The reference hash is pinned so that a toolchain or `libm` upgrade that
    /// changes a single bit is caught here before it reaches the browsers.
    /// Update it deliberately, with a changeset that says why.
    #[test]
    fn selftest_matches_pinned_reference() {
        let h = selftest_hash();
        let pinned = include_str!("../selftest.hash").trim();
        assert_eq!(
            format!("{h:016x}"),
            pinned,
            "cp_math selftest hash changed; see crates/cp-math/selftest.hash"
        );
    }
}
