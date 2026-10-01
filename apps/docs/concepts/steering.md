# Steering and the force-feedback torque

The steer input sets the road-wheel angle through the steering ratio and
Ackermann fraction; what comes back is the torque the tires put on the hand
wheel, which is the signal a force-feedback wheel reproduces
([ADR-0012](https://github.com/csummers88/skidpad/blob/main/docs/adr/0012-steering-geometry-and-rack-force.md)).

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
