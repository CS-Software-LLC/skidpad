# Drivetrain

The drivetrain is what turns the driven wheels: a power unit, a clutch, a
gearbox with a final drive, and differentials
([ADR-0011](https://github.com/csummers88/skidpad/blob/main/docs/adr/0011-drivetrain-graph.md)).
Skidpad does not simulate it as a chain of separate bodies passing torque
down the line. It is solved as one small rotational system each substep,
together with the wheels, so a locked clutch, a spool and a stiff
first-gear engine inertia are all unconditionally stable at every substep
rate.

## One system in the wheel speeds

The unknowns are the wheel speeds and the engine speed. Every shaft between
them is a kinematic function of the wheels: the carrier of a differential
turns at the mean of its two outputs, a centre differential's carrier at a
torque-weighted mean of the two axles, and the gearbox input at the carrier
speed times the overall ratio. The inertias of those shafts are reflected
onto the wheels through the ratios, which gives a coupled mass matrix, and
the tire torques are applied as the boundary condition, exactly as in the
single-wheel model ([substepping](/concepts/substepping)).

Everything that has a limit is a bounded constraint on a relative speed:

| Constraint          | Drives to zero             | Bounded by                                      |
| ------------------- | -------------------------- | ----------------------------------------------- |
| Clutch              | gearbox input minus engine | the clutch capacity (infinite for a motor)      |
| Centre differential | front carrier minus rear   | nothing (open), everything (locked), or the LSD |
| Axle differential   | left wheel minus right     | likewise                                        |
| Brake               | the wheel speed            | the brake torque                                |

The constraints are solved jointly: all those not at a bound as exact
equalities, the ones that overshoot clamped and held, repeated a fixed
number of times. A brake within its capacity therefore leaves its wheel at
exactly zero, which is what keeps a locked wheel from chattering
([validation](/validation/)).

## Power units

- **Direct** is the interim drive of the first milestones: a torque that
  falls linearly with carrier speed, with no engine state. It is the
  default and the cheap option for traffic.
- **Combustion** has a full-throttle torque curve over rpm, engine braking
  that grows with speed on a closed throttle, an idle governor and a rev
  limiter. The engine braking is a line from `engineBrakingIdle` to
  `engineBrakingRedline`, or the measured `engineBrakingCurve` when one is
  given; at part throttle the torque blends between the two curves. The governor stands in for a starter: the engine never stalls.
  Its inertia matters: in first gear it is reflected to the wheels at the
  square of the ratio and can be tens of times a wheel's own, which is why
  the driven wheels lock last under hard braking.
- **Electric** gives its peak torque to the base speed and peak power above
  it, regenerates on a closed throttle, and couples rigidly (no clutch).
  Reverse is the motor turning backwards.

## Transmission

Forward ratios, a reverse ratio, a final drive, a torque interruption while
shifting, and a clutch re-engagement time. An **automatic** shifts on the
gearbox input speed at fractions of redline, holds for a moment after each
shift, and treats a `gear` input of zero as drive, so a definition driven
with throttle alone goes forward. A **manual** follows the `gear` input
exactly: negative is reverse, zero neutral, positive a gear number.

The clutch capacity is the pedal's remainder times an automatic law: the
clutch bites between idle and a set speed above idle, so a car launches
under throttle and idles with the brakes held, and it opens with the brake
once the gearbox input has dropped below idle speed, as a driver stopping
would. A manual definition with `clutchBiteRpm: 0` is pedal-only.

## Differentials

An **open** differential sends equal torque to both outputs. A **locked**
one (a spool, or the solid rear axle of a kart) ties the outputs together.
A clutch-pack **limited slip** differential transfers at most a preload
plus a share of the carrier torque set by the torque bias ratio, with a
separate ratio for drive and for coast. The centre differential adds a
front torque fraction for the open split.

## Telemetry

`EngineRpm`, `EngineTorque`, `Gear`, `ClutchSlip`, `ClutchTorque`,
`DiffLockTorque_F`, `DiffLockTorque_R`, `CenterLockTorque` and `Clutch`
join the record; `DriveTorque_*` is the half-shaft torque at each wheel,
recovered from its solved acceleration.
