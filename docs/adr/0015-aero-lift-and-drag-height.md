# ADR-0015: Aero lift per axle and the drag line of action

- Status: Accepted
- Date: 2026-10-01
- Supersedes / superseded by: none; builds on ADR-0009 (raycast suspension)

## Context

Aerodynamics was a drag force through the centre of mass. That is enough for
top speed and coasting, and nothing else: a winged car's grip at speed, the
lift that makes a road car light at the front on the motorway, and the
nose-up pitch of drag acting high on a tall body were all missing. Milestone
6 adds the open-wheeler preset, which needs downforce to be itself.

Constraints: no new state; the single-track and four-wheel models must agree
to first order; the defaults must reproduce the old physics exactly; the
parameters must be the ones published aero data is quoted in.

## Decision

**Lift coefficients per axle, on the frontal area.** `aero.liftCoefficientFront`
and `aero.liftCoefficientRear` are lift coefficients referenced to
`aero.frontalArea`, positive up, so downforce is negative. The force at each
axle is `C_L · ½ ρ A · v_x²` with the body-frame forward speed, applied along
the body's up axis at the axle's position. Published figures for cars are
usually given as `C_L A` (Hucho, _Aerodynamics of Road Vehicles_, ch. 4;
Katz, _Race Car Aerodynamics_, ch. 7); dividing by the frontal area gives the
coefficient this format wants.

**The lift reaches the tires through the springs.** On the four-wheel model
the lift is a body force at the axle; the raycast suspension compresses and
the tire load follows, so a winged car sits lower at speed and its ride
height and spring rates matter, as they do on the real thing. The
single-track model has no springs and adds the lift to its axle loads
directly. Both report `AeroLift_F` and `AeroLift_R`.

**Drag on a line above the centre of mass.** `aero.dragHeightAboveCg` is the
height of the drag's line of action above the centre of mass; zero (the
default) is the old behaviour. On the four-wheel model it is a torque about
the body's lateral axis; on the single-track model it moves
`D · h_drag / L` of load from the front axle to the rear. A tall pickup with
its drag 0.2 m above a 0.75 m centre of mass lightens its nose by a few
percent at motorway speed.

## Alternatives considered

- **One lift coefficient and an aero balance fraction.** The same two
  numbers in a different basis; the per-axle form is how wind-tunnel data is
  reported.
- **Lift on the total speed rather than the forward component.** Lift is
  made by flow along the body; sideways motion in a slide makes very little
  of it. `v_x²` also keeps the force smooth through a spin.
- **A centre of pressure height for the drag relative to the ground.** The
  centre of mass is the natural origin for a moment arm in the body frame
  and keeps the default at zero; a ground-relative height would have needed
  a null to mean "no moment".
- **Yaw-dependent drag and side force.** Real, and the usual next step; left
  for a later milestone with a documented crosswind model.

## Consequences

- Zero coefficients reproduce the old physics exactly; the aero tests assert
  it.
- The presets gain small positive lift (road cars) and the open-wheeler
  2.5 of total downforce coefficient on 1 m², about 0.8 of its weight at
  180 km/h; the skidpad gradient of a winged car rises with speed, which the
  validation runner shows on the understeer points above 20 m/s.
- Guarded by tests: downforce loads the tires by the computed amount on both
  models and lift unloads them; the four-wheel springs compress by the
  downforce over the spring rate; drag above the centre of mass moves load
  rearward by `D · h / L` on both models; rear downforce adds understeer at
  speed; out-of-range coefficients are rejected.
