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
}

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
    };

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
        };
        assert_eq!(gravel.drag_force(1000.0, 0.0, 0.5), 0.0);
        assert!((gravel.drag_force(1000.0, 0.25, 0.5) - 25.0).abs() < 1e-12);
        assert!((gravel.drag_force(1000.0, 10.0, 0.5) - 50.0).abs() < 1e-12);
        assert_eq!(Surface::REFERENCE.drag_force(1000.0, 10.0, 0.5), 0.0);
    }
}
