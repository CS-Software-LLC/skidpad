# ADR-0028: Unsprung mass as an option on independent axles

- Status: Proposed
- Date: 2026-10-23
- Amends ADR-0009 ("each corner is a raycast strut with no unsprung mass")

## Context

ADR-0009 made each corner a massless strut so that the only vertical modes
are the body's, at a few hertz, and every substep rate stays stable. It
named the cost: no wheel hop, no tire-load fluctuation over rough ground or
kerbs, and no unsprung-mass option until the stability work was done.
Milestone 3 has been done for a while, and the analytic suite
(`docs/validation/analytic.md`) can now check a new vertical mode against
exact answers.

The alternative ADR-0009 rejected was a state per wheel with the tire as a
vertical spring. Its objection was that a 40 kg wheel on a 250 kN/m tire is
a 12–14 Hz mode that explicit stepping at 250 Hz handles poorly. At those
numbers explicit stepping is in fact stable (ω·dt ≈ 0.35 for the hop and
0.47 on the bump stop), but a kart's 5–8 kg wheel on its bump stop reaches
ω·dt ≈ 1.3, close to the explicit limit of 2.

## Decision

**Opt-in per axle.** `suspension.unsprungMass` (kg per wheel, part of
`chassis.mass`) defaults to zero, which keeps the massless strut bit for
bit. Above zero, each wheel of that axle is the textbook two-mass quarter
car (Gillespie ch. 5): the existing spring, dampers, anti-roll bar and bump
stop between the body and the wheel, and a tire spring and damper between
the wheel and the ray hit. Each tire model gains `verticalStiffness`
(default 250 kN/m) and `verticalDamping` (500 N·s/m); the `.tir` import
reads them from `VERTICAL_STIFFNESS` and `VERTICAL_DAMPING`.

**The wheel's state is its travel along the strut and its rate.** The ray
hit sets the tire's deflection (`ground travel − wheel travel`), the tire
force is `k_t (δ + δ_static) + c_t δ̇`, never negative, and that force is the
tire load the tire model sees. The geometric and anti-pitch link loads go
straight from the tire to the body as before. A droop stop as stiff as the
bump stop holds a hanging wheel.

**Ride height is unchanged.** The tire spring is preloaded with the static
wheel load and the suspension spring with the static load less the wheel's
weight, so the body rests where the definition puts it, the static tire
loads are those of the massless strut, and a car can be compared with and
without the option. The ray is longer by the static tire deflection, so the
tire can unload fully before the contact is lost; hosts cast that longer ray.

**The body keeps the whole car's equations.** The wheels move with the body
except along its up axis. The body receives the strut forces along up, the
rest of a tilted contact's normal force through the links, the tire's plane
forces as before, and at each corner `m_u (F·u) / m_s` along up: the force
that gives the wheel the body's own acceleration along up. With it, the body
accelerates along up as the sprung mass and across up as the whole car, the
integration keeps the total mass and full gravity, and at rest the corners
carry exactly the massless strut's loads (also in pitch, where the wheels'
weight would otherwise sit at the axles instead of the centre of mass).
External hosts therefore need no change: they keep the total mass, apply
full gravity, and receive an impulse that at rest equals the massless one.

**The wheel is stepped with a linearly implicit (backward) Euler update.**
Its own tire, spring, anti-roll bar and stop rates and both dampers enter
implicitly; its coupling to the body and to the other wheel of the axle
stays explicit, since the body's modes are an order of magnitude slower.
Backward Euler is L-stable, so the hop stays bounded at every supported
rate, whatever the stiffness, and through lift-off and stop contact. The
cost is numerical damping of the hop of about `ω·dt / 2`.

**Snapshots.** A vehicle with unsprung mass appends each wheel's travel and
rate (8 values) after the massless layout. The format version stays 6: the
massless layout is unchanged, every existing snapshot restores, and the
length check already refuses a snapshot taken with the other setting.

**Not covered.** Solid axles are rejected by validation with unsprung mass
for now; a beam needs one body with heave and roll, not two hubs, and is the
next step. The single-track model ignores the option, as it ignores the
suspension. The contact plane is still one per wheel per host step, so
features shorter than one host step's travel are still smoothed.

## Alternatives considered

- **On by default, with typical values.** Moves every golden, determinism
  hash and comparison report in the same change as the model. Deferred to a
  separate change that turns it on in the presets and reports what moved.
- **Explicit (semi-implicit Euler) wheel step.** Simpler and less damped, but
  marginal for light wheels on stops at 250 Hz.
- **Trapezoidal wheel step.** Tried: it cuts the heave energy residual of the
  analytic test from 3.7 % to 0.84 % at 1 kHz but is not L-stable, so a stiff
  wheel on and off its stops or the ground can ring at the step rate. Stable
  beats accurate.
- **Anisotropic body mass (sprung along up, total across).** Equivalent in
  translation to the corner forces chosen, but applied at the centre of mass
  it leaves a pitch moment at rest whenever the axles carry different loads.

## Consequences

- New telemetry channels `TireDeflection_FL` … `_RR` (m; positive pressed in,
  negative the gap once the wheel is off the ground; zero for the massless
  strut). `SuspTravel_*`, `SuspRate_*` and `SuspForce_*` report the wheel's
  own travel and the strut force.
- Guarded by `crates/skidpad-core/tests/unsprung_tests.rs` (results in
  `docs/validation/analytic.md`) and a property test of random vehicles with
  random unsprung mass under rapid full-lock inputs.
