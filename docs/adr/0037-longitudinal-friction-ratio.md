# ADR-0037: Separate longitudinal friction for the feel tire

- Status: Proposed
- Date: 2026-10-31
- Supersedes / superseded by: none; amends ADR-0008 (feel tire
  parameterisation)

## Context

Four road presets stopped from 100 km/h well short of their own
`dataSheet` targets with ABS on: the hatchback in 42.6 m against ~38 m
(+12 %), the crossover +8 %, the pickup +7 % and the sports car +4 %.

The ABS was not the cause. Each stop came within about 1.5 % of the
distance the tires' friction allows, worked out from the load transfer and
load sensitivity alone. The cause was the tire: the feel model had one
`peakFriction` for both directions, and each preset's value was tuned to its
skidpad target (0.85 g on the hatchback, which the model meets). The
braking targets need about 1.03 g on the hatchback, which that one value
cannot give. Raising `peakFriction` instead moves the skidpad past its
target (9 % more friction takes the hatchback to 0.92 g).

Real tires usually grip a little more in braking and traction than in
cornering, and the Magic Formula carries the two peaks as separate
coefficients (`PDX1` and `PDY1`). The feel model had no way to say so.

## Decision

**A new feel-tire parameter, `longitudinalFrictionRatio`**, default 1: the
peak of the longitudinal curve is `ratio × μ(Fz) × Fz`, and `peakFriction`
then sets the lateral peak only. It applies to braking and driving alike,
as `PDX1` does. Load sensitivity, the surface grip and the slip stiffnesses
are unchanged, so the curve peaks at the same `peakSlipRatio`. Combined slip
keeps the resultant-slip method of ADR-0008; with unequal peaks its
envelope is the ellipse of the two peaks rather than a circle (checked in
`tire_tests.rs`). `fxMax` and `fxSlide` report the longitudinal peak.
Validation accepts 0.5 to 2, which only rejects a friction coefficient
typed in place of the ratio.

**The road presets set it** so their ABS stop meets the target and the
skidpad does not move:

| Preset             | Ratio | ABS stop, before → after | Target | Skidpad (unchanged) |
| ------------------ | ----- | ------------------------ | ------ | ------------------- |
| Light FWD hatch    | 1.12  | 42.6 → 38.3 m            | ~38 m  | 0.85 g              |
| Electric crossover | 1.08  | 40.1 → 37.2 m            | ~37 m  | 0.92 g              |
| Pickup 4x4         | 1.07  | 47.1 → 44.1 m            | ~44 m  | 0.77 g              |
| RWD sports car     | 1.05  | 35.5 → 33.9 m            | ~34 m  | 1.00 g              |

The hatchback's front brakes also go from 3000 to 3400 N·m on the axle:
at the new grip 3000 N·m could no longer lock the fronts, which capped the
stop near 38.9 m. The kart and the open-wheeler have no braking target and
keep a ratio of 1.

## Consequences

- Every preset's ratio is [ILLUSTRATIVE]: fitted to class-typical road-test
  figures, not measured on a tire.
- Stops on the other surfaces shorten by the same proportion (the surface
  grip scales both peaks), and traction-limited launches get a little
  quicker (the sports car's 0–100 km/h from 4.94 to 4.86 s). The validation
  goldens move accordingly; understeer gradients and the lane-change pass
  speeds do not.
- A definition without the field runs bit for bit as before.
- Two tests that pin pre-change numbers (the traction-control launch on a
  deliberately loose sports car, the hatchback's full-throttle shift speeds)
  set the ratio back to 1, as they already do for unsprung mass.

## Alternatives considered

- **Raise `peakFriction` and lower the cornering grip some other way**
  (more load sensitivity, softer roll stiffness). It would retune handling
  that already meets its targets to fix a braking number.
- **A sharper ABS.** A slip target at the tire's peak and a tighter release
  band shortened the stops by only 0.2 to 0.3 m.
