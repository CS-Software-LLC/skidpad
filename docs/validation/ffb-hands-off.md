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
  300 mm rim. The damper's units on the device are not published either;
  `damperRate` has since been measured on a G PRO (8.5 rad/s, ADR-0032),
  and the harness assumes the damping reaches the rim as sent.

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

## With speed-sensitive damping

ADR-0033 lets the column damping rise with speed. The hatchback,
sports car, crossover, pickup and open-wheeler presets now go to four
times their parking damping by 20 m/s. The same matrix with those
presets:

Today's scaler, column ×1:

| Preset       | 0 km/h  | 30 km/h | 100 km/h |
| ------------ | ------- | ------- | -------- |
| hatchbackFwd | settled | settled | moving   |
| sportsRwd    | settled | growing | growing  |
| kart         | settled | growing | growing  |
| pickup4x4    | settled | growing | settled  |
| crossoverEv  | settled | settled | growing  |
| openWheeler  | settled | settled | growing  |

Direct-drive scaler, column ×1:

| Preset       | 0 km/h  | 30 km/h | 100 km/h |
| ------------ | ------- | ------- | -------- |
| hatchbackFwd | settled | settled | settled  |
| sportsRwd    | settled | settled | settled  |
| kart         | settled | moving  | growing  |
| pickup4x4    | settled | growing | settled  |
| crossoverEv  | settled | settled | growing  |
| openWheeler  | settled | settled | settled  |

- Speed damping on its own does not fix today's settings. The 0.2 s slew
  limit's delay dominates, so the direct-drive slew and smoothing are part
  of the fix.
- Together they settle the hatchback, sports car and open-wheeler at
  100 km/h, and the tests assert that, plus that the same release grows
  without the rise with speed. The crossover at 100 km/h and the pickup at
  30 km/h are still marginal. The verdicts there change with small changes
  of the inputs (a 2 % growth threshold over 4 s), so they are not tuned
  further before the rim inertia and the damper units are measured on the
  wheel.
- 140 km/h still grows on most cars at four times the damping.
- The kart, with no assist, a 2.5:1 ratio and no speed damping, needs
  about 0.6 N·m·s/rad at speed to settle in the harness. It is left alone:
  nobody lets go of a kart's wheel.

## The steering dead zone

2026-10-26. On a G PRO with the direct-drive defaults (PR #72), the wheel
could sit turned at speed on a straight with the car going straight. The
cause was the wheel axis's 2 % centre dead zone: 2 % of half the rotation,
which with the rotation matched to the car's lock is ±11° of rim on the
hatchback and pickup, ±10° on the crossover and ±8° on the sports car.
Inside it the core saw no steer, so the car did not turn and the aligning
torque was zero, and the column friction (0.25 to 0.4 N·m at the rim)
held the rim wherever it stopped.

Released from 15° at 100 km/h (`deadzone: 0.02` in the harness), the
hatchback's rim parked at 10.6° with zero yaw rate. With no dead zone it
returns to within half a degree on every road car, because the core's
on-centre torque is enough to beat the friction: at 100 km/h one degree
of rim gives 0.26 N·m on the hatchback and about 0.3 to 0.5 N·m on the
others at the rim (gain 0.5), the same as the friction, which still lets
the rim rest within about a degree. The wheel profiles now ship with no
steering dead zone, and the test suite asserts the return to centre and
the old parked rim.

## Parking twist

2026-11-01. With the parking twist on (ADR-0039) a G PRO's parked wheel
swung back and forth without stopping. The earlier releases started with
the car placed at the release angle, so the contact patches were never
wound up; `releaseWheel`'s `windUp` now turns the rim by hand from centre
first. Wound to 45° over a second and let go (playout, direct-drive slew,
column scale 2), the hatchback's rim swung between 41° and 45° for the
whole run: the twist was a spring of about 13 N·m/rad at the hand wheel
in the motor torque, one host step late.

Sent as wheel friction instead (ADR-0039 amendment A), every preset's rim
wound to 10°, 45° or 90° stays within a degree of where it was let go.
With the twist off the results are as before.

## Loop rate and delay

2026-11-10. `releaseWheel` takes `inputDelay` (the age of the rim angle
when the host reads it) and `outputDelay` (the host's output to the
motor's torque), both zero by default, so the delays the harness left out
can be put in once they are measured on a wheel
(`LogitechWebHidSink.measureLoop`). `releaseVerdict` no longer calls a
swing under half a degree growing: with the old rule a rim finding its
rest against the friction read as a failure. The crossover at 100 km/h
with the direct-drive scaler and column ×1 now reads settled; the other
verdicts in the tables above are as they were.

How fast the open-wheeler's swing dies at 100 km/h (direct-drive scaler,
column ×1), as the fourth half-cycle peak over the second:

| Loop                                   | Peak 4 / peak 2 |
| -------------------------------------- | --------------- |
| 60 Hz, one value held per step         | 0.95            |
| 60 Hz, slices played out one step late | 1.33            |
| 250 Hz (car stepped every 4 ms)        | 0.53            |
| 1 kHz                                  | 0.55            |

- The playout is smoother but one host step later, and that delay costs
  damping on every preset.
- A 250 Hz loop settles the rim about twice as fast as the 60 Hz ones,
  and a faster loop than that changes nothing.
- The kart grows at every rate (1.4 to 1.7): that is the car's own
  steering damping, not the loop.

The test suite asserts the order of the first three and that added delay
slows the settling.

## Measured on a G PRO

2026-11-18. `measureLoop()` on a G PRO: 201 reports a second (5.0 ms
each), the page's angle updating at 208 Hz, 15 ms from asking for a torque
to the page seeing its effect, a rim of about 0.016 kg·m², and a firmware
that ignores a constant force's duration (so `forceTimeout` does nothing
on it). On the wheel, the sports car let go at 100 km/h swung back and
forth violently.

