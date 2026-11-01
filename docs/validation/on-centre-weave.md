# On-centre weave

2026-11-01. The validation runner's `weave` scenario
(`crates/skidpad-core/src/validation/weave.rs`) puts numbers on on-centre
steering feel, which until now could only be judged on a wheel. It follows
the ISO 13674-1 weave test and reports Norman's on-centre metrics
(SAE 840069).

## The manoeuvre

- 100 km/h held by the speed controller, the hand wheel following a
  0.2 Hz sine sized by linear theory for 0.2 g peak. One cycle settles, two
  are measured, at a 100 Hz host step.
- The speed-sensitive steering assist (an input aid that shrinks the lock
  at speed) is off, so the hand wheel follows the sine exactly.
- **Lateral acceleration** is what a body accelerometer reads, averaged over
  the host step. `vx·r` alone misses the side-slip rate and lags it.
- **Driver torque** is the core's hand-wheel torque averaged over the host
  step (the `SteeringTorqueMean` of ADR-0031), plus the column friction and
  damping the force-feedback device adds (`columnFriction`, and
  `columnDamping` at 100 km/h per ADR-0033), worked out from the known
  hand-wheel rate. Positive steers left.
- Each number is a straight-line fit over the samples within 0.03 g of
  where it is read, on the left-going and right-going halves of the loop
  separately.

## Metrics

| Metric                   | Meaning                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------- |
| Torque at 0 g            | Half the width of the torque loop where the car is going straight: friction and lag |
| Torque gradient at 0 g   | How fast the wheel weights up on centre, N·m per g (mean of both halves)            |
| Torque gradient at 0.1 g | The same a little off centre, where a boost-curve assist comes in                   |
| Steering sensitivity     | Lateral g per 100° of hand wheel at 0 g                                             |
| Angle hysteresis         | Width of the angle loop at 0 g: how far the wheel turns before the car does         |

The runner prints these for every preset, and the goldens hold them.

## Results

The torques are at the car's hand wheel. A force-feedback rim gets them
times the scaler's gain (0.5 by default).

| Preset       | Torque at 0 g (N·m) | Gradient at 0 g (N·m/g) | At 0.1 g (N·m/g) | Sensitivity (g/100°) | Angle hysteresis (deg) | Peak (g, N·m) |
| ------------ | ------------------- | ----------------------- | ---------------- | -------------------- | ---------------------- | ------------- |
| hatchbackFwd | 0.50                | 21.4                    | 15.2             | 2.43                 | 3.0                    | 0.20, 3.6     |
| sportsRwd    | 0.63                | 28.6                    | 22.8             | 2.84                 | 1.7                    | 0.18, 4.5     |
| kart         | 0.45                | 13.3                    | 12.5             | 17.04                | 0.2                    | 0.10, 1.6     |
| pickup4x4    | 0.81                | 31.1                    | 18.7             | 1.77                 | 4.4                    | 0.20, 4.5     |
| crossoverEv  | 0.73                | 33.1                    | 22.9             | 3.09                 | 3.3                    | 0.20, 5.2     |
| openWheeler  | 0.33                | 16.9                    | 16.9             | 3.37                 | 0.8                    | 0.18, 3.3     |

## What it shows

- **The boost curve works as ADR-0029 intends.** On the four assisted road
  cars the gradient at 0.1 g is 20 to 40 % below the on-centre one, because
  the assist comes in around 1 N·m of manual torque. With the assist
  removed, the hatchback's on-centre gradient barely moves (21.4 to
  22.6 N·m/g), while its 0.1 g gradient rises from 15.2 to 22.5 N·m/g. The
  open-wheeler has no assist, and its two gradients match.
- **The column is most of the on-centre torque.** Column friction and
  damping make up 0.21 to 0.46 N·m of the torque at 0 g. Without them the
  core's own loop is 0.05 to 0.41 N·m wide, from the lag of the car's
  response (tire relaxation, yaw and roll) behind the hand wheel.
- **The kart is the outlier.** It has a 2.5:1 ratio (17 g per 100°) and a
  locked rear axle that pushes, so it reaches only 0.1 g on the sine
  linear theory sized for 0.2.
- **Pickup and crossover** carry the most torque at 0 g and the widest
  angle loops; the pickup also has the highest column friction of the road cars
  (0.4 N·m).

These are the model's own numbers, not road-test measurements of real
cars. Their use is in comparing presets and catching regressions, and in
checking what a change to the assist curve, the column values or the tire
does to the feel before it reaches a wheel.

## Checks

`crates/skidpad-core/tests/weave_tests.rs`:

- both models reach 0.2 g within 0.04;
- 500 Hz and 1 kHz substeps agree with 2 kHz within 2 % on the gradient and
  the sensitivity, and within 0.03 N·m on the torque at 0 g;
- the column terms widen the loop by their own share within 10 %, and move
  the gradient by under 2 %;
- the manual twin of the hatchback matches it on centre within 10 % and
  is at least 20 % steeper at 0.1 g, with the same sensitivity.
