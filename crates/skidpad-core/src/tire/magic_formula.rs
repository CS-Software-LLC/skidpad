//! A well-defined subset of Pacejka's Magic Formula, version 5.2 ("PAC2002").
//!
//! Implemented from the published equations in H. B. Pacejka, *Tire and
//! Vehicle Dynamics*, 2nd ed. (2006), §4.3.2, equations 4.E1–4.E78, and the
//! original Bakker–Nyborg–Pacejka SAE 870421 paper. Not from any commercial
//! implementation (see `docs/clean-room.md`).
//!
//! Supported: pure longitudinal `Fx0`, pure lateral `Fy0`, combined-slip
//! weighting `Gxα` and `Gyκ` with the `SVyκ` offset, pure and combined
//! aligning moment `Mz` (pneumatic trail and residual moment), overturning
//! moment `Mx`, and rolling resistance moment `My`. Camber enters through the
//! `γ` terms of each equation. All `L*` scaling factors that appear in those
//! equations are honoured.
//!
//! Ignored, with a warning on import: turn slip (`PPY*`, `PDXP*`, `PKYP*`,
//! `PECP*`, `QDTP*`, `QCRP*`, `QBRP*`, `QDRP*`), the extended camber stiffness
//! terms of MF 6.x (`PKY4`–`PKY7`, `PVY*` beyond 4), inflation pressure (`PPX*`,
//! `PPY*`, `PPZ*`, `PPMX*`), contact-patch and belt dynamics (`[CONTACT_PATCH]`,
//! `[STRUCTURAL]`), and vertical stiffness (`[VERTICAL]` beyond `FZ0`).
//!
//! Sign convention is ISO 8855 (ADR-0007), the same as `.tir` files.

use super::{TireInput, TireOutput};
use crate::curve::{magic, magic_cos};
use skidpad_math as m;

