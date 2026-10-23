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
ratio, less the power assist, they are the hand-wheel torque
(`SteeringTorque`), reported in the sign of the steer input: turning right,
the tires push back with a negative torque, and a force-feedback wheel is
driven with that value directly.

## Power assist

`steering.powerAssist` is the share of the torque the assist takes away. On
its own it is a constant share, which also takes most of the small torque
near centre, where the driver feels the road. A real assist valve barely
opens there. `steering.powerAssistOnset` (N·m of manual hand-wheel torque)
gives the assist that boost curve
([ADR-0029](https://github.com/CS-Software-LLC/skidpad/blob/main/docs/adr/0029-power-assist-boost-curve.md)):
with manual torque `Tm` and `a = powerAssist`,

```text
SteeringTorque = (1 − a)·Tm + a·Tm / √(1 + (Tm / powerAssistOnset)²)
```

Well below the onset the hand feels the whole manual torque; well above
it, `1 − a` of it plus a constant `a × powerAssistOnset`. The torque rises
with load everywhere, so the wheel never goes lighter as you turn in.

`steering.powerAssistAtSpeed`, `powerAssistFadeStart` and
`powerAssistFadeEnd` make the assist speed-sensitive: the assist fraction
goes linearly from `powerAssist` at the fade's start to
`powerAssistAtSpeed` at its end (m/s). The wheel is then light when parking
and heavier at speed, as with most electric systems
([ADR-0034](https://github.com/CS-Software-LLC/skidpad/blob/main/docs/adr/0034-speed-sensitive-power-assist.md)).

## Self-centring from the axis angles

The kingpin axis leans inboard at the top (kingpin inclination,
`steering.kingpinInclinationDeg`) and usually rearward (caster,
`steering.casterDeg`). Turning a wheel about a leaning axis swings it
downward, which lifts that corner of the car, so the car's weight pushes
the wheel back toward straight ahead
([ADR-0030](https://github.com/CS-Software-LLC/skidpad/blob/main/docs/adr/0030-steering-lift-self-centring.md)).
That is what returns the wheel of a parked or slow car, where the tires
make almost no aligning torque. The core finds the lift from the exact
geometry of the turned wheel and adds `load × dh/dδ` to each kingpin.

Inclination lifts both wheels whichever way you steer, a centring torque
that grows with the angle. Caster, and inclination combined with the
caster trail, lower the inner wheel and raise the outer: equal and opposite
torques that cancel when both wheels carry the same load. In a corner the
outer wheel is heavier and that part pushes slightly away from centre, a
few hundredths of a N·m at the hand on the hatchback. Both angles at zero
(the default) leave the torque as it was.

## What the device adds

The hand wheel is the input, so the core does not simulate the column. Its
friction (`columnFriction`) and damping (`columnDamping`) are definition
values the input package maps onto a wheel's own friction and damper
effects, where the device's firmware applies them at its own rate.

`columnDampingAtSpeed` and `columnDampingSpeed` make the damping rise with
speed, as electric power steering's active damping does: linear from
`columnDamping` at rest to `columnDampingAtSpeed` at `columnDampingSpeed`
(m/s), then held. The core reports the current value as `ColumnDamping`
([ADR-0033](https://github.com/CS-Software-LLC/skidpad/blob/main/docs/adr/0033-speed-sensitive-column-damping.md)).

## Torque channels for force feedback

The core substeps at the definition's rate (1 kHz by default), while a host
reads telemetry once per host step. `SteeringTorque` is the last substep's
value; `SteeringTorqueMean` is its mean over the host step's substeps, and is
what the input package sends to a wheel. Sampling the last substep once a
frame turns anything faster than half the frame rate (kerbs, wheel hop, tire
vibration) into random steps; the mean filters it first
([ADR-0031](https://github.com/CS-Software-LLC/skidpad/blob/main/docs/adr/0031-force-feedback-torque-channels.md)).

Five channels split `SteeringTorque` by source, already through the ratio and
in the same sign, so they add up to it: `SteerTorqueMz` (the tires' aligning
moment), `SteerTorqueTrail` (mechanical trail), `SteerTorqueScrub` (scrub
radius), `SteerTorqueLift` (the axis angles above) and `SteerTorqueAssist`
(what the power assist removed, opposite in sign to the rest while it
helps). The sandbox's wheel panel graphs them with the torque requested of
the wheel and the torque actually sent.

`SteeringTorqueSlice0` … `SteeringTorqueSlice7` cut the host step into eight
equal slices of time, oldest first, for a sink that plays the torque out
faster than the host rate. `LogitechWebHidSink`'s `playoutRate` replays each
step's slices over the next step with linear interpolation, one step behind
([ADR-0032](https://github.com/CS-Software-LLC/skidpad/blob/main/docs/adr/0032-sub-frame-torque-playout.md)).

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
