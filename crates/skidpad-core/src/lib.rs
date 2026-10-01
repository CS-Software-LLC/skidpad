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
//! Two vehicle models run that pipeline: the planar single-track ("bicycle")
//! model of milestone 1, kept as the cheap level-of-detail model, and the
//! four-wheel model of milestone 2 with independent suspension on a
//! six-degree-of-freedom chassis proxy that an external host can drive.
//! Later milestones replace stages (drivetrain, steering geometry) without
//! changing the shape.
//!
//! Units are SI throughout: metres, kilograms, seconds, newtons, radians.

#![forbid(unsafe_code)]
// The telemetry channel list is one recursive macro invocation per channel.
#![recursion_limit = "512"]
#![deny(clippy::disallowed_methods, clippy::disallowed_types)]
// Validation code writes `!(x > 0.0)` on purpose: the negated form is false
// for NaN, which is exactly what a validator wants to reject.
#![allow(clippy::neg_cmp_op_on_partial_ord)]

pub mod assists;
pub mod curve;
pub mod definition;
pub mod drivetrain;
pub mod geom;
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
pub use vehicle::VehicleModel;
pub use world::World;

/// Crate version, exposed through the WASM ABI.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Standard gravity, m/s².
pub const GRAVITY: f64 = 9.80665;

/// Sea-level air density at 15 °C, kg/m³.
pub const AIR_DENSITY: f64 = 1.225;
