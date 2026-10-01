# Driving a Rapier body

`@skidpad/rapier` lets a [Rapier](https://rapier.rs) rigid body be the car.
Rapier owns collisions, joints and everything else in the scene; Skidpad
computes what the tires and suspension do to the chassis and hands it back
once per step. The split is the chassis proxy of
[ADR-0002](https://github.com/csummers88/skidpad/blob/main/docs/adr/0002-chassis-proxy.md).

## The loop

Every host step, in this order:

1. `beforeStep()` copies the body's pose and velocities into the core and
   casts one ray per wheel, from the top of each strut down the body's
   vertical axis, to find the ground.
2. `world.step(dt)` runs the core, which substeps against its own copy of
   the chassis.
3. `afterStep(dt)` hands the step's net impulse to the body as a force and
   torque over the coming Rapier step.
4. `scene.step()` integrates the body with everything else.

`RapierVehicle.step(dt)` does the first three for a world with one vehicle.
With several vehicles in one Skidpad world, call `beforeStep` on each, step
the world once, then `afterStep` on each.

## Setting up

`createChassisBody` builds a dynamic body with the definition's mass and
inertia and a massless box collider for the chassis. Wheels have no
colliders: the rays are the wheels, so a car can drive over a kerb a box
collider would stop at. Rapier is axis-agnostic; pass `up: "y"` (default,
the three.js convention) or `up: "z"` and the adapter converts between the
scene's frame and the core's ISO frame.

Step the scene once after creating its colliders. Rapier's query pipeline
is empty until the first step, and the wheel rays would miss.

The sandbox's Rapier host (`apps/sandbox/src/sim.ts`) is the reference: a
ground box, speed bumps, a ramp and a kerb, with the same obstacles rendered
by three.js.

## Moving platforms and surfaces

The adapter reads the velocity of whatever body a ray hits at the hit point
and passes it to the core, so a car parked on a kinematic platform rides it,
and one with free wheels spins them like a dyno roller. Pass a `surfaceId`
callback to map colliders to surface ids ahead of the surface table of
milestone 6.

## Determinism

The core is bit-exact for a given sequence of body states and contacts. Rapier
is deterministic across platforms only in its enhanced-determinism build; the
Skidpad determinism harness therefore runs the built-in host. If you need
replays under Rapier, record the inputs and the host records together.
