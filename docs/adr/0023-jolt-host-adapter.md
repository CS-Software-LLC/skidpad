# ADR-0023: A Jolt Physics host adapter on the same host contract

- Status: Accepted
- Date: 2026-10-01
- Supersedes / superseded by: none

## Context

The core does not own a rigid-body world; an external host integrates the
chassis and supplies the ground under each wheel (ADR-0002, ADR-0009).
`@skidpad/rapier` was the first host. Milestone 7 adds Jolt Physics, which
many game engines use (Godot's Jolt module, Babylon.js and three.js
projects through `jolt-physics`), to show the contract is not shaped
around Rapier and to give Babylon users a natural pairing.

## Decision

A new package, `@skidpad/jolt`, peer-depending on `jolt-physics`, with the
same shape as the Rapier adapter: `createChassisBody` and a
`JoltVehicle` with `beforeStep`, `afterStep`, `step`, `detach`. The
differences are Jolt's:

- **Pose at the centre of mass.** The adapter reads
  `GetCenterOfMassPosition`, so a chassis shape offset from the body origin
  still hands the core its centre of mass.
- **Mass and inertia provided.** The body overrides its mass properties with
  the definition's mass and principal inertia; the box shape only collides.
  Jolt's default linear and angular damping (0.05) and sleeping are turned
  off, so the core's forces, gravity and contacts are the only influences.
- **Forces, not impulses.** As with Rapier, the step's impulse is applied
  as a force and torque over the coming step; Jolt clears accumulated
  forces after every update, so nothing is reset by hand.
- **Rays through the narrow-phase query** with a closest-hit collector,
  filtered by the chassis body's object layer (so the rays hit what the
  chassis would collide with) and ignoring the chassis body itself. Jolt's
  ray direction carries the ray length. The normal comes from the hit
  body's `GetWorldSpaceSurfaceNormal`, the surface velocity from
  `GetPointVelocity` for non-static bodies.
- **Jolt-heap scratch.** Every object the per-step path needs is
  allocated once in the constructor and freed in `dispose`, so a step
  allocates nothing on either heap.
- **Frames.** Jolt is y-up by convention; the same fixed rotation as the
  Rapier adapter converts to the core's ISO frame, and `up: "z"` works too.

## Alternatives considered

- **Jolt's own `VehicleConstraint` with Skidpad tire forces.** Jolt has a
  wheeled-vehicle constraint with its own suspension and tire callbacks;
  using it would split the suspension and drivetrain between two models and
  break determinism across hosts. The ray-and-impulse contract keeps the
  whole vehicle in the core.
- **A shared host base class for Rapier and Jolt.** The two APIs differ
  in every call that matters (rays, forces, body state); a base class would
  hold only the frame conversion. The adapters keep their own copy of that
  small piece.

## Consequences

- Babylon.js and three.js projects on Jolt can drive Skidpad cars over real
  geometry; `examples/babylon` shows it.
- Jolt is not deterministic across browsers in general (its own float
  math), so a Jolt-hosted car is reproducible only as far as Jolt is; the
  core's own determinism contract covers the built-in host.
- Guarded by `packages/jolt/test/jolt.test.ts`: at rest at ride height with
  the full weight on the four tires, driving straight and turning in both
  up-axis conventions, and holding on a 10 % grade with the brakes.
