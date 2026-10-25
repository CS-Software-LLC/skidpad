//! Surface table (milestone 6, ADR-0014): what the ground under each wheel
//! does to the tire. A host tags every wheel contact with a surface id
//! (`WheelContact::surface_id`, the last slot of the host-sync contact
//! record); the world holds a small fixed table that maps each id to a
//! grip scale, a rolling-resistance scale and a ploughing drag. The tire
//! models apply the scales inside their own equations, so the surface is
//! part of the physics and of every replay.
//!
//! Sources: friction coefficients by road surface from J. Y. Wong, *Theory
//! of Ground Vehicles*, ch. 1 (tires on hard surfaces) and T. D. Gillespie,
//! *Fundamentals of Vehicle Dynamics*, ch. 10 (tire-road friction, wet and
//! dry); the Magic Formula scales friction with `λμ` (Pacejka, *Tire and
//! Vehicle Dynamics*, §4.3.2), which is the shape the grip scale takes here.
//!
//! Road texture (ADR-0036): a surface can also carry a roughness, an ISO
//! 8608 road class given by its displacement spectral density at 0.1
//! cycles/m, and a grid of ridges such as a kerb's. Both are fixed heights
//! over the world's ground plane, so the same spot is the same bump every
//! lap and in every replay. Both are zero in the reference surface, which
//! then costs one comparison per wheel and leaves every result unchanged.

use skidpad_math as m;

/// Number of surfaces a table holds. Ids at or beyond it read as id 0.
pub const MAX_SURFACES: usize = 16;

/// One surface: dimensionless scales on the tire's friction and rolling
/// resistance, and a ploughing drag per newton of load.
#[derive(Clone, Copy, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct Surface {
    /// Scale on the tire's peak and sliding friction (`λμ`). 1 is the
    /// surface the tire was parameterised on, usually dry asphalt.
    pub grip: f64,
    /// Scale on the tire's rolling resistance.
    pub rolling_resistance: f64,
    /// Ploughing drag, N per N of load, opposing the contact-patch motion:
    /// the resistance of a surface the tire sinks into (gravel, sand,
    /// snow). It acts on the chassis at the contact, not on the wheel.
    pub drag: f64,
    /// Road roughness (ADR-0036): the ISO 8608 displacement spectral
    /// density at the reference spatial frequency 0.1 cycles/m, in
    /// 10⁻⁶ m³, the unit the standard's class table uses (class A up to
    /// 32, B 32–128, C 128–512, D 512–2048). Zero is perfectly smooth.
    pub roughness: f64,
    /// Height of the crests of a ridge grid, m, such as the ripples of a
    /// kerb or the setts of a cobbled road (ADR-0036). Zero for none.
    pub ridge_height: f64,
    /// Crest-to-crest spacing of the ridge grid, m.
    pub ridge_spacing: f64,
}

/// The road texture under a wheel ([`Surface::texture`]): the height above
/// the contact plane, m, and its slope along the world x and y axes.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Texture {
    pub height: f64,
    pub dx: f64,
    pub dy: f64,
}