`G_PRO_LOOP` holds those numbers for the harness (the 15 ms as 5 ms of
angle age and 10 ms to the motor, plus the base's 0.13 N·m of friction
from the damper measurement). With them and the sandbox's defaults
(playout, direct-drive scaler, column ×2), the swing left over the last
second of a 5 s release from 30°, before the retune:

| Preset       | 60 km/h | 100 km/h | 140 km/h |
| ------------ | ------- | -------- | -------- |
| hatchbackFwd | 0°      | 0°       | 0°       |
| sportsRwd    | 23°     | 23°      | 25°      |
| crossoverEv  | 0°      | 23°      | 24°      |
| pickup4x4    | 0°      | 0°       | 0°       |
| openWheeler  | 30°     | 76°      | 115°     |

The kart swung about 90° at 30 and 60 km/h. A rim half as heavy as
assumed swings faster, and the same delay is then more of its cycle.

What settles it in the harness: more damping at speed (1.5 times on the
sports car and crossover, 2.5 times on the open-wheeler, 0.6 N·m per
rad/s on the kart), or a 200 Hz loop for the road cars. The presets now
carry the damping (ADR-0033, amendment A), and the test suite asserts
that every preset is within 2° of rest at three speeds in this loop, and
that the sports car's old value is not.

## The fast wheel loop

The sandbox now steps at 240 Hz from a 4 ms timer while a force-feedback
wheel is connected, reads the wheel on every step and sends that step's
mean torque as it is (no playout). The 60 Hz loop with playout puts about
40 ms around the rim: up to a frame of angle age, a frame of playout, and
the wheel's own 15 ms. The fast loop leaves about 20 ms: a 4 ms step, a
few milliseconds waiting for the wheel's reply to the report before, and
the same 15 ms. `FAST_WHEEL_LOOP` is that loop for the harness (240 Hz,
no playout, 2.5 ms more on the way out for the wait).

With the damping the presets had before the retune (column ×2, 5 s from
30°), the swing left over the last second:

| Preset      | Speed    | 60 Hz + playout | Fast loop |
| ----------- | -------- | --------------- | --------- |
| sportsRwd   | 60 km/h  | 23°             | 0°        |
| sportsRwd   | 100 km/h | 23°             | 18°       |
| sportsRwd   | 140 km/h | 25°             | 18°       |
| crossoverEv | 100 km/h | 23°             | 0°        |
| crossoverEv | 140 km/h | 24°             | 0°        |
| openWheeler | 60 km/h  | 26°             | 0°        |
| openWheeler | 100 km/h | 35°             | 21°       |
| openWheeler | 140 km/h | 83°             | 28°       |

