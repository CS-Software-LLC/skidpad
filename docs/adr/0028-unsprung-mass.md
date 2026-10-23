# ADR-0028: Unsprung mass as an option on each axle

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
except along its up axis. Along up, the body heaves, rolls and pitches as
the sprung mass: the whole car's mass and inertias less the wheels' share,
`M_s = M − Σ m_u Jᵢᵀ Jᵢ`, where `Jᵢ = (1, yᵢ, −xᵢ)` takes (heave, roll rate,
pitch rate) to wheel `i`'s rate along up. The body receives the strut forces
along up, the rest of a tilted contact's normal force through the links, the
tire's plane forces as before, and at each wheel `m_u Jᵢ q̈` along up, with
`q̈ = M_s⁻¹ Q` from the forces and moments before the wheels' own: the force
that gives the wheel its corner's acceleration. With it, the body moves
along up as the sprung mass and across up as the whole car, the integration
keeps the total mass, inertias and full gravity, and at rest the corners
carry exactly the massless strut's loads. External hosts therefore need no
change: they keep the total mass, apply full gravity, and receive an
impulse that at rest equals the massless one. Validation keeps at least a
tenth of the roll and pitch inertias for the body.

**The wheel is stepped with a linearly implicit Euler update.** Its tire,
spring, anti-roll bar and stop rates and both dampers enter implicitly, the
strut's against the reduced mass of the wheel and the body at that corner
(`1/m_u + Jᵢ M_s⁻¹ Jᵢᵀ`), and the strut force's change over the step goes
back to the body as an impulse. The coupling between corners stays
explicit. The hop stays bounded at every supported rate, through lift-off
and stop contact, and so do light bodies whose wheels carry much of the
roll inertia. The cost is numerical damping of the hop of about
`ω·dt / 2`.

**Snapshots.** A vehicle with unsprung mass appends each wheel's travel and
rate (8 values) after the massless layout. The format version stays 6: the
massless layout is unchanged, every existing snapshot restores, and the
length check already refuses a snapshot taken with the other setting.

**Solid axles carry a beam.** On a solid axle the two wheels' mass is one
beam, `m_a = 2 m_u`, that heaves and rolls. Its roll inertia about its own
centre is `suspension.beamRollInertia`. The default of zero puts the mass at
the wheels, `2 m_u (t/2)²`; a housing and differential near the middle make
it smaller, so the beam rolls (axle tramp) faster than it hops. The state is
still each wheel's travel and rate: in those coordinates the beam's mass
matrix is `m_a/4 [[1, 1], [1, 1]] + I_a/t² [[1, −1], [−1, 1]]`, which is
`m_u` on the diagonal when the mass sits at the wheels. The two ends are
stepped together with the same linearly implicit update, the anti-roll bar
coupling them inside the step. The body's sprung matrix subtracts
`Σ Jᵢᵀ M_u,ij Jⱼ` over the beam's two ends, and each end's corner force is
`Σⱼ M_u,ij Jⱼ q̈`. The wheels stand square to the line through the two hubs
(ADR-0016 used the line through the contacts), so the beam's own roll
cambers both wheels. The snapshot layout does not change, and validation
keeps a tenth of the body's roll inertia after the beam's.

**Not covered.** The single-track model ignores the option, as it ignores
the suspension. The contact plane is still one per wheel per host step, so
features shorter than one host step's travel are still smoothed. A beam's
springs still act at the wheels (ADR-0016), so a build with inboard springs
carries them at their roll-equivalent rate, as the Jeep comparison does.

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
- **Heave only.** The first version gave each wheel the body's heave alone
  and stepped each strut against the wheel's mass alone. In roll and pitch
  the wheels then moved with the body without their own inertia, and with
  the option on in the presets the open-wheeler (whose wheels carry more
  than half of its roll inertia) hopped its wheels at 250 Hz. Fixed before
  the presets turned the option on; `docs/validation/analytic.md` has the
  numbers.

## Consequences

- New telemetry channels `TireDeflection_FL` … `_RR` (m; positive pressed in,
  negative the gap once the wheel is off the ground; zero for the massless
  strut). `SuspTravel_*`, `SuspRate_*` and `SuspForce_*` report the wheel's
  own travel and the strut force.
- Guarded by `crates/skidpad-core/tests/unsprung_tests.rs` (results in
  `docs/validation/analytic.md`) and a property test of random vehicles with
  random unsprung mass under rapid full-lock inputs.
