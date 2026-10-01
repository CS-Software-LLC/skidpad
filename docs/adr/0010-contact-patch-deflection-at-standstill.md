# ADR-0010: Contact-patch deflection at standstill

- Status: Accepted
- Date: 2026-10-01
- Supersedes / superseded by: amends ADR-0005 (items 1, 3 and 4); builds on
  ADR-0008

## Context

ADR-0005 claimed that the relaxation-length transient with a speed floor
gives a parked car a static deflection. The code did not deliver one. The
transient slips relaxed toward the kinematic slips at rate `V_eff / σ` with
`V_eff = max(|Vx|, V_low)`, and the kinematic slip ratio was
`(ω R − Vx) / max(|Vx|, V_low)`. At standstill the filter's steady state is
the kinematic slip, so a locked wheel produced `Fx ≈ −C_κ · Vx / V_low`: a
viscous law, not a spring. On a slope the car therefore settled at a creep
speed where that viscous force balanced the weight component,

```text
V = m g sin θ · V_low / C      [DERIVED]
```

with `C` the sum of the braked wheels' longitudinal slip stiffnesses. The
`parkedOnSlope` scenario measured it before this change (four-wheel model,
mean speed over a 10 s hold): the default 1300 kg car crept at 2.1 mm/s on
a 10 % grade and 6.4 mm/s on 30 % with the service brake, 4.5 and 13.9 mm/s
on the handbrake alone; the hatchback preset 2.2 / 6.5 mm/s, the sports car
1.8 / 5.5 mm/s, the kart 3.9 / 11 mm/s; across a 20 % slope 4 to 6 mm/s.
The single-track model crept within a few percent of the same numbers.
Flat rest held on every preset, because nothing pushes a level car.

Constraints: stable at every substep rate from 60 Hz to 2 kHz, deterministic
(f64, `skidpad_math` only, preferably fewer libm calls), no change to the
snapshot layout, and at speed no change to the validated behaviour beyond
discretisation.

## Decision

**The transient state is the contact-patch deflection**, Pacejka's
single-contact-point first-order transient written in the deflection and
driven by the slip velocity (Pacejka, _Tire and Vehicle Dynamics_, ch. 7
**[VERIFY]** for the deflection form; ch. 8 and Bernard & Clover, SAE
950311, for the low-speed behaviour):

```text
u̇ = (ω R − Vx) − (|Vx| / σx) · u,     κ' = u / σx
v̇ = Vy − (|Vx| / σy) · v,             tan α' = v / σy
```

At speed this is exactly the relaxation of ADR-0005: `κ'` relaxes toward
the kinematic slip at rate `|Vx| / σx`. At `Vx = 0` the deflection simply
integrates the slip velocity, so the tire is a spring of rate `C / σ` and a
parked car settles at a static deflection. The state is stored as `κ'` and
`α' = atan(v / σy)` in the existing `slip_ratio` and `slip_angle` fields of
`TireTransient`, so snapshots and telemetry keep their layout and their
meaning; `snapshot::VERSION` stays at 1, and the determinism contract does
not promise continuation across core versions anyway.

**Discretisation: linearly implicit.** `u_{n+1} = (u_n + h · Vs) /
(1 + h · |Vx| / σ)`, the first-order linearly implicit (Rosenbrock) step of
Hairer & Wanner, _Solving Ordinary Differential Equations II_ **[VERIFY]**.
It is unconditionally stable and monotone for any `h`, and it removes the
two `exp` calls the exact lag used; the `tan`/`atan` pair that converts the
stored angle to and from the lateral deflection costs the same two libm
calls, so the count per tire per substep is unchanged. Exact exponential
integration was rejected: it would need the `exp` calls and the golden
results move by less than their tolerance either way.

**Low-speed damping as a damping ratio on the corner mass.** The standstill
spring is otherwise undamped (about 4 Hz laterally with the defaults
**[DERIVED]**: `√(C_α / (σy · m_corner)) / 2π` with `C_α ≈ 60 kN/rad`,
`σy = 0.35 m`, `m_corner = 325 kg`). A viscous force `c · (slip velocity)`
acts on each axis, with `c = 2 ζ √(k · Fz / g)` and `k = C / σ`, so that
`lowSpeedDamping` (`ζ`, now 0.7) is a damping ratio of the contact-patch
spring on the corner mass. It fades to zero with rolling speed through a
smoothstep polynomial reaching zero at `lowSpeedDampingFade` (2 m/s); no
`cos`. Both defaults are **[ILLUSTRATIVE]** starting values tuned by the
rest, nudge and parked tests; Pacejka §8.6 is the published reference for
damping on the contact-patch slip velocities **[VERIFY]**. The lateral
coefficient and the chassis side of the longitudinal one act explicitly on
the chassis proxy, so each is capped at `(Fz / g) / (2 h)`, a quarter of
the explicit stability limit; the cap binds only below about 100 Hz.

