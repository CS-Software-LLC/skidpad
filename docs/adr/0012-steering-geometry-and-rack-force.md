# ADR-0012: Steering geometry, rack force and jacking

- Status: Accepted
- Date: 2026-10-01
- Supersedes / superseded by: none; builds on ADR-0007 (sign convention) and
  ADR-0008 (feel-tire aligning moment)

## Context

Until now the steering was a ratio: the input set the road-wheel angle, and
the hand-wheel torque was the front tires' aligning moments divided by the
ratio. Milestone 5 needs a torque that a force-feedback wheel can reproduce,
which means the geometry that puts forces on the rack beyond the pneumatic
trail: the mechanical (caster) trail, the scrub radius that turns a left to
right difference in longitudinal force into torque steer, power assist, and
the column's own friction and damping. It also needs the kinematic effect a
kart lives on: with caster, steering pushes the inner front wheel down and
lifts the outer, twisting the frame so the inner rear wheel unloads. Without
it the kart's solid axle pushes at low speed with both rear wheels loaded
(milestone 4 measured the push as a negative skidpad gradient).

Constraints: the hand wheel is an input, not a simulated body, so the column
cannot have dynamics inside the core; no new state in the snapshot; the
single-track model shares the parameters; deterministic.

## Decision

**Kingpin torque from both front wheels.** For each steered wheel `i`, with
`side = +1` left, `−1` right:

```text
T_kp,i = M_z,i − t_m · F_y,i − side_i · r_s · F_x,i
```

`M_z` is the tire's aligning moment (pneumatic trail and the `SSZ2` arm,
ADR-0008), `t_m` the mechanical trail (`steering.mechanicalTrail`, m, the
caster trail on the ground) which acts on the lateral force exactly as the
pneumatic trail does, and `r_s` the scrub radius (`steering.scrubRadius`, m,
positive with the contact outboard of the kingpin axis). Symmetric
longitudinal forces cancel on the rack; a limited-slip differential, a
locked wheel or a kerb on one side do not, which is torque steer.

**Rack force and hand-wheel torque.**
`RackForce = Σ T_kp,i / steeringArm` (`steering.steeringArm`, m, the
knuckle arm the rack pulls on), and

```text
SteeringTorque = −(1 − powerAssist) · Σ T_kp,i / ratio
```

in the sign of the steer input (positive turns right), so a force-feedback
wheel is driven with this torque directly. `powerAssist` is the fraction of
the rack torque the assist removes at the hand wheel, a constant boost: a
boost curve over torque is a later refinement. The single-track model uses
the same expression with its one lumped front tire (the scrub terms cancel
by symmetry).

**Column friction and damping are definition values, not simulation.**
`steering.columnFriction` (N·m) and `steering.columnDamping` (N·m per rad/s
of hand-wheel rate) describe the column for the device layer, which maps
them to a wheel's friction and damper effects; the core cannot apply them
because the hand wheel is the input. The sandbox and the input package read
them from the definition.

**Jacking as a kinematic ride-height change.** `steering.jackingRate` (m per
radian of road-wheel steer, default 0) moves each front wheel's contact
along its ray with steer: the inner wheel of the turn moves down by
`jackingRate · |δ_i|`, the outer up, so the inner front spring compresses
and the outer extends, and the body's roll and pitch stiffness carry the
difference diagonally to the rear, unloading the inner rear. The linearised
form stands in for the caster and kingpin-inclination kinematics
(Milliken & Milliken, _Race Car Vehicle Dynamics_, ch. 19 **[VERIFY]**),
which a car's suspension mostly absorbs and a kart's stiff frame does not.
The travel rate does not include the steer rate's contribution (no steer
rate state); the dampers see only the chassis motion.

## Alternatives considered

- **A simulated steering column** with inertia, driven by a hand-wheel
  torque input. Right for a motor-driven column model, wrong for the
  product: the player's wheel is the column, and a keyboard driver sets an
  angle. The angle input stays; the column parameters go to the device.
- **Full caster and kingpin kinematics** for the jacking. More parameters a
  user cannot measure, for a linear effect at the steer angles that matter.
  The rate is one number that can be set from a kart's measured inner-wheel
  lift.
- **An assist curve.** Comes with the steering-feel work of a later
  milestone; the constant boost gives the right torque scale now.

## Consequences

- Cars gain a mechanical trail (default 0.02 m) and a scrub radius (default
  0.01 m), so the steering torque at the limit goes light later and less
  completely than with the pneumatic trail alone, and torque steer appears
  with limited-slip front differentials. `SteeringTorque` values change;
  `RackForce` is new; nothing in the vehicle motion changes for a definition
  with `jackingRate: 0`, so only the kart's validation results move.
- The kart gets a jacking rate (10 mm per radian) and its inner rear wheel
  unloads by about a quarter in a steady corner, the outer rear taking the
  load. Its fitted skidpad gradient stays negative, and becomes a little
  more so: the solid axle's push is a yaw moment against the turn that
  fades as the inner rear unloads, which a linear fit over lateral
  acceleration reads as a negative slope, and jacking makes it fade sooner.
  The gradient is the wrong summary for a spool; the validation page shows
  the per-point steer angles and the docs say so.
- Guarded by tests on the kingpin torque composition (trail, scrub,
  assist, sign), the single-track equivalence, kart jacking load
  transfer and gradient, and the validate tool.
