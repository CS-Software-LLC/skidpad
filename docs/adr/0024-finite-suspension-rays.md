# ADR-0024: Restrict suspension contacts to the finite forward ray

- Status: Proposed
- Date: 2026-10-02
- Clarifies ADR-0009; no definition or snapshot format change

## Context

Two rapid-full-lock property failures on 2026-10-02 reproduce on main
`a353da29`. Valid short-wheelbase, high-CG vehicles tip under alternating
steering and braking. The built-in host has tire contacts but no chassis
collision body, so a tipped car can fall below its ground plane.

The ray-plane intersection solved `t = (point - origin) · normal / (down ·
normal)` but checked only `t <= ray_length`. Negative distances were treated
as suspension compression. As the strut approached parallel to the plane,
the false contacts moved hundreds of metres behind the ray origin. Their
bump-stop loads and moment arms produced enormous angular impulses; the
explicit gyroscopic integration then amplified the invalid state to NaN.
The earlier minimized case reproduces the CI angular velocity exactly:
`(-285845.3652192635, -10332.959277855978, 27836.226639235927)` rad/s.

## Decision

Require `0 <= t <= ray_length`, the finite ray geometry already specified
by ADR-0009 and exported to hosts. A plane behind the origin uses the existing
no-contact path: zero suspension force and load, droop travel, and zero
travel rate. This is a geometric correction, not a force or velocity clamp.
All vehicle definitions and existing stability invariants remain valid.

Both endpoints are included. Compression beyond bump travel still engages
the existing bump stop while the intersection remains within the ray. Forward
contacts retain their original arithmetic, including all tire and drivetrain
calculations. No integrator, tire parameters, assists, or FFB code changes.

## Compatibility and limits

The built-in host and the external host's within-step proxy share this rule.
An external engine remains responsible for chassis collision and penetration
recovery. The built-in host still does not simulate a body resting on its
roof or side: a rollover may fall through the plane. Inventing backward
suspension contacts is not a valid substitute for a chassis collision solver.

The ABI, definition schema, telemetry and snapshot layout are unchanged.
Snapshots remain readable; replay trajectories that previously relied on
behind-origin contacts intentionally change across this physics fix. The
single-track model is unaffected. Existing golden scenarios should retain
their results when their contacts remain on the forward ray; validation must
be checked rather than tolerances relaxed.

## Validation

The minimized definitions and input sequences from CI runs
[37073232373](https://github.com/CS-Software-LLC/skidpad/actions/runs/37073232373)
and [37070652376](https://github.com/CS-Software-LLC/skidpad/actions/runs/37070652376)
are permanent regression tests, asserting the original bounds at every
substep. Their proptest seeds are retained as well. Dedicated tests cover
negative distances, the origin, forward bump-stop compression, the far ray
endpoint, distances beyond it, and the near-horizontal below-ground case,
in both host modes. The prebuilt WASM must be regenerated with the correction.
