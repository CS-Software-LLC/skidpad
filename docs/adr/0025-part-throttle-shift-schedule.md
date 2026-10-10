# ADR-0025: A part-throttle shift schedule for the automatic

- Status: Proposed
- Date: 2026-10-03
- Supersedes / superseded by: none

## Context

The automatic (ADR-0011) upshifted when the gearbox input passed
`shiftUpAt × redline` and downshifted below `shiftDownAt × redline`, whatever
the throttle. A game's friction log (F-25) reported that the single-track
model "holds first gear at part throttle" while the four-wheel model shifts
to second. A probe showed the two models agree: the hatchback driven by the
path-following driver at 12 m/s sits in first at about 5,560 rpm with a
throttle of about 0.23 on both. The four-wheel car in the game had passed
the upshift point once during launch wheelspin. The defect is that there is
no part-throttle schedule. A real automatic shifts early on a light pedal,
late on a heavy one, and kicks down when the pedal goes in. It does this
with upshift and downshift lines over pedal position and road speed, kept
apart so it does not hunt between gears (Naunheimer, Bertsche, Ryborz and
Novak, _Automotive Transmissions_, 2nd ed., Springer 2011, ch. 8 on shift
strategies).

Constraints:

- Full-throttle behaviour stays exactly as it is. Launches, 0–100 km/h and
  the straight-line validation must not move.
- No gear hunting at a held speed. This includes a driver that adds throttle
  after an upshift to keep the same wheel torque.
- No new state, so the snapshot and replay formats stay the same.
- The gzipped WASM stays under the 200 KB budget. Before this change it had
  about 500 bytes to spare.

## Decision

One new transmission parameter, `shiftLightFactor` in (0, 1], default 0.55:
the shift points on a closed throttle as a fraction of the full-throttle
points. For a driver's pedal `p`:

- The downshift point is `shiftDownAt × lerp(shiftLightFactor, 1, p)`.
  Pressing the pedal raises it, and that is the kickdown.
- The upshift point out of gear `g` is `shiftUpAt × lerp(shiftLightFactor,
1, p)`, raised where needed so that the gearbox input just after the shift
  lands at least `UPSHIFT_MARGIN` (1.15) above the next gear's downshift
  point. That downshift point is taken at the throttle the next gear needs
  for the same wheel torque, `min(p × r_g / r_{g+1}, 1)`. The result is
  capped at `shiftUpAt`.
- At `p = 1` both points are exactly `shiftUpAt` and `shiftDownAt` (the
  schedule returns the full-throttle point directly; it does not compute
  the interpolation). Full-throttle runs are bit-identical to before.
- The schedule reads the driver's pedal, not the throttle after traction
  or stability control (`Drivetrain::step_with_pedal`). An assist cutting
  the throttle mid-corner must not upshift.
- With the brake above 0.05 the automatic uses the full-throttle points.
  Lifting to brake does not upshift, and downshifts on the brakes come at the
  same speed as before.

`shiftLightFactor: 1` restores the old fixed points. The single-speed
presets (kart, crossover EV) and the Chrono comparison vehicle use it.

## Alternatives considered

- **Separate closed-throttle upshift and downshift points (two
  parameters).** This was the first version, and it is more flexible. The
  serde code for the two fields alone took about 700 of the 500 bytes of
  WASM headroom. One factor is also easier to tune, and the hysteresis
  floor already stops the two lines from crossing.
- **Interpolate only the upshift point, keep `shiftDownAt` fixed.** This
  cannot work. On the hatchback, first to second is a 1.82 step, so landing
  15 % above a 42 % downshift point needs an upshift at 88 % of redline.
  Part-throttle upshifts out of the low gears would be impossible.
- **A separate kickdown (pedal-rate trigger, or a jump of several gears).**
  This needs to remember the pedal or the shift history, which is new
  snapshot state. Any stateless kickdown that downshifts above
  `shiftDownAt` also changes sustained full-throttle driving, for example
  on a slowing climb. The downshift line that rises with the pedal is
  enough to kick down from the gears the part-throttle schedule picks at
  low engine speed.
