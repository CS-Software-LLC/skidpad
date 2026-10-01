//! Small 3-D geometry types built on `skidpad_math` so every operation in the
//! four-wheel model stays bit-exact across platforms (ADR-0006). Nothing here
//! allocates; everything is `Copy`.
//!
//! Frames follow ISO 8855 (ADR-0007): x forward, y left, z up. A body
//! quaternion rotates body-frame vectors into the world frame.

use core::ops::{Add, Mul, Neg, Sub};
use skidpad_math as m;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Vec3 {
    pub const ZERO: Vec3 = Vec3 {
        x: 0.0,
        y: 0.0,
        z: 0.0,
    };
    pub const X: Vec3 = Vec3 {
        x: 1.0,
        y: 0.0,
        z: 0.0,
    };
    pub const Y: Vec3 = Vec3 {
        x: 0.0,
        y: 1.0,
        z: 0.0,
    };
    pub const Z: Vec3 = Vec3 {
        x: 0.0,
        y: 0.0,
        z: 1.0,
    };

    #[inline]
    pub const fn new(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z }
    }

    #[inline]
    pub fn scale(self, s: f64) -> Vec3 {
        Vec3::new(self.x * s, self.y * s, self.z * s)
    }

    #[inline]
    pub fn dot(self, o: Vec3) -> f64 {
        self.x * o.x + self.y * o.y + self.z * o.z
    }

    #[inline]
    pub fn cross(self, o: Vec3) -> Vec3 {
        Vec3::new(
            self.y * o.z - self.z * o.y,
            self.z * o.x - self.x * o.z,
            self.x * o.y - self.y * o.x,
        )
    }

    #[inline]
    pub fn length(self) -> f64 {
        m::sqrt(self.dot(self))
    }

    /// Unit vector, or zero when the length is (nearly) zero.
    #[inline]
    pub fn normalized(self) -> Vec3 {
        let l = self.length();
        if l > 1e-12 {
            self.scale(1.0 / l)
        } else {
            Vec3::ZERO
        }
    }

    #[inline]
    pub fn is_finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite() && self.z.is_finite()
    }
}

impl Add for Vec3 {
    type Output = Vec3;
    #[inline]
    fn add(self, o: Vec3) -> Vec3 {
        Vec3::new(self.x + o.x, self.y + o.y, self.z + o.z)
    }
}

impl Sub for Vec3 {
    type Output = Vec3;
    #[inline]
    fn sub(self, o: Vec3) -> Vec3 {
        Vec3::new(self.x - o.x, self.y - o.y, self.z - o.z)
    }
}

impl Neg for Vec3 {
    type Output = Vec3;
    #[inline]
    fn neg(self) -> Vec3 {
        Vec3::new(-self.x, -self.y, -self.z)
    }
}

impl Mul<f64> for Vec3 {
    type Output = Vec3;
    #[inline]
    fn mul(self, s: f64) -> Vec3 {
        self.scale(s)
    }
}

/// Unit quaternion `(x, y, z, w)`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Quat {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub w: f64,
}

impl Default for Quat {
    fn default() -> Self {
        Quat::IDENTITY
    }
}

impl Quat {
    pub const IDENTITY: Quat = Quat {
        x: 0.0,
        y: 0.0,
        z: 0.0,
        w: 1.0,
    };

    #[inline]
    pub const fn new(x: f64, y: f64, z: f64, w: f64) -> Self {
        Self { x, y, z, w }
    }

    /// Rotation of `angle` radians about a unit `axis`.
    pub fn from_axis_angle(axis: Vec3, angle: f64) -> Quat {
        let h = 0.5 * angle;
        let s = m::sin(h);
        Quat::new(axis.x * s, axis.y * s, axis.z * s, m::cos(h))
    }

    /// Yaw about +z (ISO: positive turns the nose toward +y, left).
    pub fn from_yaw(yaw: f64) -> Quat {
        Quat::from_axis_angle(Vec3::Z, yaw)
    }

    /// Body orientation from yaw, pitch, roll applied in that order (about
    /// z, then y, then x), right-hand rule throughout as in ISO 8855: positive
    /// pitch is nose down, positive roll lifts the left (+y) side. The
    /// telemetry channels `Roll` and `Pitch` use this decomposition.
    pub fn from_yaw_pitch_roll(yaw: f64, pitch: f64, roll: f64) -> Quat {
        Quat::from_yaw(yaw)
            * Quat::from_axis_angle(Vec3::Y, pitch)
            * Quat::from_axis_angle(Vec3::X, roll)
    }

    #[inline]
    pub fn conjugate(self) -> Quat {
        Quat::new(-self.x, -self.y, -self.z, self.w)
    }

