# Steering and the force-feedback torque

The steer input sets the road-wheel angle through the steering ratio and
Ackermann fraction; what comes back is the torque the tires put on the hand
wheel, which is the signal a force-feedback wheel reproduces
([ADR-0012](https://github.com/CS-Software-LLC/skidpad/blob/main/docs/adr/0012-steering-geometry-and-rack-force.md)).

## Where the torque comes from

Each steered wheel turns about its kingpin axis, and three things put a
moment on that axis:

- the tire's **aligning moment**, from the pneumatic trail: the lateral
  force acts behind the contact centre and tries to straighten the wheel,
  growing with slip angle until the trail goes to zero near the grip peak
  ([combined slip](/concepts/combined-slip));
- the **mechanical trail** from caster (`steering.mechanicalTrail`): the
  kingpin axis meets the ground ahead of the contact, so the lateral force
  acts on that arm too. Unlike the pneumatic trail it does not fade at the
  limit, which is why a car with more caster keeps some weight in the wheel
  when the front tires let go;
- the **scrub radius** (`steering.scrubRadius`): the contact sits outboard of
  the kingpin axis, so a longitudinal force steers. Equal forces on both
  wheels cancel; a limited-slip differential biasing drive to one wheel, a
  single locked wheel or a kerb on one side do not. That is torque steer.

The kingpin torques of both front wheels add up on the rack. Divided by the
knuckle arm they are the **rack force** (`RackForce`); through the steering
ratio, less the power assist fraction, they are the hand-wheel torque
(`SteeringTorque`), reported in the sign of the steer input: turning right,
the tires push back with a negative torque, and a force-feedback wheel is
driven with that value directly.

## What the device adds

The hand wheel is the input, so the core does not simulate the column. Its
friction (`columnFriction`) and damping (`columnDamping`) are definition
values the input package maps onto a wheel's own friction and damper
effects, where the device's firmware applies them at its own rate.

## Jacking

With caster and kingpin inclination, steering moves the wheels up and down
relative to the chassis: the inner front wheel is pushed down, the outer
lifted. A car's suspension absorbs most of it. A kart has no suspension, so
the frame twists and the inner rear wheel unloads, which is the only way a
solid rear axle can turn without pushing. `steering.jackingRate` is the
linearised version: metres of front contact travel per radian of steer,
inner down and outer up; the body's roll and pitch stiffness carry the
difference diagonally.

## Compliance steer

A real steering system is not rigid. The column, rack mounts and linkage
wind up under the kingpin torque, and the suspension's rubber bushings let
each wheel turn a little under its own lateral force. Both make a car
understeer more as it corners harder, and both are standard
kinematics-and-compliance rig measures (ADR-0027).

- `steering.alignTorqueComplianceDeg`: degrees of road-wheel steer per kN·m
  of the steered axle's total kingpin torque, with the hand wheel held. Both
  steered wheels turn in the direction the torque pushes them: out of the
  turn in steady cornering, and toward the harder-braking wheel on a split
  surface when the scrub radius is positive. A firm rack-and-pinion car is
  around 1 to 2; a recirculating-ball SUV can be near 10.
- `axles[].lateralComplianceSteerDeg`: each wheel's steer per kN of its own
  lateral force, positive understeer on either axle, so the front steers
  away from its force and the rear toward it. Typical values are a few
  hundredths to a few tenths; negative is oversteer compliance.

The understeer gradient grows by Gillespie's terms: `c_at · (t_m + t_p) ·
W_f / g` for the kingpin torque (mechanical plus pneumatic trail on the
front axle load `W_f`), and `(c_f · W_f + c_r · W_r) / (2 g)` for the
lateral compliances, with the rates in radians. Both act through the
previous substep's forces and are in the snapshot. `ComplianceSteer_FL` …
`ComplianceSteer_RR` report each wheel's compliance angle, which
`WheelSteer_*` includes; `SteerAngle` stays the driver's. Both models carry
it.
