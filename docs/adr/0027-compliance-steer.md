# ADR-0027: Compliance steer

- Status: Proposed
- Date: 2026-10-10
- Supersedes / superseded by: none

## Context

Skidpad's steering is kinematic: the road wheels sit at the driver's angle
through the ratio and Ackermann, plus static toe (ADR-0017) and the toe
curves against travel (ADR-0026). Real cars also steer under load. The
steering linkage, column and rack mounts wind up under the kingpin torque,
and the suspension's rubber bushings let each wheel turn a little under its
own lateral force. Kinematics-and-compliance rigs report both as standard
measures, in degrees of steer per 100 N·m of aligning torque and per kN of
lateral force, and both are understeer terms in the steady-state budget
(Gillespie, _Fundamentals of Vehicle Dynamics_, ch. 6, "lateral force
compliance steer" and "aligning torque"; Milliken & Milliken, _Race Car
Vehicle Dynamics_, ch. 17).

The first comparison against a measured car made it the largest gap
(`docs/validation/nhtsa-jeep-cherokee.md`). NHTSA's 1997 Jeep Cherokee needs
7.4 deg/g of understeer gradient at its published 14:1 ratio, where
Skidpad's estimated build has 1.3 deg/g. A constant effective ratio fitted
at 11 m/s steered the car too much at 22.5 m/s. A compliance proportional to
lateral acceleration, applied by the comparison harness, predicted every
held-out test. The README's roadmap already named compliance steer as the
step after the travel curves.

## Decision

**Two compliances, linear, four-wheel model, default zero.**

- `steering.alignTorqueComplianceDeg`: the steering system's compliance with
  the hand wheel held, in degrees of road-wheel steer per kN·m of the
  steered axle's total kingpin torque (ADR-0012: aligning moment, mechanical
  trail on the lateral force, scrub radius on the longitudinal force). Both
  steered wheels turn by the same angle, as a rack does, in the direction
  the kingpin torque pushes them: out of the turn in steady cornering, and
  toward the wheel with more braking force on a split surface.
- `axles[].lateralComplianceSteerDeg`: each wheel's steer per kN of its own
  lateral force, positive understeer on either axle. On an axle ahead of the
  centre of mass, positive steers the wheel away from its lateral force (out
  of the turn); on an axle behind it, toward it (into the turn), which is how
  rubber-bushed links are usually set up. Negative is oversteer compliance.

**Forces from the previous substep.** Each substep's compliance steer reads
the kingpin torque and each wheel's lateral force from the end of the
previous substep, the same one-substep lag the roll-centre transfer
(ADR-0016) and the anti-pitch forces (ADR-0018) use. The tire's relaxation
(ADR-0005) already lags its force behind its slip angle by `σ / V`, tens of
milliseconds at road speed, so the explicit loop is stable at every
supported substep rate even where its static gain, compliance times
cornering stiffness, exceeds one. The kingpin torque joins the lateral
forces in the snapshot (one value; snapshot format version 6).

**Where it acts.** The compliance angle adds to each wheel's road-wheel
angle with the static toe and the toe curve, so the tire's slip, the
contact axes and `WheelSteer_*` carry it, and `ComplianceSteer_*` reports it
on its own. `SteerAngle`, `SteeringWheelAngle` and the steering jacking
follow the driver's steering only. On a solid axle the beam's steered axis
turns with it, as with the steering. The single-track model ignores both, as
it ignores static toe.

## Alternatives considered

- **A torsional degree of freedom for the steering system**, with its own
  inertia and damping. The right model for steering feel and shimmy, and the
  force-feedback signal would come from the deflection. It adds a stiff mode
  per vehicle, and the measured data at hand (a 0.28 s step response) does
  not resolve it. The static compliance is its low-frequency limit and can
  grow into it.
- **An effective steering ratio.** What the Jeep comparison tried first: it
  matches one speed and steers wrongly at another, because compliance grows
  with force, not with steering angle.
- **Compliance on lateral acceleration** (what the harness used). It cannot
  tell the axles apart or respond to braking or the aligning moment; it was a
  diagnostic.
- **Compliance curves** (non-linear in force). K&C rigs report them; the
  linear rate is the first-order term and what the data available supports.
  A table in the style of the travel curves can replace a rate later.

## Consequences

- Definitions without the fields behave exactly as before, bit for bit, so
  the presets, golden results and recorded laps are unchanged; the snapshot
  grows by one value and its format version is 6.
- The understeer gradient moves by Gillespie's terms: for a front kingpin
  torque `T = t · F_yf` from a total trail `t`, `W_f · t · c_at`; for the
  lateral compliances, `c_f · W_f / 2 + c_r · W_r / 2` with `W` the axle
  loads. `crates/skidpad-core/tests/compliance_tests.rs` checks both against
  the simulated gradient, and that the compliance steers the right way under
  braking on a split surface, holds at every substep rate and restores from
  a snapshot exactly.
- A level-of-detail switch carries the lagged kingpin torque both ways and
  builds the single-track model's axle forces from the four-wheel model's
  wheel forces. The four-wheel model's per-wheel forces start from zero
  after a switch back, as they did before, so its lateral compliance skips
  one substep there.
- The Jeep comparison carries the compliance in its definition instead of
  in the harness.
