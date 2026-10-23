# Hands-off force feedback

2026-10-23. A Node harness (`apps/sandbox/src/ffbLoop.ts`) closes the
force-feedback loop with nobody holding the wheel, so filter and damping
changes can be checked for a wheel that oscillates when released before
they reach a real wheel.

## The loop

- The rim has inertia `J`, the firmware's column damper and friction (the
  car's `columnDamping` and `columnFriction` times `gain × columnScale`, as
  `LogitechWebHidSink` sends them), and a stiff bump stop at ±540°. It is
  integrated at 1 kHz.
- Once per 60 Hz host step the rim angle becomes the steer input (over the
  car's lock, `ratio × maxWheelAngleDeg`), the core steps, and
  `SteeringTorqueMean` goes through `FfbScaler` to the motor, which holds it
  until the next step.
- Full scale is 4.4 N·m (G PRO peak 11 N·m × `maxOutput` 0.4), gain 0.5.
- `J` = 0.03 kg·m² [VERIFY]: the order of a direct-drive base with a
  300 mm rim. The damper's units on the device are not published either
  (`damperRate`, [VERIFY]), so the harness assumes the damping reaches the
  rim as sent.

The car is brought to speed in a straight line by the path follower, held
there with the throttle, and the rim is let go from 90° (30° at 100 km/h).
A release is **growing** when any half-cycle peak is more than 2 % above
the one before, **settled** when the rim is at rest at the end of 4 s, and
**moving** otherwise.

## Results

Printed by `FFB_REPORT=1 pnpm --filter @skidpad/sandbox exec vitest run src/ffbLoop.test.ts`.
Columns are 0, 30 and 100 km/h.

Today's scaler (slew 5 full-scale/s, smoothing 10 ms), column ×1:

| Preset       | 0 km/h  | 30 km/h | 100 km/h |
| ------------ | ------- | ------- | -------- |
| hatchbackFwd | settled | settled | growing  |
| sportsRwd    | settled | growing | growing  |
| kart         | settled | growing | growing  |
| pickup4x4    | settled | growing | settled  |
| crossoverEv  | settled | settled | growing  |
| openWheeler  | settled | settled | growing  |

Direct-drive scaler (slew 50 full-scale/s, smoothing 3 ms), column ×4:

| Preset       | 0 km/h  | 30 km/h | 100 km/h |
| ------------ | ------- | ------- | -------- |
| hatchbackFwd | settled | settled | settled  |
| sportsRwd    | settled | settled | settled  |
| kart         | settled | moving  | moving   |
| pickup4x4    | settled | settled | settled  |
| crossoverEv  | settled | settled | settled  |
| openWheeler  | settled | settled | settled  |

## What it shows

- Parked, every preset settles, and the cars with kingpin inclination
  return to near centre. Without the column damper and friction the parked
  hatchback's swing grows through the 60 Hz loop; the test suite keeps that
  case as the harness's own check.
- At speed, today's settings let the released wheel swing wider each cycle
  on most presets. The harness is not the cause alone: at a 1 kHz loop
  with no smoothing or slew the hatchback and kart still grow at 100 km/h
  with column ×1, so it is a free-control mode of the car and rim with too
  little steering damping, which the 60 Hz hold and today's slow slew
  limit make worse.
- Today's slew limit hurts rather than helps here: it delays the restoring
  torque, which is the phase lag that feeds the oscillation.
- More damping (column ×4) plus the direct-drive slew and smoothing settle
  every road car at 100 km/h. The kart, with no assist, light steering and
  a short lock, keeps moving.

Real hands-off behaviour depends on the two [VERIFY] numbers, so the first
on-wheel check is simply letting go at 100 km/h. The test suite asserts the
cases that hold today: every preset parked, the hatchback, crossover and
open-wheeler at 30 km/h, and the zero-damping check.
