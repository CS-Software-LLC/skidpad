# ADR-0005: Low-speed and standstill tire handling

- Status: Accepted, amended by [ADR-0010](0010-contact-patch-deflection-at-standstill.md)
- Date: 2026-10-01

## Context

Slip ratio and slip angle divide by wheel speed. Near zero speed they are
undefined, and naive implementations oscillate at rest, creep on slopes, or
explode when the sign of the velocity flips. Stability is a product feature, so
the method must be stable first and physically plausible second.

## Decision

Two mechanisms, both from published work:

1. **Relaxation-length transient slip with a speed floor.** The tire's
   longitudinal and lateral slip are not computed from velocity directly; they
   are state variables that relax toward the kinematic slip with time constant
   `σ / V`, where `σ` is the relaxation length and `V` is the rolling speed
   (Pacejka, _Tire and Vehicle Dynamics_, §7.2). Below a floor speed
   `V_low` (default 0.5 m/s) the time constant uses `V_low` instead of `V`, so
   the filter never becomes infinitely slow or divides by zero. This is the
   approach of Bernard and Clover (SAE 950311): at low speed the transient slip
   behaves like a spring between the contact patch and the road, which is
   physically what a tire does when parked.

2. **Kinematic slip computed with a soft denominator.** The kinematic slip
   ratio is `(ω R − V_x) / max(|V_x|, V_low)` and the slip angle is
   `atan2(V_y, max(|V_x|, V_low))`. Combined with (1), the steady state at rest is
   a static deflection that holds a car on a slope rather than a limit cycle.

3. **Implicit wheel spin.** The wheel-spin equation is integrated with the
   tire's longitudinal stiffness treated implicitly: the effective inertia
   becomes `I + dt · R · (dF_x/dκ) · R / V_eff · f`, where `f` is the fraction
   of a kinematic slip change that reaches the transient state within one
   step. The stiffness used is the slope at the origin, which is an upper
   bound at large slip; that over-damps the spinning-wheel case slightly in
   exchange for unconditional stability of the stiff wheel–tire mode. Stable
   beats accurate, and the error vanishes as `dt → 0`.

4. **Low-speed damping and smooth rolling resistance** (amendment, milestone
   2). With (1) and (2) alone the wheel-tire mode at standstill, a spring of
   stiffness `C_κ / σ_x` on the wheel's effective mass `I / R²`, is damped
   only by the relaxation floor, a damping ratio below one percent, and the
   rolling-resistance moment switched sign with the velocity. Together they
   produced a limit cycle whenever a parked car was nudged. Following
   Pacejka §8.6, a viscous force on the contact slip velocities,
   `k = 2 ζ √(C_κ I / (σ_x R²))` with the tire parameter `lowSpeedDamping`
   as `ζ` (default 0.3), is added below the speed floor and fades to zero at
   it; its longitudinal part enters the implicit wheel equation so it cannot
   destabilise anything. The rolling-resistance moment is proportional to
   `V_x / V_low` below the floor instead of its sign. Both are clamped to the
   friction circle.

The parked-on-slope validation scenarios (10%, 20%, 30%) and the rest-jitter
measurement in milestone 3 guard this ADR; the four-wheel rest and nudge tests
of milestone 2 guard the amendment.

**Amended by ADR-0010.** The parked-on-slope scenarios showed that items 1
and 2 do not give a static deflection: with the floored relaxation rate the
steady state at rest is the kinematic slip, a viscous law, and the car creeps
at `m g sin θ · V_low / C`. ADR-0010 replaces the floored relaxation with the
contact-patch deflection driven by slip velocity and decaying at the true
rolling speed, re-derives item 3 for it, and redefines the damping of item 4
as a damping ratio on the corner mass with its own fade speed. The speed
floor keeps its role for the kinematic slip (telemetry and the deflection
bound) only.

## Alternatives considered

- **Clamp slip to zero below a speed threshold.** Produces a dead band where
  the car slides freely at walking pace. Rejected.
- **Switch to a separate static-friction model below a threshold.** Works but
  introduces a discontinuity at the switch speed that is visible in telemetry
  and in force feedback. Rejected; the relaxation approach gives the same
  behaviour continuously.
- **Implicit integration of the tire with the chassis.** Correct and stable but
  couples the tire solve into the chassis proxy; may be adopted later for the
  wheel-spin equation (drivetrain solver, milestone 4). Not needed for the
  lateral case.

## Consequences

- Every tire carries two state variables per wheel (transient κ and α). They
  are part of the snapshot and of the telemetry.
- `V_low` is a tuning parameter with units and a default, exposed in the
  schema as `tire.lowSpeedFloor`; the damping ratio is `tire.lowSpeedDamping`.
