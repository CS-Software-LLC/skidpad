# ADR-0017: Static toe per axle

- Status: Accepted, amended by [ADR-0026](0026-travel-dependent-geometry.md)
- Date: 2026-10-01
- Supersedes / superseded by: none

## Context

The comparison against Project Chrono's multibody BMW E90
(`docs/validation/chrono-bmw-e90.md`) found Skidpad answering a step steer
about 25 % sooner than Chrono and leading it by 50 ms in a sine steer.
Chrono's linkage holds that car at 1.27° of toe-in per front wheel and
0.53° per rear wheel. A planar four-wheel model with Chrono's tires showed
toe alone accounting for the gap. Toe is a standard alignment setting and
a common tuning parameter, and Skidpad had no way to express it.

## Decision

Each axle gets `staticToeDeg`, the toe of each wheel in degrees, positive
toe-in, default 0, bounded at ±10. The four-wheel model adds it to each
wheel's road-wheel angle after the steering and Ackermann, mirrored left to
right, so the tire's slip, the contact axes and `WheelSteer_*` all carry it.
The mean steering angle (`SteerAngle`) and the steering jacking (ADR-0012)
follow the steering alone, since toe is set at ride height. The
single-track model ignores toe, as it ignores static camber, because the
two mirrored forces cancel on one tire.

## Alternatives considered

- **Toe as a slip-angle offset inside the tire.** Toe is a wheel angle, not
  a tire property: an offset would miss the drag from the rotated force
  and the change in the contact axes, and would need repeating in each
  tire model.
- **Toe that changes with travel (bump and roll steer).** That needs a
  per-axle steer curve against travel, and the measurements to fill it. A
  fixed toe covers the alignment setting; travel-dependent steer belongs
  with suspension kinematics after 1.0.
- **Total toe per axle instead of per wheel.** Alignment sheets quote both;
  per wheel matches how `staticCamberDeg` is quoted and halves nothing by
  surprise.

## Consequences

Definitions without the field behave exactly as before, so the presets,
golden results and recorded laps are unchanged. A toed-in car runs
straight with the tires pulling against each other, coasts down a little
sooner, responds later to a step steer, and still parks on slopes:
`crates/skidpad-core/tests/toe_tests.rs` guards each. The Chrono comparison
now sets Chrono's toe, which keeps the effect checked against an
independent model.