So the loop alone does not replace the retune: it is close to the edge,
and with the motor 2.5 ms quicker than assumed every row but the last
settles. With the retuned presets both loops settle everywhere, and the
fast one mostly sooner. Seconds until the rim stays within 2° of rest:

| Preset       | Speed    | 60 Hz + playout | Fast loop |
| ------------ | -------- | --------------- | --------- |
| hatchbackFwd | 100 km/h | 0.80            | 0.35      |
| sportsRwd    | 100 km/h | 1.05            | 0.58      |
| sportsRwd    | 140 km/h | 1.27            | 0.66      |
| crossoverEv  | 100 km/h | 0.75            | 0.43      |
| pickup4x4    | 100 km/h | 0.52            | 0.56      |
| openWheeler  | 100 km/h | 0.53            | 0.31      |
| openWheeler  | 140 km/h | 0.75            | 0.35      |
| kart         | 30 km/h  | 2.65            | 0.65      |

The hatchback at 140 km/h is the one case that takes longer (0.67 s
against 1.62 s). At **Column feel** 1× the hatchback, which swung 49° at
100 km/h in the 60 Hz loop, settles in the fast one; the sports car,
crossover, open-wheeler and kart still swing there in both. The test
suite asserts that every preset settles in the fast loop, and that the
sports car and crossover with their old damping settle in it where the
60 Hz loop does not.

On the wheel (2026-11-18) neither the retune nor the fast loop stopped
the swing.

## The cause: a centre two to three times too stiff

2026-11-18. The harness had been asked the wrong question. What decides
whether a released rim settles is the stiffness of the spring it sits on
against the damping, since a spring felt through a delay feeds the swing
by about its stiffness times the delay. Measured with a ±2° sine at 5 Hz
and 100 km/h, the assisted presets gave the hand wheel 0.40 to 0.70 N·m
per degree, against roughly 0.2 to 0.35 on road cars [VERIFY], because
the assist did nothing on centre and little at speed, and the cars are
about twice as sharp per degree as road cars (ADR-0040).

The sports car with a constant assist of 0.65 (0.27 N·m per degree) stays
still on the G PRO when let go at 100 km/h, with nothing else changed.

With the on-centre assist of ADR-0040 in the presets (0.22 to 0.30 N·m
per degree), seconds until the rim stays within 2° of rest after a release
from 30°, or the swing left after 6 s:

| Preset       | Column | 60 km/h | 100 km/h | 140 km/h |
| ------------ | ------ | ------- | -------- | -------- |
| hatchbackFwd | 1×     | 0.35    | 0.93     | 11°      |
| hatchbackFwd | 2×     | 0.18    | 0.70     | 2.03     |
| sportsRwd    | 1×     | 0.48    | 0.68     | 1.35     |
| sportsRwd    | 2×     | 0.18    | 0.54     | 0.89     |
| crossoverEv  | 1×     | 0.35    | 0.31     | 2.43     |
| crossoverEv  | 2×     | 0.15    | 0.71     | 2.18     |
| pickup4x4    | 1×     | 0.30    | 0.55     | 2.42     |
| pickup4x4    | 2×     | 0.16    | 0.17     | 0.79     |

That is the fast loop; the 60 Hz loop with playout is within a second of
it everywhere but the crossover at 1× and 140 km/h, which keeps a 6°
swing. What is left at 140 km/h is a different, slower swing (about
1.3 Hz against 4 to 5 Hz before): the car's own yaw answering a free
wheel, which a softer centre brings the rim's swing closer to. It is why
the damping of the retune above stays, and why the hatchback's went from
0.16 to 0.24.

The kart and open-wheeler have no assist. They are unchanged (0.9 at
60 km/h and 0.49 N·m per degree), settle at column 2× and swing at 1×.

The harness predicted the retune and the fast loop would be enough, and
on the wheel they were not, so it flatters the real loop somewhere (the
delay, or what the firmware damper really delivers). Its numbers here are
for comparing changes, and the wheel has the last word.
