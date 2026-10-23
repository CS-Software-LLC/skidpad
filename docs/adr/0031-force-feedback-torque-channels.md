# ADR-0031: Force-feedback torque channels: the step mean and the breakdown

- Status: Proposed
- Date: 2026-10-23
- Supersedes / superseded by: extends the steering torque of ADR-0012

## Context

The core computes the hand-wheel torque every substep (1 kHz by default),
but a host reads telemetry once per host step (60 Hz in the sandbox), and
`SteeringTorque` holds the last substep's value. A wheel driven from it
sees a sample-and-hold of a 1 kHz signal at 60 Hz: anything above 30 Hz
(kerb strikes, wheel hop with unsprung mass, tire vibration near the limit)
folds down into random steps. That is the graininess that remained after
ADR-0029 and ADR-0030.

Tuning the steering is also blind: only the total torque is visible, so a
feel problem cannot be traced to the tire, the geometry, the assist or the
device's scaling.

## Decision

Six telemetry channels, appended to the layout:

- `SteeringTorqueMean`: the mean of the substeps' `SteeringTorque` over the
  host step, accumulated in `World::step` (not in the vehicle state, so no
  snapshot or hash changes). Outside a step (a reset, restore or level of
  detail change) it is the current value. The input package's
  `ffbFrameFromTelemetry` reads it instead of `SteeringTorque`.
- `SteerTorqueMz`, `SteerTorqueTrail`, `SteerTorqueScrub`, `SteerTorqueLift`:
  each kingpin-torque term of the steered wheels through the ratio, in the
  sign of the steer input, as the hand wheel would get it unassisted.
- `SteerTorqueAssist`: `SteeringTorque` less the manual torque, so the five
  sum to `SteeringTorque` up to rounding.

The breakdown is of the last substep, like `SteeringTorque`. The existing
totals are computed exactly as before; the parts are summed alongside.

A box mean over one host step is a first filter, not a reconstruction: it
removes most of the energy that would alias (a 40 Hz component is cut to
about 40 % at 60 Hz), but what remains still folds. Passing frequencies
above half the host rate needs the substep samples played out to the wheel
faster than the host rate, which is a host change built on top of this.

## Alternatives considered

- Accumulate the mean in each vehicle model. It would have to be reset and
  carried across level-of-detail switches and snapshots for no physical
  reason; the host step is the world's concept.
- A filter state in the core (a low-pass with a cutoff). It adds state to
  the snapshot and fixes a cutoff the host should choose.
- Only the host-side fix (reading every substep). It needs a per-substep
  buffer across the WASM boundary and still wants a sensible single value
  for hosts that read once a step.

## Consequences

- Determinism hashes do not move: the state and its arithmetic are
  unchanged; only telemetry grows by six channels.
- `the_mean_steering_torque_is_the_mean_over_the_substeps` checks the mean
  bit for bit against single-substep steps; `the_torque_breakdown_sums_to_the_steering_torque`
  checks the parts on both models with trail, lift and a boost-curve assist.
- The sandbox's wheel panel graphs requested against sent torque with
  clipping marked, the parts, and the peak per lap.