    #[inline]
    pub fn normalized(self) -> Quat {
        let n = m::sqrt(self.x * self.x + self.y * self.y + self.z * self.z + self.w * self.w);
        if n > 1e-12 {
            let inv = 1.0 / n;
            Quat::new(self.x * inv, self.y * inv, self.z * inv, self.w * inv)
        } else {
            Quat::IDENTITY
        }
    }

    /// Rotate a body-frame vector into the world frame.
    #[inline]
    pub fn rotate(self, v: Vec3) -> Vec3 {
        // v' = v + 2 w (q × v) + 2 q × (q × v)
        let q = Vec3::new(self.x, self.y, self.z);
        let t = q.cross(v) * 2.0;
        v + t * self.w + q.cross(t)
    }

    /// Rotate a world-frame vector into the body frame.
    #[inline]
    pub fn inverse_rotate(self, v: Vec3) -> Vec3 {
        self.conjugate().rotate(v)
    }

    /// Integrate a body-frame angular velocity over `dt` (first order, then
    /// renormalised). Adequate at substep rates; the error is O(dt²).
    pub fn integrate(self, omega_body: Vec3, dt: f64) -> Quat {
        let h = 0.5 * dt;
        let d = Quat::new(omega_body.x * h, omega_body.y * h, omega_body.z * h, 0.0);
        let dq = self * d;
        Quat::new(self.x + dq.x, self.y + dq.y, self.z + dq.z, self.w + dq.w).normalized()
    }

    /// Yaw, pitch, roll (radians) in the convention of
    /// [`Quat::from_yaw_pitch_roll`].
    pub fn to_yaw_pitch_roll(self) -> (f64, f64, f64) {
        let (x, y, z, w) = (self.x, self.y, self.z, self.w);
        // Rotation matrix elements of R = Rz(yaw) Ry(pitch) Rx(roll).
        let r00 = 1.0 - 2.0 * (y * y + z * z);
        let r10 = 2.0 * (x * y + w * z);
        let r20 = 2.0 * (x * z - w * y);
        let r21 = 2.0 * (y * z + w * x);
        let r22 = 1.0 - 2.0 * (x * x + y * y);
        let pitch = -m::asin(m::clamp(r20, -1.0, 1.0));
        let yaw = m::atan2(r10, r00);
        let roll = m::atan2(r21, r22);
        (yaw, pitch, roll)
    }

    #[inline]
    pub fn is_finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite() && self.z.is_finite() && self.w.is_finite()
    }
}

/// Hamilton product `a * b` (apply `b` first, then `a`).
impl Mul for Quat {
    type Output = Quat;
    #[inline]
    fn mul(self, o: Quat) -> Quat {
        Quat::new(
            self.w * o.x + self.x * o.w + self.y * o.z - self.z * o.y,
            self.w * o.y - self.x * o.z + self.y * o.w + self.z * o.x,
            self.w * o.z + self.x * o.y - self.y * o.x + self.z * o.w,
            self.w * o.w - self.x * o.x - self.y * o.y - self.z * o.z,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn yaw_rotates_x_toward_y() {
        let q = Quat::from_yaw(m::FRAC_PI_2);
        let v = q.rotate(Vec3::X);
        assert!(
            close(v.x, 0.0) && close(v.y, 1.0) && close(v.z, 0.0),
            "{v:?}"
        );
        let back = q.inverse_rotate(v);
        assert!(close(back.x, 1.0) && close(back.y, 0.0));
    }

    #[test]
    fn euler_round_trip() {
        for &(yaw, pitch, roll) in &[(0.3, -0.1, 0.2), (-2.0, 0.4, -0.3), (3.0, 0.0, 0.0)] {
            let q = Quat::from_yaw_pitch_roll(yaw, pitch, roll);
            let (y2, p2, r2) = q.to_yaw_pitch_roll();
            assert!(
                close(y2, yaw) && close(p2, pitch) && close(r2, roll),
                "{yaw} {pitch} {roll} -> {y2} {p2} {r2}"
            );
        }
    }

    #[test]
    fn integrate_matches_axis_angle_for_small_steps() {
        let mut q = Quat::IDENTITY;
        let w = Vec3::new(0.0, 0.0, 1.0);
        for _ in 0..1000 {
            q = q.integrate(w, 0.001);
        }
        let (yaw, _, _) = q.to_yaw_pitch_roll();
        assert!((yaw - 1.0).abs() < 1e-6, "{yaw}");
    }

    #[test]
    fn positive_roll_lifts_left_side() {
        let q = Quat::from_yaw_pitch_roll(0.0, 0.0, 0.1);
        let left = q.rotate(Vec3::Y);
        assert!(left.z > 0.0);
        let q = Quat::from_yaw_pitch_roll(0.0, 0.1, 0.0);
        let nose = q.rotate(Vec3::X);
        assert!(nose.z < 0.0, "positive pitch is nose down");
    }
}