**Friction clamp on the deflection.** The deflection may not wind up past
`max(κ_peak, |floored kinematic κ|)` longitudinally and
`max(tan α_peak, |floored kinematic tan α|)` laterally. At speed the
kinematic slip is the true one and the transient only approaches it, so the
clamp never binds. At standstill it caps the static force at the peak: a car
pushed past its grip slides instead of winding the spring up forever, and
as the slide speed grows the floored kinematic slip takes the deflection
past the peak into the falloff. This is the stiction-to-sliding transition;
there is no separate sticky mode. The total force, curve plus damping, is
bounded by what the curve allows: the resultant of the curve forces while
that is above the sliding force, the sliding force otherwise, never more
than the peak. `TireOutput` gained `fx_slide` and `fy_slide` (the curves'
large-slip asymptotes) for that bound. For the Magic Formula, which has no
closed-form peak, the standstill bounds are typical passenger-car values
(`κ = 0.15`, `α = 8°`).

**Implicit wheel spin, re-derived.** The tire force's sensitivity to wheel
speed within one step is `dFx/dω = C_κ · R · h / (σx + h · |Vx|)` from the
deflection update, plus `c_x · R` from the damping. Both go into the
effective inertia `I_eff = I + h · R · dFx/dω`, replacing the
`response_fraction` expression. The damping term must be implicit: at
250 Hz `c · R² · h / I` is about 2 for the default car, unstable
explicitly. The stiffness is still the slope at the origin, a conservative
upper bound.

**Rolling resistance** already went smoothly through zero (ADR-0005 item
4, milestone 2): the moment is proportional to `Vx / V_low` below the floor.
That is kept; the flat-rest scenario guards it.

**`lowSpeedFloor`** keeps its meaning for the kinematic slip (telemetry and
the clamp) but no longer sets any relaxation rate.

**Road grade and cross slope** are a gravity component on the chassis proxy
of the built-in host (`World::set_ground_slope`): the ground stays the plane
`z = 0` and gravity is tilted, with the wheel loads carrying `cos θ` of the
weight, which is the same physics as a tilted plane. An external host has
real geometry and its own gravity and ignores it.

## Alternatives considered

- **A sticky-tire mode below a speed threshold** (the approach of several
  game engines: freeze the contact and apply a constraint). Its thresholds
  depend on the timestep and on the host's velocity noise, it is a
  discontinuity in force feedback, and it needs its own state. Rejected; the
  deflection clamp gives the stiction-to-sliding transition continuously.
- **Clamping the slip to zero below a speed.** A dead band where the car
  slides freely at walking pace. Rejected (as in ADR-0005).
- **Keeping the floored relaxation and raising `V_low`.** Lowers the creep
  speed in proportion but never removes it, and slows the transient at
  walking pace. Rejected.
- **Exact exponential integration of the deflection.** Same stability; two
  more libm calls per tire per substep for no visible difference in the
  validation results. Rejected.

## Consequences

- Parked cars hold: every preset and the default car, on both models, stay
  below 1e-10 m/s on 10, 20 and 30 % grades with the
  service brake, on 10 and 20 % with the handbrake, and across a 20 %
  slope, against a 1e-4 m/s criterion. Flat rest holds at 1e-18 m/s. The
  scenarios hold at 250, 500, 1000 and 2000 Hz. Cases the brakes cannot
  hold physically (the kart has no handbrake; the hatchback and sports-car
  handbrakes cannot hold 30 %) are skipped and listed.
- The cross-slope scenario exposed a 3 Hz limit cycle at 4e-5 m/s, below
  the criterion but sustained: the feel tire's direction-of-travel sign
  (ADR-0008 amendment A) switched at `Vx = 0` and stepped the combined-slip
  force by 0.2 % at every zero crossing of the body's longitudinal mode.
  The sign is now taken smoothly over ±`lowSpeedFloor`; the residual motion
  is at the 1e-16 m/s level.
- Placed on a slope with unloaded tire springs, a car moves a few
  millimetres while they wind up (up to about 6 cm/s momentarily with the
  handbrake alone); that is the real static deflection, not creep.
- A parked car pushed sideways at 1 m/s produces the lateral falloff force
  within 5 %; pushed at 2 cm/s it holds at the peak.
- Brakes still lock without chatter; the straight-line validation figures
  move by well under 1 % and the understeer gradients by less than
  0.01 deg/g (the transient at speed differs only by discretisation); the
  scripted-drive hashes change.
- `lowSpeedDamping` changes meaning and default (0.3 → 0.7) and
  `lowSpeedDampingFade` (2 m/s) is new, both with schema entries; existing
  definitions load unchanged.
- Guarded by `parked_tests.rs` (every preset, both models), the
  `parkedOnSlope` cases in the validate tool's golden file,
  `standstill_tests.rs` (substep sweep, static deflection, slide-off,
  discretisation against the exact lag, implicit wheel spin at every
  rate, damping cap), the proptests for rapid full-lock inputs at speed
  and forward/reverse flips at low speed, and the existing brake-lock, nudge
  and determinism tests.
