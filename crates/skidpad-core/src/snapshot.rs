//! Versioned binary snapshots and state hashing.
//!
//! A snapshot is `magic (4 bytes) | version (u32 LE) | count (u32 LE) |
//! count × f64 LE`. Restoring a snapshot reproduces the simulation state bit
//! for bit; continuing from it matches an uninterrupted run exactly.

use skidpad_math::StateHasher;

pub const MAGIC: &[u8; 4] = b"SKID";
pub const VERSION: u32 = 6;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SnapshotError {
    TooShort,
    BadMagic,
    UnsupportedVersion(u32),
    WrongLength { expected: usize, got: usize },
}

impl core::fmt::Display for SnapshotError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            SnapshotError::TooShort => write!(f, "snapshot is too short"),
            SnapshotError::BadMagic => write!(f, "snapshot magic does not match"),
            SnapshotError::UnsupportedVersion(v) => {
                write!(f, "snapshot version {v} is not supported")
            }
            SnapshotError::WrongLength { expected, got } => {
                write!(
                    f,
                    "snapshot holds {got} values but this vehicle needs {expected}"
                )
            }
        }
    }
}

/// Anything whose state is a fixed list of `f64` values.
pub trait Snapshottable {
    /// Number of `f64` values in the state.
    fn state_len(&self) -> usize;
    /// Write the state values in a fixed order.
    fn write_state(&self, out: &mut [f64]);
    /// Read the state values back in the same order.
    fn read_state(&mut self, values: &[f64]);

    /// Encoded byte length of a snapshot.
    fn snapshot_len(&self) -> usize {
        12 + 8 * self.state_len()
    }

    /// Encode into `out`. Returns the number of bytes written, or the number
    /// needed if `out` is too small (in which case nothing is written).
    fn snapshot_into(&self, out: &mut [u8], scratch: &mut [f64]) -> usize {
        let n = self.state_len();
        let need = 12 + 8 * n;
        if out.len() < need || scratch.len() < n {
            return need;
        }
        out[0..4].copy_from_slice(MAGIC);
        out[4..8].copy_from_slice(&VERSION.to_le_bytes());
        out[8..12].copy_from_slice(&(n as u32).to_le_bytes());
        self.write_state(&mut scratch[..n]);
        for (i, v) in scratch[..n].iter().enumerate() {
            let o = 12 + 8 * i;
            out[o..o + 8].copy_from_slice(&v.to_le_bytes());
        }
        need
    }

    fn restore_from(&mut self, bytes: &[u8], scratch: &mut [f64]) -> Result<(), SnapshotError> {
        if bytes.len() < 12 {
            return Err(SnapshotError::TooShort);
        }
        if &bytes[0..4] != MAGIC {
            return Err(SnapshotError::BadMagic);
        }
        let version = u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]);
        if version != VERSION {
            return Err(SnapshotError::UnsupportedVersion(version));
        }
        let count = u32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]) as usize;
        let expected = self.state_len();
        if count != expected || bytes.len() < 12 + 8 * count || scratch.len() < count {
            return Err(SnapshotError::WrongLength {
                expected,
                got: count,
            });
        }
        for (i, slot) in scratch[..count].iter_mut().enumerate() {
            let o = 12 + 8 * i;
            let mut b = [0u8; 8];
            b.copy_from_slice(&bytes[o..o + 8]);
            *slot = f64::from_le_bytes(b);
        }
        self.read_state(&scratch[..count]);
        Ok(())
    }

    /// FNV-1a hash of the state values. Fast enough to run every step.
    fn state_hash(&self, scratch: &mut [f64]) -> u64 {
        let n = self.state_len();
        self.write_state(&mut scratch[..n]);
        let mut h = StateHasher::new();
        h.write_u32(n as u32);
        for v in &scratch[..n] {
            h.write_f64(*v);
        }
        h.finish()
    }
}
