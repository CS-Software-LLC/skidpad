# ADR-0018: Anti-dive and anti-squat on the raycast suspension

- Status: Accepted, amended by [ADR-0026](0026-travel-dependent-geometry.md)
- Date: 2026-10-01
- Supersedes / superseded by: none

## Context

The raycast strut (ADR-0009) sends every bit of the longitudinal load
transfer through the springs, so the body pitches by the springs-only
amount under braking and power. Real suspension links are inclined in side
view and carry part of that transfer straight to the tires. The comparison
with Project Chrono's multibody BMW E90 (`docs/validation/chrono-bmw-e90.md`)
measured the car pitching 4.4°/g under braking where Skidpad, with no way
to express the geometry, pitched 2.4°/g. ADR-0016 already solved the
lateral counterpart with roll-centre heights.

## Decision

Each axle's `suspension` gets two fractions, `antiBrake` and `antiDrive`,
default 0, bounded at ±2. Each is the side-view geometry `tan θ · L / h_cg`
for that axle: the share of the load transfer caused by the axle's own
braking (or driving) force that its links carry to the tires. The
four-wheel model takes each axle's body-frame longitudinal tire force from
the previous substep, as ADR-0016 does for the lateral force, picks the
braking or the drive fraction by the force's sign, and applies
`anti · F_x · h_cg / L` as a vertical force between the body and the axle's
two tires: up at the front under braking, down at the rear. Because the
force is proportional to `F_x`, the switch between the two fractions at
`F_x = 0` is continuous. The previous force is part of the snapshot
(format version 4), and `PitchLinkLoad_F` and `PitchLinkLoad_R` report the
link force. The single-track model has no pitch and ignores both.

## Alternatives considered

- **Percent anti-dive with the brake balance folded in** (Gillespie's
  `%AD`). That couples a geometry parameter to the brake balance, so moving
  the balance would silently change the pitch geometry. The pure geometric
  fraction stays fixed; the docs show how to convert.
- **One anti-pitch fraction per axle.** Brake torque is reacted at the
  upright (outboard brakes) and drive torque at the differential, so the
  same links give different fractions; road cars quote them separately.
- **A side-view pitch-centre height, like the roll centre.** The
  longitudinal transfer does not split by axle the way the lateral one
  does, and the quantity designers quote is the percentage, not a height.
- **Solving the force in the same substep.** The load depends on the tire
  force, which depends on the load; the one-substep lag keeps it explicit
  and its loop gain, `anti · h / L` times the load sensitivity, is well
  below one, as for the roll centres.

## Consequences

Definitions without the fields behave exactly as before; the presets'
results do not change. Adding the previous longitudinal force to the state
changes every state hash, so the golden scripted-drive hashes are
regenerated, with no other golden value moving. A car with anti geometry
pitches less (or more, when negative) with the same tire loads, still parks
on slopes, and replays exactly:
`crates/skidpad-core/tests/pitch_geometry_tests.rs` guards each, and the
Chrono comparison derives the E90's fractions from its hardpoints.

Jacking that depends on travel, and fractions that change with travel, are
left for multibody suspension after 1.0.
