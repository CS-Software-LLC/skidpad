# Skidpad against Project Chrono: BMW E90

|           |                                                                                                    |
| --------- | -------------------------------------------------------------------------------------------------- |
| Date      | 2026-10-01                                                                                         |
| Reference | [Project Chrono](https://projectchrono.org) 9.0.1 (PyChrono, conda), `BMW_E90` model, BSD-3-Clause |
| Skidpad   | core with static toe (ADR-0017), four-wheel model, 1 kHz                                           |
| Harness   | [`tools/chrono-compare`](../../tools/chrono-compare)                                               |

Chrono is an independent, research-grade multibody simulator. Its BMW_E90 is a
330i-class sedan with a MacPherson front and double-wishbone rear modelled as
linkages, anti-roll bars, TMsimple tires, an engine torque map and a six-speed
automatic. Both simulators drive the same eight scripted manoeuvres with the
same pedal schedules and the same PI speed controller, and the results are
compared metric by metric and trace by trace. This is a behavioural
comparison as `docs/clean-room.md` allows: Chrono's published constants are
inputs to a Skidpad definition, and no Chrono code is used.

The manoeuvres, the Chrono driver script and its first reference data come
from the sibling project `csummers88/vehicle-physics-new`, which ran the same
comparison for its own engine. The script here also logs every wheel's
road-wheel angle. It reproduces the sibling's data exactly for seven of the
eight manoeuvres. The standing start differs from its first sample, where
the contact settling is sensitive to run order, and agrees on every metric:
0–100 km/h is 7.209 s in both.

## How the Skidpad model was built

Every parameter comes from Chrono's source or its measured state, except
one pair:

- **Taken from Chrono:** mass, inertia about the centre of mass,
  centre-of-mass position, wheelbase and track, spring and damper wheel
  rates, spring stops, wheel and driveline inertias, brake torque, engine
  map, gear and final-drive ratios, aero drag.
- **Derived:** roll-centre heights from the suspension hardpoints, by the
  front-view instant-centre construction after solving each linkage for
  Chrono's static ride height (front 0.176 m, rear 0.116 m; the solved
  spindle positions agree with Chrono's to 0.1 mm). Spring rates are in
  series with the tire's vertical stiffness, because Skidpad's wheel is
  rigid. The engine's closed-throttle drag is a least-squares line through
  Chrono's map over the speeds the manoeuvres use.
- **Measured:** static toe, from Chrono's own road-wheel angles while it
  drives straight before the steering moves: 1.43° toe-in per front wheel
  and 0.67° per rear wheel. Every manoeuvre's straight section agrees within
  0.03°. At rest Chrono's linkage sits at 1.27° and 0.53°.
- **Tire:** TMsimple carried into Skidpad's Magic Formula. Peak friction
  and longitudinal stiffness match exactly at every load. The lateral
  stiffness matches at the nominal load and at 1.5 times it. The curve shape
  is a least-squares fit, within 5 % of TMsimple's peak force out to 0.3 rad
  laterally and within 8 % out to a locked wheel longitudinally.
- **Fitted:** the anti-roll bar wheel rates, 12 750 N/m front and 6 000 N/m
  rear. Chrono's bars act through linkages Skidpad does not model, so they
  are identified from Chrono's roll gradient and front share of lateral load
  transfer on the steering ramp. Those two metrics are therefore not
  predictions.

Skidpad's steering is kinematic, so the harness steers it with Chrono's
logged mean front road-wheel angle, and the toe comes from the definition.
The mean angle carries the steering ratio curve, Ackermann and the front
axle's net roll steer across, so those stay out of the comparison.

## Results

The tolerances were set before the first run, from what each metric is for.
Lateral acceleration is speed times yaw rate. Roll and pitch are measured
from their values at the start of each manoeuvre.

| Manoeuvre    | Metric                                   | Chrono | Skidpad | Difference (tolerance) |         |
| ------------ | ---------------------------------------- | ------ | ------- | ---------------------- | ------- |
| accel        | 0–60 km/h (s)                            | 3.59   | 3.59    | 0.0 % (±10 %)          | pass    |
| accel        | 0–100 km/h (s)                           | 7.21   | 7.02    | −2.6 % (±10 %)         | pass    |
| accel        | speed at 30 s (km/h)                     | 209    | 211     | 0.8 % (±5 %)           | pass    |
| coast        | speed at 20 s (km/h)                     | 74.5   | 69.8    | −6.3 % (±5 %)          | outside |
| brake100     | stopping distance, wheels locked (m)     | 40.4   | 40.8    | 1.1 % (±5 %)           | pass    |
| brakeHalf    | stopping distance, 0.4 pedal (m)         | 79.0   | 71.5    | −9.5 % (±5 %)          | outside |
| brakeHalf    | pitch per g of braking (deg/g)           | 4.37   | 2.39    | −45 % (±20 %)          | outside |
| rampSteer    | understeer gradient (deg/g)              | 0.20   | 0.01    | −0.19 (±0.3)           | pass    |
| rampSteer    | lateral acceleration at 15 s (g)         | 0.70   | 0.72    | 2.2 % (±5 %)           | pass    |
| rampSteer    | peak lateral acceleration (g)            | 0.91   | 0.89    | −2.9 % (±5 %)          | pass    |
| rampSteer    | roll gradient (deg/g)                    | 3.76   | 3.77    | 0.3 %                  | fitted  |
| rampSteer    | front share of lateral load transfer (%) | 55.4   | 55.4    | 0.0                    | fitted  |
| rampSteer    | body slip gradient (deg/g)               | 0.58   | 0.68    | +0.11 (±0.3)           | pass    |
| rampSteer    | pitch in the turn at 0.7 g (deg)         | 0.34   | −0.01   | −0.35 (±0.2)           | outside |
| stepSteer    | steady yaw rate (deg/s)                  | 14.5   | 14.9    | 2.8 % (±10 %)          | pass    |
| stepSteer    | yaw rate overshoot (%)                   | 2.9    | 4.1     | +1.1 (±5)              | pass    |
| stepSteer    | yaw rate response time, ISO 7401 (s)     | 0.24   | 0.22    | −7.9 % (±20 %)         | pass    |
| stepSteer    | lateral acceleration response time (s)   | 0.25   | 0.22    | −11.6 % (±20 %)        | pass    |
| stepSteer    | steady lateral acceleration (g)          | 0.57   | 0.59    | 2.8 % (±10 %)          | pass    |
| stepSteer    | steady roll (deg)                        | 2.13   | 2.22    | 3.9 % (±15 %)          | pass    |
| sineSteer    | peak yaw rate (deg/s)                    | 14.5   | 15.3    | 5.1 % (±10 %)          | pass    |
| sineSteer    | peak lateral acceleration (g)            | 0.57   | 0.60    | 5.1 % (±10 %)          | pass    |
| sineSteer    | yaw rate lag behind steer (ms)           | 190    | 160     | −16 % (±20 %)          | pass    |
| sineSteer    | peak roll (deg)                          | 1.82   | 2.11    | 15.7 % (±15 %)         | outside |
| lowSpeedTurn | turn radius (m)                          | 10.2   | 10.3    | 1.2 % (±5 %)           | pass    |

Traces, as RMS difference over the manoeuvre divided by Chrono's range
(tolerance 5 %):

| Manoeuvre    | Channel         | Difference |         |
| ------------ | --------------- | ---------- | ------- |
| accel        | speed           | 1.1 %      | pass    |
| coast        | speed           | 8.0 %      | outside |
| brakeHalf    | speed           | 4.0 %      | pass    |
| brakeHalf    | pitch           | 39 %       | outside |
| rampSteer    | yaw rate        | 1.4 %      | pass    |
| rampSteer    | roll            | 3.9 %      | pass    |
| rampSteer    | front-left load | 3.3 %      | pass    |
| rampSteer    | rear-left load  | 7.4 %      | outside |
| stepSteer    | yaw rate        | 2.8 %      | pass    |
| stepSteer    | roll            | 4.5 %      | pass    |
| sineSteer    | yaw rate        | 1.9 %      | pass    |
| sineSteer    | roll            | 7.5 %      | outside |
| lowSpeedTurn | yaw rate        | 1.1 %      | pass    |

18 of 23 predicted metrics and 9 of 13 traces are within tolerance. Steady
and transient handling now both agree: understeer, lateral acceleration to
the limit, yaw gain, roll, the step-steer response and the sine-steer lag
are all inside their bands, with roll centres from geometry and toe from
Chrono's own wheel angles. In the locked-wheel stop both cars lock their
rear wheels and spin, in whichever direction a rounding difference sends
them, so only its distance is compared.

### What static toe changed

The first comparison ran without toe, which Skidpad could not express. It
found Skidpad answering the step steer about 25 % sooner than Chrono, and a
planar four-wheel model with Chrono's tires (`pnpm toe-check`) traced the
gap to Chrono's toe. ADR-0017 added `staticToeDeg`; with Chrono's toe set:

| Metric                                 | Chrono | Skidpad, no toe | Skidpad, toe |
| -------------------------------------- | ------ | --------------- | ------------ |
| yaw rate response time (s)             | 0.24   | 0.18            | 0.22         |
| lateral acceleration response time (s) | 0.25   | 0.18            | 0.22         |
| yaw rate overshoot (%)                 | 2.9    | 7.4             | 4.1          |
| sine yaw rate lag (ms)                 | 190    | 140             | 160          |
| body slip gradient (deg/g)             | 0.58   | 1.00            | 0.68         |
| understeer gradient (deg/g)            | 0.20   | 0.15            | 0.01         |
| coast, speed at 20 s (km/h)            | 74.5   | 73.9            | 69.8         |

The transient metrics and body slip moved inside tolerance. Two results
moved the other way, and each traces to something other than toe, below:
the coast-down, and the understeer gradient, which stays inside tolerance.

## Findings

**1. Static toe closes the transient gap.** See above. Toe-in puts each
tire partway up its curve, where it is less stiff, and its benefit to the
loaded outer wheel arrives only with the load transfer, so the car answers
later and overshoots less.

**2. Fixed toe overstates the toe benefit in hard cornering.** Chrono's toe
changes with the suspension: 1.43° front and 0.67° rear driving straight,
falling to about 0.9° and 0.52° at 0.8 g as the body rolls. Skidpad holds
it at the straight-running value, so the loaded outer wheel gains more grip
than Chrono's does as lateral acceleration builds. That is the likely
reason the understeer gradient fell from 0.15 to 0.01°/g against Chrono's
0.20, still inside its band. Toe that changes with travel belongs with suspension
kinematics after 1.0 (ADR-0017).

**3. Closed-throttle drag is a straight line.** With toe in both cars,
Skidpad coasts down 6 % short. Its toe drag is right: without toe it lost
4.1 km/h less, about what the tire forces predict and what Chrono pays too.
The rest is engine drag. Skidpad's drag rises linearly from idle to
redline, and Chrono's map is convex, so the least-squares line is 8 N·m
too strong at 4 000 rpm. A line through Chrono's 20 N·m at
4 000 rpm coasts to 74.1 km/h against Chrono's 74.5. Before toe the two
errors cancelled. A closed-throttle torque curve, like the full-throttle
one, would let a definition follow a measured map.

**4. No anti-dive or anti-lift geometry.** Skidpad pitches 2.4°/g under
braking, close to the 2.3°/g its springs and tires alone give. Chrono
pitches 4.4°/g. Chrono reacts all four brake torques on the chassis, and
its linkages transfer the rest through their side-view geometry. Skidpad
sends all longitudinal load transfer through the springs. This is the
pitch counterpart of the roll centres added in ADR-0016.

**5. Fixed roll centres.** As lateral acceleration rises from 0.25 to
0.9 g, Chrono's front share of lateral load transfer falls from 60 % to
51 % and its roll per g grows by a fifth. Its nose also dips by up to
0.5°. Skidpad's share stays at 55 %, its roll is linear and its pitch stays
near zero. Chrono's roll centres migrate with travel and its links push the
body up or down (jacking). The effect shows only above about 0.5 g.

**6. Roll overshoot in the sine steer.** Skidpad's peak roll is 16 % above
Chrono's against 5 % more peak lateral acceleration, so it overshoots in
roll more. Sensitivity runs move it toward Chrono with more roll damping,
and a little with less roll inertia (Skidpad rolls its unsprung mass with
the body). The cause is open.

**7. Chrono's part-pedal braking.** At 0.4 pedal Chrono stops in 79 m
against Skidpad's 72 m. Chrono's tire forces, rebuilt from its own logged
slips through its own tire formula, show it realising about 7 % less brake
torque than its nominal 800 N·m per wheel. Skidpad realises the nominal
torque. The finding sits on the reference side. The likely cause is
Chrono's friction-clutch brake constraint, but that is unconfirmed.

## Recommendations

1. **Add anti-dive and anti-squat** (side-view pitch centres) with the
   ADR-0016 pattern, before the M8 format freeze. It changes the pitch
   response, and with it the braking and power-on feel.
2. **Consider a closed-throttle torque curve** beside the linear engine
   braking, before M8 for the same reason. It is small and lets the coast
   comparison test the chassis rather than the engine fit.
3. **Leave travel-dependent toe and roll-centre migration** for after 1.0,
   with multibody suspension.

None of the findings blocks M7.

## Reproducing

The reference rows are committed, so the comparison needs no Chrono:

```sh
pnpm --filter @skidpad/chrono-compare compare     # tables, out/report.json, out/<manoeuvre>.csv
pnpm --filter @skidpad/chrono-compare fit         # refit the anti-roll bars first
pnpm --filter @skidpad/chrono-compare toe-check   # planar model, toe on and off
pnpm --filter @skidpad/chrono-compare test        # regression guard, also run by CI
```

To regenerate the reference, about 8 GB and 3 minutes:

```sh
micromamba create -p /opt/mm/chrono -c projectchrono -c conda-forge python=3.12 pychrono=9.0.1 numpy
/opt/mm/chrono/bin/python tools/chrono-compare/chrono/bmw_e90.py
```