/// The ISO 8608 spectrum `Gd(n) = Gd(n0)·(n/n0)⁻²` as a sum of cosines
/// over the world plane, for `Gd(n0)` = 10⁻⁶ m³ (ADR-0036): nine
/// half-octave bands from 0.25 to 4 cycles/m (wavelengths 4 m to 0.25 m;
/// longer ones are the circuit's own crests, shorter ones the tire
/// envelops), each split into three waves 60° apart so no direction of
/// travel is smooth. Each row is the wave vector (rad/m, x and y), the
/// amplitude (m) and the phase (rad); each band's three amplitudes carry
/// the band's variance `Gd(n)·Δn` between them. Generated once, so the
/// profile is the same on every platform. (Some entries land near π/4,
/// π/2 or π by construction, not because they are meant to be them.)
#[allow(clippy::approx_constant)]
const ROUGHNESS_WAVES: [[f64; 4]; 27] = [
    [
        1.5707963267948966,
        0.0,
        9.637575071894473e-05,
        3.141592653589793,
    ],
    [
        0.7853981633974485,
        1.3603495231756633,
        9.637575071894473e-05,
        0.43881949024811545,
    ],
    [
        -0.785398163397448,
        1.3603495231756635,
        9.637575071894473e-05,
        4.019231634086022,
    ],
    [
        -1.638021803771572,
        -1.5005621516330487,
        8.104202329694621e-05,
        1.601443607689442,
    ],
    [
        0.48051404138587134,
        -2.1688495698355146,
        8.104202329694621e-05,
        5.181855751527349,
    ],
    [
        2.118535845157443,
        -0.6682874182024662,
        8.104202329694621e-05,
        2.4790825881856717,
    ],
    [
        0.2746560145055641,
        3.1295636236998403,
        6.81479468753101e-05,
        0.061294561789091054,
    ],
    [
        -2.5729535936309635,
        1.8026408977139259,
        6.81479468753101e-05,
        3.6417067056269996,
    ],
    [
        -2.847609608136528,
        -1.326922725985914,
        6.81479468753101e-05,
        0.9389335422853191,
    ],
    [
        2.7032226343554973,
        -3.5258752376235383,
        5.730536423434883e-05,
        4.804330823068325,
    ],
    [
        4.405108843534227,
        0.5781218546251826,
        5.730536423434883e-05,
        2.101557659726647,
    ],
    [
        1.7018862091787326,
        4.103997092248721,
        5.730536423434883e-05,
        5.681969803564556,
    ],
    [
        -6.187137302715503,
        1.0944174713991721,
        4.8187875359472365e-05,
        3.264181777167975,
    ],
    [
        -4.041361983934966,
        -4.811009345154369,
        4.8187875359472365e-05,
        0.5614086138262975,
    ],
    [
        2.1457753187805406,
        -5.9054268165535415,
        4.8187875359472365e-05,
        4.141820757664206,
    ],
    [
        7.497412006605559,
        4.769239814888915,
        4.052101164847311e-05,
        1.7240327312676256,
    ],
    [
        -0.3815768331312141,
        8.877569167803335,
        4.052101164847311e-05,
        5.304444875105534,
    ],
    [
        -7.878988839736774,
        4.1083293529144225,
        4.052101164847311e-05,
        2.6016717117638564,
    ],
    [
        -3.2622839084752138,
        -12.13553353247946,
        3.407397343765505e-05,
        0.18388368536727037,
    ],
    [
        8.87853837336751,
        -8.892987505336457,
        3.407397343765505e-05,
        3.764295829205179,
    ],
    [
        12.140822281842729,
        3.242546027142998,
        3.407397343765505e-05,
        1.0615226658635013,
    ],
    [
        -8.191023824705487,
        15.771317939156718,
        2.8652682117174416e-05,
        4.926919946646507,
    ],
    [
        -17.753873898823702,
        0.7920242543798379,
        2.8652682117174416e-05,
        2.224146783304829,
    ],
    [
        -9.562850074118211,
        -14.979293684776888,
        2.8652682117174416e-05,
        5.804558927142738,
    ],
    [
        23.60771907113833,
        -8.621501141212619,
        2.4093937679736182e-05,
        3.3867709007461575,
    ],
    [
        19.270298542615826,
        16.13413387040585,
        2.4093937679736182e-05,
        0.6839977374044797,
    ],
    [
        -4.337420528522491,
        24.755635011618477,
        2.4093937679736182e-05,
        4.264409881242388,
    ],
];

/// Root-mean-square height of [`ROUGHNESS_WAVES`] for `Gd(n0)` = 10⁻⁶ m³,
/// the integral of the spectrum over the nine bands, m.
pub const ROUGHNESS_RMS_UNIT: f64 = 2.132_276_801_026_887_4e-4;

impl Default for Surface {
    fn default() -> Self {
        Surface::REFERENCE
    }
}

impl Surface {
    /// The surface the tire parameters describe: no scaling.
    pub const REFERENCE: Surface = Surface {
        grip: 1.0,
        rolling_resistance: 1.0,
        drag: 0.0,
        roughness: 0.0,
        ridge_height: 0.0,
        ridge_spacing: 0.0,
    };

