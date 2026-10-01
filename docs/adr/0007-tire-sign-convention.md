# ADR-0007: ISO sign convention for slip and tire forces

- Status: Accepted
- Date: 2026-10-01

## Context

Tire literature uses several sign conventions. Magic Formula `.tir` files
(MF-Tyre, MF-Swift, PAC2002 and successors) use the ISO 8855 vehicle axis
system: x forward, y to the left, z up; slip angle positive when the contact
patch velocity has a positive y component; and therefore a positive slip angle
produces a _negative_ lateral force. Pacejka's book sometimes presents the
"adapted ISO" convention in which the lateral force is flipped so that positive
slip gives positive force.

## Decision

The tire interface uses ISO 8855 throughout:

- Wheel frame: x along the wheel heading (forward), y to the left, z up.
- Slip ratio `κ = (ω R_e − V_x) / max(|V_x|, V_low)`: positive when driving.
  Positive `κ` gives positive (forward) `F_x`.
- Slip angle `α = atan2(V_y, max(|V_x|, V_low))`: positive when the contact
  patch moves to the left. Positive `α` gives negative `F_y`.
- Camber `γ` positive when the top of the wheel leans to the left (+y).
- Aligning moment `M_z` positive about +z. With `M_z = −t · F_y` this means a
  positive slip angle gives a positive, restoring aligning moment.

`.tir` files in the ISO convention (negative `PKY1`) load unchanged. Files in
another convention are the user's responsibility to convert; the importer logs
a warning when `PKY1` is positive.

## Alternatives considered

- **Adapted ISO (positive slip → positive force).** Nicer for teaching, but
  every `.tir` import would need a sign flip and every Magic Formula equation
  would be transcribed with a modification. Rejected to keep the Magic Formula
  implementation a faithful transcription of the published equations.

## Consequences

- The feel model negates its lateral curve so both models agree.
- The docs' concept pages explain the convention with a diagram; the
  tire-curve explorer plots `−F_y` so the curve reads "up and to the right".
