//! Standard manoeuvres used for validation and regression. Each scenario is a
//! pure function of a definition and a configuration, so the Rust tests, the
//! Node CLI (through WASM), and the docs all run the same code.

pub mod parked;
pub mod straight_line;
pub mod understeer;

pub use parked::{ParkedConfig, ParkedResult};
pub use straight_line::{StraightLineConfig, StraightLineResult};
pub use understeer::{UndersteerConfig, UndersteerPoint, UndersteerResult};

/// Least-squares slope and intercept of `y` against `x`.
pub(crate) fn linear_fit(x: &[f64], y: &[f64]) -> (f64, f64) {
    let n = x.len().min(y.len());
    if n < 2 {
        return (0.0, y.first().copied().unwrap_or(0.0));
    }
    let nf = n as f64;
    let mut sx = 0.0;
    let mut sy = 0.0;
    for i in 0..n {
        sx += x[i];
        sy += y[i];
    }
    let mx = sx / nf;
    let my = sy / nf;
    let mut sxx = 0.0;
    let mut sxy = 0.0;
    for i in 0..n {
        let dx = x[i] - mx;
        sxx += dx * dx;
        sxy += dx * (y[i] - my);
    }
    if sxx <= 0.0 {
        return (0.0, my);
    }
    let slope = sxy / sxx;
    (slope, my - slope * mx)
}