macro_rules! mf_params {
    (
        $( #[$meta:meta] )*
        pub struct $name:ident {
            $( $(#[doc = $doc:expr])* $field:ident : $key:literal = $default:expr ),* $(,)?
        }
    ) => {
        $( #[$meta] )*
        pub struct $name {
            $( $(#[doc = $doc])* pub $field: f64, )*
        }

        impl Default for $name {
            fn default() -> Self {
                Self { $( $field: $default, )* }
            }
        }

        impl $name {
            /// Set a parameter by its `.tir` key. Returns `false` for keys this
            /// subset does not use.
            pub fn set_by_key(&mut self, key: &str, value: f64) -> bool {
                match key {
                    $( $key => { self.$field = value; true } )*
                    _ => false,
                }
            }

            /// All `.tir` keys this subset reads, in declaration order.
            pub const KEYS: &'static [&'static str] = &[ $( $key ),* ];
        }
    };
}

mf_params! {
    #[derive(Clone, Debug, PartialEq)]
    #[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
    #[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
    pub struct MagicFormulaParams {
        // Dimensions and references
        /// Unloaded radius `R0`, m.
        unloaded_radius: "UNLOADED_RADIUS" = 0.31,
        /// Nominal load `Fz0`, N.
        fz0: "FZ0" = 4000.0,
        /// Reference speed `V0` for the rolling resistance speed terms, m/s.
        longvl: "LONGVL" = 16.7,
        // Scaling factors
        lfzo: "LFZO" = 1.0,
        lcx: "LCX" = 1.0,
        lmux: "LMUX" = 1.0,
        lex: "LEX" = 1.0,
        lkx: "LKX" = 1.0,
        lhx: "LHX" = 1.0,
        lvx: "LVX" = 1.0,
        lcy: "LCY" = 1.0,
        lmuy: "LMUY" = 1.0,
        ley: "LEY" = 1.0,
        lky: "LKY" = 1.0,
        lhy: "LHY" = 1.0,
        lvy: "LVY" = 1.0,
        lgay: "LGAY" = 1.0,
        ltr: "LTR" = 1.0,
        lres: "LRES" = 1.0,
        lgaz: "LGAZ" = 1.0,
        lxal: "LXAL" = 1.0,
        lyka: "LYKA" = 1.0,
        lvyka: "LVYKA" = 1.0,
        ls: "LS" = 1.0,
        lmx: "LMX" = 1.0,
        lvmx: "LVMX" = 1.0,
        lmy: "LMY" = 1.0,
        // Longitudinal
        pcx1: "PCX1" = 1.6,
        pdx1: "PDX1" = 1.0,
        pdx2: "PDX2" = -0.08,
        pdx3: "PDX3" = 0.0,
        pex1: "PEX1" = 0.3,
        pex2: "PEX2" = 0.0,
        pex3: "PEX3" = 0.0,
        pex4: "PEX4" = 0.0,
        pkx1: "PKX1" = 22.0,
        pkx2: "PKX2" = 0.0,
        pkx3: "PKX3" = -0.2,
        phx1: "PHX1" = 0.0,
        phx2: "PHX2" = 0.0,
        pvx1: "PVX1" = 0.0,
        pvx2: "PVX2" = 0.0,
        rbx1: "RBX1" = 12.0,
        rbx2: "RBX2" = 10.0,
        rcx1: "RCX1" = 1.0,
        rex1: "REX1" = 0.0,
        rex2: "REX2" = 0.0,
        rhx1: "RHX1" = 0.0,
        // Lateral
        pcy1: "PCY1" = 1.3,
        pdy1: "PDY1" = 1.0,
        pdy2: "PDY2" = -0.1,
        pdy3: "PDY3" = 0.0,
        pey1: "PEY1" = -0.8,
        pey2: "PEY2" = 0.0,
        pey3: "PEY3" = 0.0,
        pey4: "PEY4" = 0.0,
        pky1: "PKY1" = -18.0,
        pky2: "PKY2" = 2.0,
        pky3: "PKY3" = 0.0,
        phy1: "PHY1" = 0.0,
        phy2: "PHY2" = 0.0,
        phy3: "PHY3" = 0.0,
        pvy1: "PVY1" = 0.0,
        pvy2: "PVY2" = 0.0,
        pvy3: "PVY3" = 0.0,
        pvy4: "PVY4" = 0.0,
        rby1: "RBY1" = 7.0,
        rby2: "RBY2" = 2.5,
        rby3: "RBY3" = 0.0,
        rcy1: "RCY1" = 1.0,
        rey1: "REY1" = 0.0,
        rey2: "REY2" = 0.0,
        rhy1: "RHY1" = 0.0,
        rhy2: "RHY2" = 0.0,
        rvy1: "RVY1" = 0.0,
        rvy2: "RVY2" = 0.0,
        rvy3: "RVY3" = 0.0,
        rvy4: "RVY4" = 0.0,
        rvy5: "RVY5" = 1.9,
        rvy6: "RVY6" = -10.0,
        // Aligning
        qbz1: "QBZ1" = 8.0,
        qbz2: "QBZ2" = 0.0,
        qbz3: "QBZ3" = 0.0,
        qbz4: "QBZ4" = 0.0,
        qbz5: "QBZ5" = 0.0,
        qbz9: "QBZ9" = 0.0,
        qbz10: "QBZ10" = 0.0,
        qcz1: "QCZ1" = 1.1,
        qdz1: "QDZ1" = 0.1,
        qdz2: "QDZ2" = 0.0,
        qdz3: "QDZ3" = 0.0,
        qdz4: "QDZ4" = 0.0,
        qdz6: "QDZ6" = 0.0,
        qdz7: "QDZ7" = 0.0,
        qdz8: "QDZ8" = 0.0,
        qdz9: "QDZ9" = 0.0,
        qez1: "QEZ1" = 0.0,
        qez2: "QEZ2" = 0.0,
        qez3: "QEZ3" = 0.0,
        qez4: "QEZ4" = 0.0,
        qez5: "QEZ5" = 0.0,
        qhz1: "QHZ1" = 0.0,
        qhz2: "QHZ2" = 0.0,
        qhz3: "QHZ3" = 0.0,
        qhz4: "QHZ4" = 0.0,
        ssz1: "SSZ1" = 0.0,
        ssz2: "SSZ2" = 0.0,
        ssz3: "SSZ3" = 0.0,
        ssz4: "SSZ4" = 0.0,
        // Overturning
        qsx1: "QSX1" = 0.0,
        qsx2: "QSX2" = 0.0,
        qsx3: "QSX3" = 0.0,
        // Rolling resistance
        qsy1: "QSY1" = 0.01,
        qsy2: "QSY2" = 0.0,
        qsy3: "QSY3" = 0.0,
        qsy4: "QSY4" = 0.0,
        // Skidpad additions (not in .tir; our own transient parameters)
        /// Longitudinal relaxation length, m. Not part of MF 5.2 `.tir` files;
        /// defaults are typical passenger-car values.
        relaxation_length_long: "SKIDPAD_RELAXATION_LENGTH_LONG" = 0.25,
        /// Lateral relaxation length, m.
        relaxation_length_lat: "SKIDPAD_RELAXATION_LENGTH_LAT" = 0.35,
        /// Speed floor for the kinematic slip, m/s (ADR-0005, ADR-0010).
        low_speed_floor: "SKIDPAD_LOW_SPEED_FLOOR" = 0.5,
        /// Damping ratio of the contact-patch spring on the corner mass at
        /// standstill (ADR-0010, Pacejka §8.6 low-speed damping).
        low_speed_damping: "SKIDPAD_LOW_SPEED_DAMPING" = 0.7,
        /// Rolling speed at which the low-speed damping has faded to zero,
        /// m/s (ADR-0010).
        low_speed_damping_fade: "SKIDPAD_LOW_SPEED_DAMPING_FADE" = 2.0,
    }
}

impl MagicFormulaParams {
    #[inline]
    fn fz0_prime(&self) -> f64 {
        m::max(self.fz0 * self.lfzo, 1.0)
    }

    #[inline]
    fn dfz(&self, fz: f64) -> f64 {
        let f = self.fz0_prime();
        (fz - f) / f
    }

    /// `Kxκ`, N (eq. 4.E15).
    #[inline]
    pub fn longitudinal_stiffness(&self, fz: f64) -> f64 {
        let dfz = self.dfz(fz);
        fz * (self.pkx1 + self.pkx2 * dfz) * m::exp(self.pkx3 * dfz) * self.lkx
    }

    /// `Kyα`, N/rad (eq. 4.E25). Returns the magnitude; the ISO sign of
    /// `PKY1` makes the raw value negative.
    #[inline]
    pub fn cornering_stiffness(&self, fz: f64) -> f64 {
        m::abs(self.kya(fz, 0.0))
    }

    /// `Kyα` with camber (eq. 4.E25). `F'z0 = λFz0·Fz0` carries the
    /// nominal-load scale once; it is not applied again.
    #[inline]
    fn kya(&self, fz: f64, gamma: f64) -> f64 {
        let f0 = self.fz0_prime();
        self.pky1
            * f0
            * m::sin(2.0 * m::atan(fz / (self.pky2 * f0)))
            * (1.0 - self.pky3 * m::abs(gamma))
            * self.lky
    }

    pub fn eval(&self, i: &TireInput) -> TireOutput {
        let fz = i.fz;
        if fz <= 0.0 {
            return TireOutput::default();
        }
        let f0 = self.fz0_prime();
        let dfz = self.dfz(fz);
        let kappa = i.slip_ratio;
        let alpha = i.slip_angle;
        let gamma = i.camber;
        let gamma_y = gamma * self.lgay;
        let gamma_z = gamma * self.lgaz;
        let r0 = self.unloaded_radius;
        // The surface's grip scale multiplies the friction scaling factors
        // `λμx`, `λμy` (ADR-0014), which is where Pacejka puts a change of
        // road surface; everything else is untouched.
        let lmux = self.lmux * m::max(i.grip, 0.0);
        let lmuy = self.lmuy * m::max(i.grip, 0.0);

        // ---- Pure longitudinal, eq. 4.E9–4.E18 ----
        let shx = (self.phx1 + self.phx2 * dfz) * self.lhx;
        let kx = kappa + shx;
        let cx = self.pcx1 * self.lcx;
        let mux = (self.pdx1 + self.pdx2 * dfz) * (1.0 - self.pdx3 * gamma * gamma) * lmux;
        let dx = mux * fz;
        let ex = m::min(
            (self.pex1 + self.pex2 * dfz + self.pex3 * dfz * dfz)
                * (1.0 - self.pex4 * m::signum(kx))
                * self.lex,
            1.0,
        );
        let kxk = fz * (self.pkx1 + self.pkx2 * dfz) * m::exp(self.pkx3 * dfz) * self.lkx;
        let bx = kxk / m::max(cx * dx, 1e-9);
        let svx = fz * (self.pvx1 + self.pvx2 * dfz) * self.lvx * lmux;
        let fx0 = magic(bx, cx, dx, ex, kx) + svx;

        // ---- Pure lateral, eq. 4.E19–4.E30 ----
        let kya = self.kya(fz, gamma_y);
        let shy = (self.phy1 + self.phy2 * dfz) * self.lhy + self.phy3 * gamma_y;
        let ay = alpha + shy;
        let cy = self.pcy1 * self.lcy;
        let muy = (self.pdy1 + self.pdy2 * dfz) * (1.0 - self.pdy3 * gamma_y * gamma_y) * lmuy;
        let dy = muy * fz;
        let ey = m::min(
            (self.pey1 + self.pey2 * dfz)
                * (1.0 - (self.pey3 + self.pey4 * gamma_y) * m::signum(ay))
                * self.ley,
            1.0,
        );
        let by = kya / m::max(cy * dy, 1e-9);
        let svy = fz
            * ((self.pvy1 + self.pvy2 * dfz) * self.lvy + (self.pvy3 + self.pvy4 * dfz) * gamma_y)
            * lmuy;
        let fy0 = magic(by, cy, dy, ey, ay) + svy;

        // ---- Combined slip, eq. 4.E50–4.E67 ----
        let bxa = self.rbx1 * m::cos(m::atan(self.rbx2 * kappa)) * self.lxal;
        let cxa = self.rcx1;
        let exa = m::min(self.rex1 + self.rex2 * dfz, 1.0);
        let shxa = self.rhx1;
        let alpha_s = alpha + shxa;
        let gxa0 = magic_cos(bxa, cxa, 1.0, exa, shxa);
        let gxa =
            magic_cos(bxa, cxa, 1.0, exa, alpha_s) / if m::abs(gxa0) > 1e-9 { gxa0 } else { 1.0 };
        let gxa = m::max(gxa, 0.0);
        let fx = gxa * fx0;

        let byk = self.rby1 * m::cos(m::atan(self.rby2 * (alpha - self.rby3))) * self.lyka;
        let cyk = self.rcy1;
        let eyk = m::min(self.rey1 + self.rey2 * dfz, 1.0);
        let shyk = self.rhy1 + self.rhy2 * dfz;
        let kappa_s = kappa + shyk;
        let gyk0 = magic_cos(byk, cyk, 1.0, eyk, shyk);
        let gyk =
            magic_cos(byk, cyk, 1.0, eyk, kappa_s) / if m::abs(gyk0) > 1e-9 { gyk0 } else { 1.0 };
        let gyk = m::max(gyk, 0.0);
        let dvyk = muy
            * fz
            * (self.rvy1 + self.rvy2 * dfz + self.rvy3 * gamma)
            * m::cos(m::atan(self.rvy4 * alpha));
        let svyk = dvyk * m::sin(self.rvy5 * m::atan(self.rvy6 * kappa)) * self.lvyka;
        let fy = gyk * fy0 + svyk;

        // ---- Aligning moment, eq. 4.E31–4.E49 and 4.E71–4.E78 ----
        let sht = self.qhz1 + self.qhz2 * dfz + (self.qhz3 + self.qhz4 * dfz) * gamma_z;
        let alpha_t = alpha + sht;
        let shf = shy + svy / if m::abs(kya) > 1e-9 { kya } else { 1e-9 };
        let alpha_r = alpha + shf;
        let bt = (self.qbz1 + self.qbz2 * dfz + self.qbz3 * dfz * dfz)
            * (1.0 + self.qbz4 * gamma_z + self.qbz5 * m::abs(gamma_z))
            * self.lky
            / m::max(lmuy, 1e-9);
        let ct = self.qcz1;
        let dt = fz
            * (self.qdz1 + self.qdz2 * dfz)
            * (1.0 + self.qdz3 * gamma_z + self.qdz4 * gamma_z * gamma_z)
            * (r0 / f0)
            * self.ltr;
        let br = self.qbz9 * self.lky / m::max(lmuy, 1e-9) + self.qbz10 * by * cy;
        let dr = fz
            * ((self.qdz6 + self.qdz7 * dfz) * self.lres + (self.qdz8 + self.qdz9 * dfz) * gamma_z)
            * r0
            * lmuy;

        // Equivalent slip angles for combined slip (eq. 4.E77, 4.E78).
        let ratio = kxk / if m::abs(kya) > 1e-9 { kya } else { 1e-9 };
        let ta = m::tan(alpha_t);
        let alpha_t_eq = m::copysign(
            m::atan(m::sqrt(ta * ta + ratio * ratio * kappa * kappa)),
            alpha_t,
        );
        let tr = m::tan(alpha_r);
        let alpha_r_eq = m::copysign(
            m::atan(m::sqrt(tr * tr + ratio * ratio * kappa * kappa)),
            alpha_r,
        );

        let et = m::min(
            (self.qez1 + self.qez2 * dfz + self.qez3 * dfz * dfz)
                * (1.0
                    + (self.qez4 + self.qez5 * gamma_z)
                        * (2.0 / m::PI)
                        * m::atan(bt * ct * alpha_t_eq)),
            1.0,
        );
        let cos_alpha = m::cos(alpha);
        let trail = magic_cos(bt, ct, dt, et, alpha_t_eq) * cos_alpha;
        let mzr = dr * m::cos(m::atan(br * alpha_r_eq)) * cos_alpha;
        let s = r0
            * (self.ssz1 + self.ssz2 * (fy / f0) + (self.ssz3 + self.ssz4 * dfz) * gamma_z)
            * self.ls;
        let fy_prime = fy - svyk;
        let mz = -trail * fy_prime + mzr + s * fx;

        // ---- Overturning and rolling resistance, eq. 4.E69, 4.E70 ----
        let mx =
            r0 * fz * (self.qsx1 * self.lvmx - self.qsx2 * gamma + self.qsx3 * fy / f0) * self.lmx;
        let v_ratio = i.vx / m::max(self.longvl, 1e-3);
        let my_mag = r0
            * fz
            * (self.qsy1
                + self.qsy2 * fx / f0
                + self.qsy3 * m::abs(v_ratio)
                + self.qsy4 * m::powi(v_ratio, 4))
            * self.lmy
            * m::max(i.rolling_resistance, 0.0);
        // Smooth through zero below the speed floor so a parked car never
        // sees a sign-switching torque (ADR-0005).
        let my = -m::clamp(i.vx / m::max(self.low_speed_floor, 1e-6), -1.0, 1.0) * my_mag;

        TireOutput {
            fx,
            fy,
            mz,
            mx,
            my,
            trail,
            fx_max: m::abs(dx),
            fy_max: m::abs(dy),
            // Large-slip asymptotes of the pure curves, `D·sin(C·π/2)`.
            fx_slide: m::abs(dx * m::sin(cx * m::FRAC_PI_2)),
            fy_slide: m::abs(dy * m::sin(cy * m::FRAC_PI_2)),
        }
    }

    pub fn validate(&self, prefix: &str, errors: &mut Vec<String>) {
        for (name, v) in [
            ("unloadedRadius", self.unloaded_radius),
            ("fz0", self.fz0),
            ("pcx1", self.pcx1),
            ("pcy1", self.pcy1),
            ("pdx1", self.pdx1),
            ("pdy1", self.pdy1),
            ("pkx1", self.pkx1),
            ("pky2", self.pky2),
            ("relaxationLengthLong", self.relaxation_length_long),
            ("relaxationLengthLat", self.relaxation_length_lat),
            ("lowSpeedFloor", self.low_speed_floor),
            ("lowSpeedDampingFade", self.low_speed_damping_fade),
        ] {
            if !(v > 0.0) || !v.is_finite() {
                errors.push(format!(
                    "{prefix}.{name} must be a positive number (got {v})"
                ));
            }
        }
        if !(self.low_speed_damping >= 0.0) || !self.low_speed_damping.is_finite() {
            errors.push(format!(
                "{prefix}.lowSpeedDamping must be zero or positive (got {})",
                self.low_speed_damping
            ));
        }
        if self.pky1 == 0.0 || !self.pky1.is_finite() {
            errors.push(format!(
                "{prefix}.pky1 must be non-zero (got {})",
                self.pky1
            ));
        }
        if self.pky1 > 0.0 {
            errors.push(format!(
                "{prefix}.pky1 is positive ({}); Skidpad uses the ISO sign convention in which PKY1 is negative. Flip the sign if the file uses the adapted-ISO convention (ADR-0007)",
                self.pky1
            ));
        }
    }
}
