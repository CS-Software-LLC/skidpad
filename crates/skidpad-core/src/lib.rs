//! # Skidpad core
//!
//! The entire vehicle simulation. This crate knows nothing about WebAssembly,
//! JavaScript, or any physics host. It is deterministic by construction
//! (ADR-0001, ADR-0006): no platform math, no hash-map iteration, no time or
//! randomness, and no allocation inside a step.
//!
//! The substep pipeline reads, in order:
//!
//! ```text
//! contacts → suspension → wheel loads → steering → drivetrain solve
//!   (tire forces as boundary conditions) → tire forces → aero
//!   → chassis proxy integration → telemetry
//! ```
//!
//! Milestone 1 implements that pipeline for a planar single-track ("bicycle")
//! vehicle on flat ground inside the built-in minimal host. Later milestones
//! replace stages (suspension, drivetrain) without changing the shape.
//!
//! Units are SI throughout: metres, kilograms, seconds, newtons, radians.

#![forbid(unsafe_code)]
#![deny(clippy::disallowed_methods, clippy::disallowed_types)]
// Validation code writes `!(x > 0.0)` on purpose: the negated form is false
// for NaN, which is exactly what a validator wants to reject.
#![allow(clippy::neg_cmp_op_on_partial_ord)]

pub mod curve;
pub mod definition;
pub mod input;
pub mod snapshot;
pub mod telemetry;
pub mod tire;
pub mod validation;
pub mod vehicle;
pub mod world;

pub use definition::VehicleDefinition;
pub use input::VehicleInput;
pub use tire::{TireInput, TireModel, TireOutput};
pub use world::World;

/// Crate version, exposed through the WASM ABI.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Standard gravity, m/s².
pub const GRAVITY: f64 = 9.80665;

/// Sea-level air density at 15 °C, kg/m³.
pub const AIR_DENSITY: f64 = 1.225;