    /// Largest roughness a table accepts, 10⁻⁶ m³: the top of ISO 8608
    /// class F, far rougher than any road a car is meant to drive.
    pub const MAX_ROUGHNESS: f64 = 8192.0;
    /// Largest ridge height a table accepts, m.
    pub const MAX_RIDGE_HEIGHT: f64 = 0.05;
    /// Shortest ridge spacing a table accepts, m: closer ridges than a
    /// contact patch is long would be bridged by the tire, which the
    /// point contact does not model.
    pub const MIN_RIDGE_SPACING: f64 = 0.1;

    /// Largest grip scale a table accepts.
    pub const MAX_GRIP: f64 = 5.0;
    /// Largest ploughing drag a table accepts, N per N.
    pub const MAX_DRAG: f64 = 1.0;

    pub fn validate(&self, prefix: &str, errors: &mut Vec<String>) {
        if !(self.grip >= 0.0 && self.grip <= Surface::MAX_GRIP) {
            errors.push(format!(
                "{prefix}.grip must be between 0 and {} (got {})",
                Surface::MAX_GRIP,
                self.grip
            ));
        }
        if !(self.rolling_resistance >= 0.0) || !self.rolling_resistance.is_finite() {
            errors.push(format!(
                "{prefix}.rollingResistance must be zero or positive (got {})",
                self.rolling_resistance
            ));
        }
        if !(self.drag >= 0.0 && self.drag <= Surface::MAX_DRAG) {
            errors.push(format!(
                "{prefix}.drag must be between 0 and {} (got {})",
                Surface::MAX_DRAG,
                self.drag
            ));
        }
        if !(self.roughness >= 0.0 && self.roughness <= Surface::MAX_ROUGHNESS) {
            errors.push(format!(
                "{prefix}.roughness must be between 0 and {} (got {})",
                Surface::MAX_ROUGHNESS,
                self.roughness
            ));
        }
        if !(self.ridge_height >= 0.0 && self.ridge_height <= Surface::MAX_RIDGE_HEIGHT) {
            errors.push(format!(
                "{prefix}.ridgeHeight must be between 0 and {} m (got {})",
                Surface::MAX_RIDGE_HEIGHT,
                self.ridge_height
            ));
        }
        if self.ridge_height > 0.0
            && !(self.ridge_spacing >= Surface::MIN_RIDGE_SPACING && self.ridge_spacing.is_finite())
        {
            errors.push(format!(
                "{prefix}.ridgeSpacing must be at least {} m when ridgeHeight is set (got {})",
                Surface::MIN_RIDGE_SPACING,
                self.ridge_spacing
            ));
        }
    }

    /// Whether the surface has any texture; a smooth one skips
    /// [`Self::texture`] entirely.
    #[inline]
    pub fn is_textured(&self) -> bool {
        self.roughness > 0.0 || self.ridge_height > 0.0
    }

    /// Road texture at world point (`x`, `y`) (ADR-0036): the roughness
    /// waves scaled by `√roughness`, plus the ridge grid
    /// `H·(r(x) + r(y))/2` with `r(u) = (1 − cos 2πu/λ)/2`, so a wheel
    /// rolling along either axis crosses crests of height `H/2` every `λ`
    /// and one rolling diagonally crests of `H` every `λ√2`.
    pub fn texture(&self, x: f64, y: f64) -> Texture {
        let mut t = Texture::default();
        if self.roughness > 0.0 {
            let scale = m::sqrt(self.roughness);
            for &[kx, ky, a, phase] in ROUGHNESS_WAVES.iter() {
                let arg = kx * x + ky * y + phase;
                let (s, c) = m::sin_cos(arg);
                t.height += a * c;
                t.dx -= a * kx * s;
                t.dy -= a * ky * s;
            }
            t.height *= scale;
            t.dx *= scale;
            t.dy *= scale;
        }
        if self.ridge_height > 0.0 && self.ridge_spacing > 0.0 {
            let k = m::TAU / self.ridge_spacing;
            let h = 0.25 * self.ridge_height;
            t.height += h * (2.0 - m::cos(k * x) - m::cos(k * y));
            t.dx += h * k * m::sin(k * x);
            t.dy += h * k * m::sin(k * y);
        }
        t
    }

    /// Ploughing drag force magnitude for a wheel at load `fz` moving at
    /// `speed` over the contact, N. Smooth through zero below `floor` so a
    /// parked car on gravel sees a viscous force, never a sign-switching one
    /// (the same treatment as rolling resistance, ADR-0005).
    #[inline]
    pub fn drag_force(&self, fz: f64, speed: f64, floor: f64) -> f64 {
        if self.drag <= 0.0 || fz <= 0.0 {
            return 0.0;
        }
        self.drag * fz * m::clamp(speed / m::max(floor, 1e-6), 0.0, 1.0)
    }
}

