# ADR-0019: Level of detail by switching models at runtime

- Status: Accepted
- Date: 2026-10-01
- Supersedes / superseded by: none

## Context

Milestone 7 targets scenes with dozens to hundreds of cars: traffic, a
grid of opponents, a replay of a whole field. The four-wheel model costs
about five times the single-track model, and a car three hundred metres
behind the camera gets nothing out of suspension, roll, or a 1 kHz substep
rate. A definition already picks its model (`simulation.model`), but only
when the car is added; `setDefinition` with the other model rebuilds the car
at rest. A game needs to move a car between detail levels while it is
driving, in both directions, many times a second across the field, without
the car visibly jumping, and without breaking determinism or snapshots.

## Decision

Each vehicle in a world has a level of detail: `full` (the model the
definition asks for), `singleTrack` (the single-track model, whatever the
definition asks for) or `frozen` (not stepped at all). `World::set_lod`
changes it, with an optional substep-rate override that holds while at
that level (zero keeps the definition's rate).

Moving between the models rebuilds the vehicle as the other model and
carries its motion over: the planar pose, the planar velocity in the
heading frame, the yaw rate, the clock, the built-in surface id and ground
slope, the four drivetrain state values (engine speed, gear, shift timer,
clutch engagement; identical on both models), and the wheels. Going down,
an axle takes the mean speed and transient slips of its two wheels; going
up, each wheel takes its axle's speed less its share of the yaw rate,
`ω_axle − side · r · t/2 / R`, and the axle's transient slips. Going up, the
body starts level at its ride height and settles into roll and pitch over
a few hundred milliseconds; the speed and yaw rate do not jump.

The world keeps the authored definition per vehicle, so the running
model's definition is the authored one with `simulation.model` swapped, and
`setDefinition` at a reduced level keeps the level.

A frozen vehicle keeps its model, state, telemetry and clock, ignores its
inputs, and writes zero impulses for an external host. An externally hosted
vehicle can be frozen but not reduced, because the single-track model has no
host contract (ADR-0009).

Snapshots stay per model: a snapshot records its value count, and the two
models have different fixed counts (38 and 20). `World::restore` given a
well-formed snapshot of the other model switches the vehicle to that model
first and sets its level to match (`full` if that is the definition's
model, `singleTrack` otherwise; a frozen vehicle stays frozen). The
snapshot format does not change.

## Alternatives considered

- **A third, cheaper model for far cars** (a kinematic point mass on the
  path). Cheaper still, but a car dropped into it stops responding to
  inputs physically, and the single-track model already runs 200 cars at
  240 Hz in about 1.3 ms; frozen covers the cars that need nothing.
- **Running the full model at a lower substep rate only.** The override
  does exactly this, and is available at every level, but the four-wheel
  model's suspension needs a few hundred hertz to stay stable on stiff
  springs, so it alone does not reach the traffic budget.
- **Mapping the full state onto the single-track model and back exactly.**
  The single-track model has no roll, pitch or heave and one wheel per axle;
  no mapping recovers what it does not have. Carrying what both have and
  letting the body settle is what the player can see anyway.
- **Choosing the level inside the core from a camera position.** The core
  has no camera and should not grow one; the level is a game decision.
  `@skidpad/core` does ship a small distance-based chooser with hysteresis
  on top of `setLod`.
- **A snapshot format that stores the model kind.** The value count
  already identifies it, so the format and its version stay as they are.

## Consequences

- Traffic can run at the single-track cost and switch to the full model as
  it comes near, and parked cars cost nothing.
- A level change is a state change the application makes, like a reset:
  deterministic, but a replay must reproduce it at the same step. The
  replay recorder in `@skidpad/replay` records level changes with the inputs.
- Going up costs a short settling transient of the body. It is covered by
  `crates/skidpad-core/tests/lod_tests.rs`: speed within 1 m/s and yaw rate
  within 0.1 rad/s through the switch and the following half second, and
  the reduced car within 4 m of the full car after two seconds of steady
  cornering.
- The single-track model has no lateral load transfer, so a car reduced
  mid-corner runs a slightly different line; switch at distances where that
  cannot be seen.
