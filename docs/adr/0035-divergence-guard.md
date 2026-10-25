# ADR-0035: Runtime divergence guard

- Status: Proposed
- Date: 2026-10-25
- Supersedes / superseded by: none

## Context

Definitions are validated when they load, and proptest drives random cars
offline, but nothing watched a running car. A tuning value that passes
validation but that the integrator cannot hold (a near-rigid spring at a
60 Hz substep rate, say), a host adapter bug, or a NaN pedal from a host
could turn the state non-finite. NaN then spread silently into telemetry,
the state hash, an external body's impulses, and every later step. This was
item M9 ("NaN guards") of the October codebase review.

The guard has to be deterministic, cheap enough for 200-car worlds (the
bench gate fails at 1.15x), and must not change anything for a healthy car.

## Decision

After every host step `World::step` checks each stepped (not frozen)
vehicle:

- **Non-finite:** any value of the vehicle's state (what the snapshot
  holds, so what decides every later step) is NaN or infinite. Checked with
  one test on `Σ x·0`, which is ±0 for finite values and NaN otherwise.
- **Runaway:** still finite, but body speed above 1000 m/s, a yaw, roll or
  pitch rate above 100 rad/s, or a wheel spinning faster than 5000 rad/s.
  No car reaches these; an unstable integrator passes them a few steps
  before it overflows, so most blow-ups are caught here while the numbers
  still mean something.

A diverged vehicle is reset to rest (`VehicleModel::reset`) at its last
healthy planar pose `(x, y, yaw)`, keeping its clock; its path-following
driver starts over; its host-sync output is rewritten from the reset state,
so an external body gets zero impulse from the bad step. The world counts
it in `World::health(i)` (recoveries, the step count just after the last
one, the cause, and the first non-finite or runaway telemetry channel for
diagnosis) and in a new `Diverged` telemetry channel carrying the same
count. `World::clear_health(i)` forgets the record.

The last healthy pose is taken from the telemetry record after each healthy
step and after add, reset and restore. The guard is not part of the state:
snapshots and hashes are unchanged, and a recovery is as deterministic as
any other step.

Two host inputs that could inject NaN are closed at the source:
`VehicleInput::clamped` reads a non-finite value as zero (`clamp` passes NaN
through), and `World::step` ignores a NaN step length.

`BicycleVehicle::reset` now also clears its last-substep outputs (forces,
accelerations, assist telemetry), as the four-wheel model's mostly did, so
telemetry written straight after a reset shows a car at rest rather than
the values before it. The four-wheel reset clears its assist telemetry too.

## Alternatives considered

- **Reset, then freeze until the host resets the car.** Stops a broken
  tuning from resetting every step, but needs host code to get going again;
  the count already shows a looping tuning.
- **Report only.** Leaves NaN in the state, hash and impulses, which is the
  problem.
- **Clamp the offending values.** Hides the fault and leaves an
  inconsistent state.
- **Restore the last healthy full state.** Needs a per-vehicle state copy
  every step (up to 2 KB per car) and usually just diverges again from the
  same state.
- **Check every telemetry value as well.** A telemetry-only NaN would not
  corrupt the simulation, and resetting a healthy car for it would be worse
  than the bug.

## Consequences

- A blow-up in a long run, a server or a replay is a counted reset instead
  of a NaN world.
- Cost: one state copy and a few hundred flops per vehicle per host step;
  the bench comparison against main was within 1.6 % in every case. The
  WASM grew about 2 KB gzipped.
- The telemetry stride grows by one channel (`Diverged`, last).
- A vehicle under an external host is reset inside the core, but its host
  body keeps whatever motion it had: hosts should watch `Diverged` and reset
  their body too (the sandbox does).
- Tests: `crates/skidpad-core/tests/divergence_tests.rs` (NaN and runaway on
  both models, an unstable tuning, NaN inputs and step length, external
  impulses, drivers, determinism) and the `divergence guard` test in
  `packages/core/test/scale.test.ts`.