/// A fixed-size table of surfaces indexed by contact surface id.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SurfaceTable {
    surfaces: [Surface; MAX_SURFACES],
    len: usize,
}

impl Default for SurfaceTable {
    fn default() -> Self {
        SurfaceTable::REFERENCE
    }
}

impl SurfaceTable {
    /// Every id reads as the reference surface.
    pub const REFERENCE: SurfaceTable = SurfaceTable {
        surfaces: [Surface::REFERENCE; MAX_SURFACES],
        len: 1,
    };

    /// Build a table from a list; entry `i` is surface id `i`. Longer
    /// lists are truncated to [`MAX_SURFACES`], and id 0 of an empty list
    /// is the reference surface.
    pub fn from_slice(list: &[Surface]) -> Self {
        let mut t = SurfaceTable::REFERENCE;
        let n = list.len().min(MAX_SURFACES);
        t.surfaces[..n].copy_from_slice(&list[..n]);
        t.len = n.max(1);
        t
    }

    /// Validate every entry of a list before building a table.
    pub fn validate(list: &[Surface]) -> Result<(), Vec<String>> {
        let mut e = Vec::new();
        if list.len() > MAX_SURFACES {
            e.push(format!(
                "a surface table holds at most {MAX_SURFACES} surfaces (got {})",
                list.len()
            ));
        }
        for (i, s) in list.iter().enumerate().take(MAX_SURFACES) {
            s.validate(&format!("surfaces[{i}]"), &mut e);
        }
        if e.is_empty() {
            Ok(())
        } else {
            Err(e)
        }
    }

    /// Number of surfaces set.
    pub fn len(&self) -> usize {
        self.len
    }

    pub fn is_empty(&self) -> bool {
        false
    }

    /// The surface for a contact id. Ids beyond the table read as id 0,
    /// so a host may tag colliders with ids the application has not
    /// described yet without breaking anything.
    #[inline]
    pub fn get(&self, id: u32) -> &Surface {
        let i = id as usize;
        if i < self.len {
            &self.surfaces[i]
        } else {
            &self.surfaces[0]
        }
    }

