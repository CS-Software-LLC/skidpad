# ADR-0009: Raycast suspension on the chassis proxy, and the external host contract

- Status: Accepted
- Date: 2026-10-01
- Supersedes / superseded by: none; builds on ADR-0002 and ADR-0005

## Context

Milestone 2 replaces the planar single-track model with four wheels on
independent suspension over a six-degree-of-freedom chassis, and lets an
external rigid-body engine (Rapier first) own that chassis. Three questions
had to be settled: how to model the suspension so that every substep rate in
the supported range stays stable, how the chassis proxy of ADR-0002 is fed
and drained by a host each step, and how the whole thing stays deterministic
when the host is not.

## Decision

**Each corner is a raycast strut with no unsprung mass.** A ray from the top
of travel runs down the body's −z axis to the ground. The compression from
the static ride position gives the spring force (with a preload equal to the
static wheel load, so ride height is a definition input and spring rate only
sets stiffness), the compression rate gives the damper force (separate bump
and rebound rates), the left-right travel difference gives the anti-roll bar
force, and a stiff penalty spring acts beyond the bump travel. The ground can
push but not pull. The tire sits at the ray hit with the corner's total
suspension force, projected onto the contact normal, as its vertical load.
All wheel loads are applied to the chassis at the contact patch along the
contact normal; tire forces along the contact plane; the aligning moment
about the normal.

The wheel is massless and rigid, so the only vertical modes are the body's
heave, pitch and roll at a few hertz. There is no wheel-hop mode, which is the
mode that destabilises explicit integration at low substep rates. The cost is
that wheel hop, tire enveloping and unsprung-mass load variation over rough
ground are not modelled before an unsprung-mass option lands.

**The proxy carries a full pose.** ADR-0002 described a velocity-only proxy.
Suspension forces depend on where the rays hit, so the proxy also integrates
its own copy of the pose within a host step, from the pose the host handed it
at the step start. Under the built-in host that copy _is_ the vehicle. Under an
external host it is discarded at the next sync; the host's own integration is
authoritative.

**The host contract is three flat records per vehicle.** Before a step the
host writes its body's centre-of-mass position, orientation, linear and
angular velocity, and per wheel the plane it found under the wheel ray (hit
flag, a point, the normal, the surface velocity, a surface id). The core
exposes the rays to cast (body-frame origin, direction, length, tire radius).
After the step the host reads the net impulse of everything except gravity
and the net angular impulse, both in the world frame, plus each wheel's hub
and contact point for debug drawing. The host applies its own gravity.

**Adapters apply the impulse as a force over the host step**, not as an
instantaneous kick before it. Engines that substep internally (Rapier's
solver does) integrate applied forces and gravity together; a kick applied
before the step lands a fraction of a step ahead of gravity and the car
settles a few millimetres above ride height. `J / dt` as a force over the
step reproduces the built-in host exactly at rest and within a rounding
error in motion.

**Determinism is the core's promise, not the host's.** The core is bit-exact
for a given sequence of host records. Whether the host produces the same
records on every platform is the host's business; Rapier does only with its
enhanced-determinism build. The determinism harness therefore runs the
built-in host.

## Alternatives considered

- **Unsprung mass as a state per wheel, tire as a vertical spring.** More
  faithful (wheel hop, kerb strikes), but the tire spring with a 40 kg wheel
  is a 10–15 Hz mode that explicit stepping at 250 Hz handles poorly, and
  the host-step contact assumption of ADR-0002 would need per-substep
  contacts. Deferred to an option after the stability work of milestone 3.
- **Shape casts instead of rays.** Better on kerbs; several times the host
  cost and needs per-engine shape support. Rays first; a cast option can use
  the same contract since the core only needs a plane per wheel.
- **Applying the proxy result as a velocity override on the host body.**
  Removes the integration mismatch entirely but fights the host's own
  collisions and joints. Rejected; the host must stay authoritative.
- **Roll centres and geometric load transfer.** Real suspensions transfer
  part of the lateral load through the links, instantly, rather than through
  the springs. The strut model transfers everything through springs and bars,
  which gets the steady-state total right but lags the transient. Deferred to
  milestone 6 with the solid-axle work.

## Consequences

- Lateral load transfer and its split between the axles now follow from the
  spring and anti-roll bar rates: the validation page reports the four-wheel
  understeer gradient next to the single-track and linear-theory values, and
  the difference is the load-sensitivity effect of that transfer.
- Standing still exposed a latent limit cycle in the ADR-0005 low-speed
  handling: the sign-switching rolling-resistance moment and the barely
  damped wheel-tire mode. ADR-0005 is amended with a smooth rolling
  resistance through zero and a low-speed damping term treated implicitly
  in the wheel equation. Both models park cleanly; the rest tests guard it.
- The single-track model stays as `simulation.model = "singleTrack"`, the
  level-of-detail model for traffic, and the analytic cross-check.
- The timestep sweep of milestone 3 must include the external host at host
  rates from 30 to 240 Hz, since the proxy's within-step pose integration is
  what keeps the suspension stable when the host steps slowly.
- Guarded by `crates/skidpad-core/tests/four_wheel_tests.rs` (static loads,
  settling after a drop, lateral transfer against `m·a_y·h / (t/2)`, dive and
  squat, the external-host impulse equalling the built-in velocity change,
  airborne wheels, moving platforms) and `packages/rapier/test`.
