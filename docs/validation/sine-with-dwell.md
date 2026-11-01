# Stability control: the FMVSS 126 sine with dwell

2026-11-01. The US test that every new light vehicle's electronic
stability control (ESC) must pass, run on the road presets.

## The run

`sineWithDwell` (`crates/skidpad-core/src/validation/sine_with_dwell.rs`,
exposed as `runScenario({ scenario: "sineWithDwell" })`) follows
[49 CFR 571.126](https://www.ecfr.gov/current/title-49/subtitle-B/chapter-V/part-571/subpart-B/section-571.126):

1. **Slowly increasing steer (S7.6).** At a held 80 km/h the hand wheel
   turns at 13.5°/s toward 0.5 g, each way. A line fitted to hand-wheel
   angle against lateral acceleration between 0.1 g and 0.375 g gives `A`,
   the angle for 0.3 g, averaged over the two directions.
2. **Sine with dwell (S7.9).** From 80 km/h, coasting, the hand wheel
   follows a 0.7 Hz sine. It holds for 500 ms at the second peak, then
   finishes the cycle, so the steer is complete 1.93 s after it starts.
   Amplitudes run 1.5A, 2A, … in steps of 0.5A up to the larger of 6.5A
   and 270°, capped at 300°, starting left and starting right.
3. **Criteria (S5.2).** The yaw rate 1.0 s and 1.75 s after the steer is
   complete may be at most 35 % and 20 % of the first yaw-rate peak after
   the steer reverses. On runs at 5A or more, the centre of mass must have
   moved at least 1.83 m sideways 1.07 s after the beginning of steer (the
   moment the hand wheel passes 5°).

The steering assist for digital inputs is turned off, since it would cut
the commanded angle. Each run starts from a fresh car, so the regulation's
rest between runs and tire conditioning have no counterpart.

The regulation filters measured signals (a 6 Hz Butterworth, corrections
for roll and sensor position) and finds the displacement by integrating
the lateral acceleration twice. The model's values carry no noise, so the
yaw rate is read as it is, and the displacement is the centre of mass's
distance from the line it was on at the beginning of steer.

`crates/skidpad-core/tests/sine_with_dwell_tests.rs` checks the steer's
timing against the regulation, that `A` sits just above the linear-theory
angle, and that the hatchback spins out of a 270° run without stability
control and passes it, both ways, with it.

## Results

Printed by `pnpm validate` and held in the goldens. The kart and the
open-wheeler are outside the regulation and not run.

| Preset     | A (deg) | ESC           | Runs | Worst yaw ratio, 1.0 s / 1.75 s | Least displacement (m) | Result       |
| ---------- | ------- | ------------- | ---- | ------------------------------- | ---------------------- | ------------ |
| Hatchback  | 19.6    | off (shipped) | 52   | 0.80 / 0.74                     | 3.24                   | fails at 88° |
| Hatchback  | 19.4    | on            | 52   | 0.01 / 0.00                     | 3.16                   | passes       |
| Sports car | 15.3    | on (shipped)  | 68   | 0.00 / 0.00                     | 3.56                   | passes       |
| Pickup     | 27.3    | off (shipped) | 36   | 1.25 / 1.29                     | 2.93                   | fails at 96° |
| Pickup     | 27.3    | on            | 36   | 0.94 / 0.82                     | 2.89                   | fails at 96° |
| Crossover  | 16.8    | off (shipped) | 62   | 1.49 / 1.58                     | 3.33                   | fails at 67° |
| Crossover  | 16.8    | on            | 62   | 0.97 / 0.89                     | 3.28                   | fails at 75° |

- **Without stability control** every road preset spins out once the
  amplitude passes about 4 to 5 times `A`. A ratio above 1 means the car
  was still yawing the wrong way faster than its peak a second later: it
  had spun.
- **The hatchback and the sports car pass with it.** Their worst yaw
  ratios are 0.01 and 0, and both move well over the 1.83 m.
- **The pickup and the crossover fail even with it.** The assist's default
  gain of 1500 N·m per rad/s of yaw-rate error is too weak for cars of
  2.1 to 2.4 t with yaw inertias of 3600 to 5200 kg·m². In a probe outside
  the goldens both passed at a gain of 5000 (pickup worst ratio 0.17,
  crossover 0), with displacement still over 2.8 m. Neither preset ships
  with stability control on, so nothing they do changes. Turning it on
  with a gain sized for their mass is a separate proposal.
- All runs move the car more than 1.83 m, so no preset is held back by the
  responsiveness criterion.