    pub fn set(&mut self, id: usize, surface: Surface) -> bool {
        if id >= MAX_SURFACES {
            return false;
        }
        self.surfaces[id] = surface;
        if id >= self.len {
            self.len = id + 1;
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_ids_read_as_the_first_surface() {
        let ice = Surface {
            grip: 0.1,
            rolling_resistance: 0.8,
            drag: 0.0,
            ..Surface::REFERENCE
        };
        let t = SurfaceTable::from_slice(&[Surface::REFERENCE, ice]);
        assert_eq!(t.get(1).grip, 0.1);
        assert_eq!(t.get(7).grip, 1.0);
        assert_eq!(t.get(u32::MAX).grip, 1.0);
        let t = SurfaceTable::from_slice(&[]);
        assert_eq!(t.get(0), &Surface::REFERENCE);
    }

    #[test]
    fn drag_is_smooth_through_zero() {
        let gravel = Surface {
            grip: 0.6,
            rolling_resistance: 2.0,
            drag: 0.05,
            ..Surface::REFERENCE
        };
        assert_eq!(gravel.drag_force(1000.0, 0.0, 0.5), 0.0);
        assert!((gravel.drag_force(1000.0, 0.25, 0.5) - 25.0).abs() < 1e-12);
        assert!((gravel.drag_force(1000.0, 10.0, 0.5) - 50.0).abs() < 1e-12);
        assert_eq!(Surface::REFERENCE.drag_force(1000.0, 10.0, 0.5), 0.0);
    }

    #[test]
    fn the_roughness_waves_follow_the_iso_8608_spectrum() {
        // Each band's three waves carry `Gd(n)·Δn` of variance, with
        // `Gd(n) = Gd(n0)·(n0/n)²`, n0 = 0.1 cycles/m, Gd(n0) = 10⁻⁶ m³.
        let mut total = 0.0;
        for band in ROUGHNESS_WAVES.chunks(3) {
            let n = m::hypot(band[0][0], band[0][1]) / m::TAU;
            for w in band {
                assert!((m::hypot(w[0], w[1]) / m::TAU - n).abs() < 1e-12);
            }
            let dn = n * (m::pow(2.0, 0.25) - m::pow(2.0, -0.25));
            let want = 1e-6 * (0.1 / n) * (0.1 / n) * dn;
            let var: f64 = band.iter().map(|w| 0.5 * w[2] * w[2]).sum();
            assert!(
                (var - want).abs() < 1e-12 * want,
                "band {n}: {var} vs {want}"
            );
            total += var;
        }
        let first = m::hypot(ROUGHNESS_WAVES[0][0], ROUGHNESS_WAVES[0][1]) / m::TAU;
        let last = m::hypot(ROUGHNESS_WAVES[26][0], ROUGHNESS_WAVES[26][1]) / m::TAU;
        assert!((first - 0.25).abs() < 1e-12 && (last - 4.0).abs() < 1e-12);
        assert!((m::sqrt(total) - ROUGHNESS_RMS_UNIT).abs() < 1e-15);
    }

    #[test]
    fn the_sampled_profile_has_the_class_rms_along_any_line() {
        // ISO class B (64): about 1.7 mm RMS over the modelled bands.
        let s = Surface {
            roughness: 64.0,
            ..Surface::REFERENCE
        };
        let want = ROUGHNESS_RMS_UNIT * 8.0;
        for heading in [0.0, 0.7, 2.0] {
            let (c, sn) = (m::cos(heading), m::sin(heading));
            let (mut sum, mut sq, n) = (0.0, 0.0, 200_000);
            for k in 0..n {
                let d = k as f64 * 0.01;
                let h = s.texture(13.0 + d * c, -7.0 + d * sn).height;
                sum += h;
                sq += h * h;
            }
            let mean = sum / n as f64;
            let rms = m::sqrt(sq / n as f64 - mean * mean);
            assert!(mean.abs() < 0.05 * want, "{heading}: mean {mean}");
            assert!((rms / want - 1.0).abs() < 0.1, "{heading}: {rms} vs {want}");
        }
    }

    #[test]
    fn the_texture_slope_is_the_derivative_of_its_height() {
        let s = Surface {
            roughness: 256.0,
            ridge_height: 0.01,
            ridge_spacing: 0.4,
            ..Surface::REFERENCE
        };
        let e = 1e-6;
        for &(x, y) in &[(0.0, 0.0), (3.3, -1.2), (-120.5, 47.25)] {
            let t = s.texture(x, y);
            let dx = (s.texture(x + e, y).height - s.texture(x - e, y).height) / (2.0 * e);
            let dy = (s.texture(x, y + e).height - s.texture(x, y - e).height) / (2.0 * e);
            assert!((t.dx - dx).abs() < 1e-7, "{} vs {dx}", t.dx);
            assert!((t.dy - dy).abs() < 1e-7, "{} vs {dy}", t.dy);
        }
    }

    #[test]
    fn ridges_crest_at_their_height_and_a_smooth_surface_is_flat() {
        let s = Surface {
            ridge_height: 0.012,
            ridge_spacing: 0.5,
            ..Surface::REFERENCE
        };
        assert_eq!(s.texture(0.0, 0.0).height, 0.0);
        assert!((s.texture(0.25, 0.0).height - 0.006).abs() < 1e-15);
        assert!((s.texture(0.25, 0.25).height - 0.012).abs() < 1e-15);
        assert!(!Surface::REFERENCE.is_textured());
        assert_eq!(Surface::REFERENCE.texture(4.0, 5.0), Texture::default());
    }

    #[test]
    fn bad_texture_is_rejected() {
        let mut e = Vec::new();
        Surface {
            roughness: -1.0,
            ..Surface::REFERENCE
        }
        .validate("s", &mut e);
        Surface {
            ridge_height: 0.01,
            ridge_spacing: 0.05,
            ..Surface::REFERENCE
        }
        .validate("s", &mut e);
        Surface {
            ridge_height: f64::NAN,
            ..Surface::REFERENCE
        }
        .validate("s", &mut e);
        assert_eq!(e.len(), 3, "{e:?}");
    }
}
