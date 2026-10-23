# ADR-0030: Self-centring from the steering axis lift

- Status: Proposed
- Date: 2026-10-23
- Supersedes / superseded by: extends the kingpin torque of ADR-0012

## Context

ADR-0012 builds the kingpin torque from the tire's aligning moment, the
caster trail and the scrub radius: all tire forces. With the car parked or
crawling the tires make almost no lateral force, so the hand wheel has no
return to centre, while a real car's wheel comes back on its own. That
return comes from the steering axis geometry: the kingpin axis leans
inboard (kingpin inclination) and rearward (caster), so turning the wheel
about it swings the wheel down and lifts the car, and the car's weight
pushes back (Gillespie, _Fundamentals of Vehicle Dynamics_, ch. 8,
"vertical force" moment [VERIFY section]; Milliken & Milliken, _Race Car
Vehicle Dynamics_, ch. 19). `steering.jackingRate` already moves the
contacts with steer for the ride height, but adds no torque.

## Decision

Two angles, `steering.kingpinInclinationDeg` (top inboard, 0 … 25) and
`steering.casterDeg` (top rearward, −10 … 20), both default 0. Each steered
wheel adds `Fz · dh/dδ` to its kingpin torque, where `h(δ)` is the height of
the turned wheel's lowest point above the ground [DERIVED]:

- the wheel turns by its knuckle angle `δ` (the road-wheel steer less the
  static toe) about the axis, which meets the ground `mechanicalTrail` ahead
  of the contact and `scrubRadius` inboard of it, tilted by the two angles;
- with `C` the wheel centre and `a` the axle direction after Rodrigues'
  rotation, the lowest rim point sits `h = C_z − R·√(1 − a_z²)` above the
  ground, `R` the unloaded radius;
- the ground holds that point at zero, so the corner rises by `−h`, and
  virtual work gives the torque `Fz · dh/dδ`. `dh/dδ` is evaluated in closed
  form from the derivative of the rotation.

The closed form is checked against an independent sampling of the rim.
The single-track model applies it to a left and a right wheel each carrying
half the axle load.

The rigid-wheel geometry is exact; the textbook expressions are its small
angle forms (a centring term `−Fz·e·sin λ·sin δ` per wheel, `e` the axis
offset at the hub, plus a load-difference term from caster). Taking the
geometry directly avoids choosing between their sign conventions.

## Consequences

- Inclination gives a centring torque that grows with steer at any speed.
  Caster, and inclination with the trail, give opposite torques on the two
  wheels that cancel at equal loads; with lateral load transfer the heavier
  outer wheel wins and pushes slightly away from centre. On the hatchback
  at 0.3 g that is under 0.1 N·m at the hand, against about 3.5 N·m from the
  tires. Parked with the wheel half turned it gives about 1 N·m of return.
- The torque enters `SteeringTorque`, `RackForce` and the previous kingpin
  torque that drives compliance steer (ADR-0027), so a car with both
  compliance and these angles steers very slightly differently.
- Zero angles return zero before any arithmetic: bit for bit as before.
- The road-car presets get typical angles [VERIFY against a published
  spec]: 13° of inclination and 5° of caster on the hatchback and the
  crossover, 9° and 5° on the solid-axle pickup, 9° and 7° on the sports
  car. The kart and the open-wheeler are left for a later pass.
