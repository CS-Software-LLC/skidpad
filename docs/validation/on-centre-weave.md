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
| hatchbackFwd | 0.42                | 11.9                    | 9.2              | 2.43                 | 3.0                    | 0.20, 2.2     |
| sportsRwd    | 0.47                | 12.2                    | 10.7             | 2.83                 | 1.7                    | 0.18, 2.2     |
| kart         | 0.45                | 13.3                    | 12.5             | 17.04                | 0.2                    | 0.10, 1.6     |
| pickup4x4    | 0.65                | 16.6                    | 12.9             | 1.78                 | 4.4                    | 0.20, 3.1     |
| crossoverEv  | 0.51                | 13.2                    | 11.4             | 3.09                 | 3.3                    | 0.20, 2.6     |
| openWheeler  | 0.35                | 16.9                    | 16.9             | 3.37                 | 0.8                    | 0.18, 3.3     |

## What it shows

- **The assisted cars are light on centre by design (ADR-0040).** Before
  2026-11-18 the boost curve left the centre manual, and the four assisted
  road cars read 21 to 33 N·m/g on centre. Against the angle that was 0.4
  to 0.7 N·m per degree of hand wheel, two to three times a road car's,
  and on a direct-drive wheel a released rim swung without stopping. With
  the on-centre share of the assist they carry 0.22 to 0.30 N·m per
  degree. The gradient at 0.1 g is still 12 to 22 % below the on-centre
  one, so the wheel keeps a centre. The open-wheeler has no assist, and
  its two gradients match.
- **Per g the assisted cars are now on the light side** (12 to 17 N·m/g).
  That is the other face of their sensitivity: 1.8 to 3.1 g per 100° is
  about twice what road cars measure, because the presets have no
  steering compliance, so the same torque per degree is half the torque
  per g. Steering compliance (ADR-0027) is the fix for that, and it
  changes the handling, so it is its own piece of work.
- **The column is most of the on-centre torque.** Column friction and
  damping make up 0.24 to 0.46 N·m of the torque at 0 g. Without them the
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
- the manual twin of the hatchback matches it on centre within 12 % with
  the on-centre assist off, the hatchback carries `1 − a·c` of the manual
  gradient on centre with it on (within 10 %), and the manual twin is at
  least 20 % steeper at 0.1 g, with the same sensitivity.