- **Schedule on the throttle after the assists.** This is simpler, but a
  traction-control cut during a launch, or a stability-control cut in a
  corner, would upshift.
- **Filter the pedal.** Not needed. The hysteresis floor already covers
  the throttle a speed-holding driver adds after an upshift, and a filter
  would be new state.

## Consequences

- A speed-holding driver now cruises in a sensible gear. The F-25 case
  (hatchback, 12 m/s) is in second at about 3,060 rpm on both models.
  Across the four multi-gear presets, both models, and held speeds from 5
  to 40 m/s, every gear change is an upshift and none happens after the
  first 30 s.
- Lifting off without braking upshifts. Pressing the pedal can kick down one
  gear per `shiftHold`, but no further than `shiftDownAt` allows. Floored
  in a tall gear above `shiftDownAt`, the car stays in that gear, as it did
  before at the same engine speed.
- Validation results that hold part throttle move: the lane change, the
  step steer, the timestep sweep, and the scripted drive hash. The goldens
  are regenerated. Straight-line acceleration and braking do not move. The
  determinism laps for the multi-gear presets are re-recorded, because
  open-loop inputs recorded under the old schedule drift off the track.
- `match_speed` (spawning at speed) still picks the gear from the
  full-throttle point. The schedule then upshifts as soon as the hold
  allows, if the throttle is light.
- WASM headroom is down to about 12 bytes gzipped. The next feature in the
  core will need size work first.
- Guarded by `drivetrain_tests.rs`:
  `the_shift_points_meet_the_full_throttle_points_and_keep_their_hysteresis`,
  `a_part_throttle_cruise_upshifts_on_both_models`,
  `full_throttle_shifts_at_the_same_speeds_as_before`,
  `flooring_the_pedal_kicks_down_from_a_part_throttle_gear` and
  `lifting_upshifts_but_lifting_to_brake_does_not`.

## Amendment: the engine flares up on a downshift (2026-10-10)

The NHTSA Jeep Cherokee comparison (`docs/validation/nhtsa-jeep-cherokee.md`)
held 11 m/s in second at about 1,600 rpm on the slowly increasing steer.
Near the cornering limit the speed controller's throttle reached 0.465,
where second's downshift point is, and the box kicked down to first, as
this schedule intends. The kickdown spun the car. The schedule was not the
cause. The automatic (ADR-0011) lifted the throttle whenever the clutch was
open for a shift. That is right for an upshift, where the engine has to come
down to the taller gear. On a downshift it has to come up. With the throttle
lifted the engine fell from 1,610 to 1,210 rpm through the 0.4 s
interruption, and the re-engaging clutch then dragged it up to first gear's
2,950 rpm with the wheels: 240 N·m back through the clutch and a rear
drive force of −3.6 kN at 7 m/s² of lateral acceleration.

While the clutch is open, an automatic now keeps the driver's throttle as
long as the engine is below the new gear's input speed. The throttle closes
over the last 3 % of redline below that speed, and above it the throttle is
lifted as before. A power-on downshift flares the engine to the lower
gear's speed, and the clutch re-engages near sync. An upshift starts with
the engine above the new gear's speed, so it is lifted as before; on every
preset and on both models, full-throttle and constant-throttle runs are
bit-identical. On the Jeep the engine reaches 2,780 rpm before
re-engagement, the clutch closes within 1.1 rad/s of sync, the rear drive
force dips to about −60 N, and the car carries on round the turn in first.
A closed-throttle (coasting) downshift is also unchanged: with no pedal
there is nothing to flare on, and the clutch pulls the engine up as before.

Guarded by `drivetrain_tests.rs`:
`a_kickdown_flares_the_engine_up_instead_of_dragging_it_with_the_wheels`.
