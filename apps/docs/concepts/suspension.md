# Suspension and the four-wheel model

The default vehicle model has four wheels, each on its own strut, over a
chassis that is free to heave, pitch and roll. It is the model the sandbox
drives and the one an external physics engine hosts; the
[single-track model](/concepts/load-transfer#understeer-gradient) remains
available as `simulation.model: "singleTrack"` for traffic and as the
analytic cross-check.

## A strut per corner

Each corner is a ray from the top of its travel straight down the body's
vertical axis. Where the ray meets the ground sets the compression, measured
from the static ride position: positive is bump (compressed), negative is
droop (extended). From that come four forces, all per wheel:

- **Spring**, `springRate × (static compression + travel)`. The static
  compression is the corner's static load over its spring rate, so the car
  always sits at `chassis.cgHeight` at rest and the spring rate only changes
  how stiffly it moves from there.
- **Damper**, `bumpDamping` or `reboundDamping` times the compression rate,
  depending on its sign. Rebound is usually the stiffer of the two.
- **Anti-roll bar**, `antiRollStiffness` times the difference between this
  wheel's travel and the other wheel's on the same axle. It only acts when
  the two sides move differently, which is why it adds roll stiffness
  without adding ride stiffness.
- **Bump stop**, `bumpStopStiffness` times the travel beyond `travelBump`.

The sum, never negative because the ground cannot pull, is the strut force.
Its component along the contact normal is the tire's vertical load, which is
what the [tire model](/concepts/slip) sees.

There is no unsprung mass: the wheel is massless and rigid. The only vertical
modes are the body's own, at a few hertz, so the model stays stable at every
substep rate the core supports. Wheel hop and kerb strikes arrive with an
unsprung-mass option later ([ADR-0009](https://github.com/csummers88/skidpad/blob/main/docs/adr/0009-raycast-suspension-and-host-contract.md)).

## What the body does

Tire forces act at the contact patches, at ground level, while the mass sits
`cgHeight` above them. Braking therefore pitches the nose down (dive),
accelerating pitches it up (squat), and cornering rolls the body toward the
outside of the turn. The telemetry channels `Roll`, `Pitch`, `PosZ`, the
rates, and the per-wheel `SuspTravel_*` and `SuspForce_*` channels show it.

Ride frequency is a useful handle: `f = √(k / m_corner) / 2π` with the
corner's share of the mass. Road cars sit around 1.2 to 1.6 Hz, sports cars
near 2 Hz, racing cars higher. The presets carry their ride frequencies in
their data sheets.

## Ackermann steering

With two steered wheels the inner wheel must steer more than the outer one
to roll about the same centre; otherwise the front tires fight each other
at parking speeds. `steering.ackermann` interpolates between parallel steer
(0) and ideal Ackermann (1). The per-wheel angles are the `WheelSteer_*`
channels.

## Camber

`staticCamberDeg` is quoted the way alignment sheets quote it: negative leans
the top of each wheel toward the centreline. Body roll adds to it at the
contact; `Camber_*` reports the resulting inclination in the tire's sign
convention.
