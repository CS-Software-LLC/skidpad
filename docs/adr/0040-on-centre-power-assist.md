# ADR-0040: On-centre power assist

- Status: Proposed
- Date: 2026-11-18
- Supersedes / superseded by: extends the boost curve of ADR-0029 and the
  speed fade of ADR-0034

## Context

On a direct-drive wheel (a Logitech G PRO), every assisted preset let go
at 100 km/h swung back and forth without stopping. More column damping
(ADR-0033, amendment A) and a faster loop (ADR-0032, amendment A) did not
stop it on the wheel.

The rim is a small mass (0.016 kg·m² measured) on the spring the car
gives the hand wheel, driven through the 20 to 40 ms of the loop. A
delayed spring feeds the swing, and the damping it takes to stop it is
about the spring's stiffness times the delay. So the stiffness on centre,
in N·m per degree of hand wheel, decides it.

Measured in the core with a ±2° sine at 5 Hz and 100 km/h, the hand wheel
carried:

| Preset       | Before (N·m/deg) | With this ADR |
| ------------ | ---------------- | ------------- |
| hatchbackFwd | 0.40             | 0.22          |
| sportsRwd    | 0.70             | 0.30          |
| crossoverEv  | 0.69             | 0.28          |
| pickup4x4    | 0.50             | 0.27          |

Road cars carry roughly 0.2 to 0.35 N·m per degree there [VERIFY against a
published on-centre test; these are remembered ranges, not a cited
source]. The path was checked for anything else first: the sign is right,
the column friction and damping are not in the torque twice, the road
wheels follow the input with no filter, and the torque is within 15° of
phase of the angle from 2 to 6 Hz.

Two things made the centre that stiff:

- The boost curve (ADR-0029) leaves the centre manual on purpose, and the
  speed fade (ADR-0034) took the assist down to 0.25 to 0.5 at speed. On
  centre every car was an unassisted rack.
- The cars answer the wheel about twice as sharply as road cars (1.8 to
  3.1 g per 100° in the weave test) because the presets have no steering
  compliance. Per g of cornering the torque was in a road car's range (21
  to 33 N·m/g); per degree it was two to three times it.

Confirmed on the wheel on 2026-11-18: the sports car with a constant
assist of 0.65 (0.27 N·m/deg) stays still when let go at 100 km/h, with
nothing else changed.

## Decision

One steering field, `powerAssistOnCentre` (`c`, 0 … 1, default 0): the
share of the assist that already works on centre. With manual torque
`Tm`, assist `a` and onset `T₀`:

```text
SteeringTorque = (1 − a)·Tm + a·(1 − c)·Tm / √(1 + (Tm / T₀)²)
```

The slope is `1 − a·c` on centre and `1 − a` far from it, rising
everywhere. Zero is the curve of ADR-0029 bit for bit, and without an
onset the field does nothing.

With `powerAssistFadeStart` set, `c` comes in linearly from rest to that
speed (`power_assist_on_centre_at`). Parked, the hand torque is then what
it was, and with it the self-centring from the kingpin lift (ADR-0030),
which a lighter centre would have left short of the column friction.

The four assisted presets [ILLUSTRATIVE]:

| Preset       | `powerAssistAtSpeed` | `powerAssistOnCentre` | Centre slope at speed |
| ------------ | -------------------- | --------------------- | --------------------- |
| hatchbackFwd | 0.6 (from 0.35)      | 0.75                  | 0.55 of manual        |
| sportsRwd    | 0.65 (from 0.25)     | 0.9                   | 0.415                 |
| crossoverEv  | 0.7 (from 0.4)       | 0.9                   | 0.37                  |
| pickup4x4    | 0.65 (from 0.5)      | 0.77                  | 0.50                  |

`powerAssist` (the parking value) is unchanged, so on the sports car and
crossover the assist now rises a little with speed instead of falling.
That is the price of a road car's stiffness per degree on a car that is
twice as sharp as one; it should go back once the presets have steering
compliance.

## Alternatives considered

- More damping at the device. It treats the symptom, weighs the wheel
  down in the hands, and did not hold on the wheel.
- Lower force-feedback gain. The device damping scales with the gain, so
  the margin does not improve, and the whole car goes light.
- A constant assist fraction (no onset). It is what the confirming test
  used, but it gives up the centre the boost curve was added for: with
  `c` below 1 the centre is still 12 to 22 % firmer than at 0.1 g.
- Steering compliance first (ADR-0027). It is the other half of the cause
  and would cut the stiffness per degree by itself, but it changes the
  handling and every validation number that depends on it.

## Consequences

- `SteeringTorque`, its slices and parts change on the four presets; the
  motion, state hashes and determinism laps do not.
- The weave scenario's on-centre gradients fall to 12 to 17 N·m/g, on the
  light side of a road car's per g for the reason above.
- Peak torque on a ramp steer at 80 km/h falls from 8.8 to 15.2 N·m to
  5.9 to 8.6 N·m, so the default force-feedback gain of 0.5 no longer
  clips the assisted cars from 0.4 g.
- In the hands-off harness the assisted cars settle at 60 and 100 km/h in
  both loops at column feel 1× and 2×, with the damping of before
  amendment A of ADR-0033 as well. At 140 km/h a slower swing (about
  1.3 Hz, the car's own yaw answering the free wheel) is left at 1× on the
  hatchback and, in the 60 Hz loop, the crossover; it settles at 2×. The
  hatchback's `columnDampingAtSpeed` goes from 0.16 to 0.24 for it, and
  the damping of amendment A stays.
- The kart and open-wheeler have no assist and are unchanged: 0.9
  (at 60 km/h) and 0.49 N·m per degree, and they rely on column feel 2×.
- The rim comes to rest a little further from centre (up to 1.1° on the
  hatchback, from under 1°), since the same friction holds it against a
  softer spring.
- `on_centre_assist_lowers_the_slope_on_centre_only` checks the curve and
  the fade exactly; the weave test checks the hatchback's centre against
  its manual twin; the harness tests assert that the old stiff centre
  swings and the new one settles with the old damping.
