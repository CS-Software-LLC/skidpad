# Skidpad against Project Chrono: BMW E90

|           |                                                                                                    |
| --------- | -------------------------------------------------------------------------------------------------- |
| Date      | 2026-10-01                                                                                         |
| Reference | [Project Chrono](https://projectchrono.org) 9.0.1 (PyChrono, conda), `BMW_E90` model, BSD-3-Clause |
| Skidpad   | core with toe, anti-pitch, braking curve, axle tracks, 1 kHz                                       |
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
  centre-of-mass position, wheelbase, the track of each axle, spring and
  damper wheel rates, spring stops, wheel and driveline inertias, brake
  torque, the full-throttle and closed-throttle engine maps, gear and
  final-drive ratios, aero drag.
- **Derived from the hardpoints:** each linkage is first solved for
  Chrono's static ride height (the solved spindle positions agree with
  Chrono's to 0.1 mm). The front-view instant centres give the roll-centre
  heights, 0.176 m front and 0.116 m rear (ADR-0016). The side-view instant
  centres give the anti-pitch fractions (ADR-0018). Chrono reacts its brake
  torque on the chassis and drives the rear through half-shafts, so both
  use the line from the wheel centre. The front's instant centre is 10.9 m
  ahead and 2.2 m above the wheel centre, which is pro-dive, `antiBrake`
  −1.12. The rear's is 0.57 m ahead and 6 cm below, which is pro-lift and
  pro-squat, `antiBrake` and `antiDrive` −0.60. Spring rates are in series
  with the tire's vertical stiffness, because Skidpad's wheel is rigid.
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

Chrono's own pre-phase leaves its car 0.15 to 0.22 m/s above each
manoeuvre's nominal speed. The harness settles Skidpad's car at the speed
Chrono's actually starts from, so both start within 0.01 m/s, and each
manoeuvre's own speed controller starts fresh in both.

## Results

The tolerances were set before the first run, from what each metric is for.
Lateral acceleration is speed times yaw rate. Roll and pitch are measured
from their values at the start of each manoeuvre.

| Manoeuvre    | Metric                                   | Chrono | Skidpad | Difference (tolerance) |         |
| ------------ | ---------------------------------------- | ------ | ------- | ---------------------- | ------- |
| accel        | 0–60 km/h (s)                            | 3.59   | 3.59    | 0.0 % (±10 %)          | pass    |
| accel        | 0–100 km/h (s)                           | 7.21   | 7.02    | −2.6 % (±10 %)         | pass    |
| accel        | speed at 30 s (km/h)                     | 209    | 211     | 0.8 % (±5 %)           | pass    |
| coast        | speed at 20 s (km/h)                     | 74.5   | 71.9    | −3.4 % (±5 %)          | pass    |
| brake100     | stopping distance, wheels locked (m)     | 40.4   | 41.5    | 2.7 % (±5 %)           | pass    |
| brakeHalf    | stopping distance, 0.4 pedal (m)         | 79.0   | 72.8    | −7.8 % (±5 %)          | outside |
| brakeHalf    | pitch per g of braking (deg/g)           | 4.37   | 3.30    | −25 % (±20 %)          | outside |
| rampSteer    | understeer gradient (deg/g)              | 0.20   | 0.01    | −0.20 (±0.3)           | pass    |
| rampSteer    | lateral acceleration at 15 s (g)         | 0.70   | 0.72    | 2.2 % (±5 %)           | pass    |
| rampSteer    | peak lateral acceleration (g)            | 0.91   | 0.89    | −2.8 % (±5 %)          | pass    |
| rampSteer    | roll gradient (deg/g)                    | 3.76   | 3.76    | −0.2 %                 | fitted  |
| rampSteer    | front share of lateral load transfer (%) | 55.4   | 55.5    | +0.1                   | fitted  |
| rampSteer    | body slip gradient (deg/g)               | 0.58   | 0.68    | +0.11 (±0.3)           | pass    |
| rampSteer    | pitch in the turn at 0.7 g (deg)         | 0.34   | 0.00    | −0.35 (±0.2)           | outside |
| stepSteer    | steady yaw rate (deg/s)                  | 14.5   | 14.9    | 2.8 % (±10 %)          | pass    |
| stepSteer    | yaw rate overshoot (%)                   | 2.9    | 4.2     | +1.2 (±5)              | pass    |
| stepSteer    | yaw rate response time, ISO 7401 (s)     | 0.24   | 0.21    | −12 % (±20 %)          | pass    |
| stepSteer    | lateral acceleration response time (s)   | 0.25   | 0.22    | −12 % (±20 %)          | pass    |
| stepSteer    | steady lateral acceleration (g)          | 0.57   | 0.59    | 2.7 % (±10 %)          | pass    |
| stepSteer    | steady roll (deg)                        | 2.13   | 2.21    | 3.4 % (±15 %)          | pass    |
| sineSteer    | peak yaw rate (deg/s)                    | 14.5   | 15.3    | 5.1 % (±10 %)          | pass    |
| sineSteer    | peak lateral acceleration (g)            | 0.57   | 0.60    | 5.1 % (±10 %)          | pass    |
| sineSteer    | yaw rate lag behind steer (ms)           | 190    | 160     | −16 % (±20 %)          | pass    |
| sineSteer    | peak roll (deg)                          | 1.82   | 2.10    | 15.2 % (±15 %)         | outside |
| lowSpeedTurn | turn radius (m)                          | 10.2   | 10.3    | 1.2 % (±5 %)           | pass    |

Traces, as RMS difference over the manoeuvre divided by Chrono's range
(tolerance 5 %):

| Manoeuvre    | Channel         | Difference |         |
| ------------ | --------------- | ---------- | ------- |
| accel        | speed           | 1.1 %      | pass    |
| coast        | speed           | 4.7 %      | pass    |
| brakeHalf    | speed           | 3.4 %      | pass    |
| brakeHalf    | pitch           | 28 %       | outside |
| rampSteer    | yaw rate        | 1.4 %      | pass    |
| rampSteer    | roll            | 4.5 %      | pass    |
| rampSteer    | front-left load | 3.0 %      | pass    |
| rampSteer    | rear-left load  | 8.0 %      | outside |
| stepSteer    | yaw rate        | 2.7 %      | pass    |
| stepSteer    | roll            | 4.2 %      | pass    |
| sineSteer    | yaw rate        | 1.9 %      | pass    |
| sineSteer    | roll            | 7.4 %      | outside |
| lowSpeedTurn | yaw rate        | 1.2 %      | pass    |

19 of 23 predicted metrics and 10 of 13 traces are within tolerance. Steady
and transient handling both agree: understeer, lateral acceleration to the
limit, yaw gain, roll, the step-steer response and the sine-steer lag are
all inside their bands. The roll centres, pitch geometry and track come
from the hardpoints, the toe from Chrono's own wheel angles. In the
locked-wheel stop both cars lock their rear wheels and spin, in whichever
direction a rounding difference sends them, so only its distance is
compared.

### How the comparison got here

The first run had no toe, linear engine braking, a shared track and no
pitch geometry, because Skidpad could express none of them. Each round
added what the previous one found:

| Metric                             | Chrono | First run | With toe | Now      |
| ---------------------------------- | ------ | --------- | -------- | -------- |
| yaw rate response time (s)         | 0.24   | 0.18      | 0.22     | 0.21     |
| yaw rate overshoot (%)             | 2.9    | 7.4       | 4.1      | 4.2      |
| sine yaw rate lag (ms)             | 190    | 140       | 160      | 160      |
| body slip gradient (deg/g)         | 0.58   | 1.00      | 0.68     | 0.68     |
| understeer gradient (deg/g)        | 0.20   | 0.15      | 0.01     | 0.01     |
| pitch per g of braking (deg/g)     | 4.37   | 2.38      | 2.39     | 3.30     |
| coast, speed at 20 s (km/h)        | 74.5   | 73.9      | 69.8     | 71.9     |
| predicted metrics within tolerance |        | 16 of 23  | 18 of 23 | 19 of 23 |
| traces within tolerance            |        | 10 of 13  | 9 of 13  | 10 of 13 |

- **Static toe (ADR-0017)** closed the transient gap. A planar model with
  Chrono's tires (`pnpm toe-check`) first traced the quicker response to
  Chrono's toe.
- **The engine-braking curve (ADR-0011 amendment)** now carries Chrono's
  closed-throttle map over directly. The least-squares line it replaces was
  8 N·m too strong at 4 000 rpm and left the coast 6 % short.
- **Anti-dive and anti-squat (ADR-0018)**, with fractions from the
  side-view geometry, raised the braking pitch from the springs-only
  2.4°/g to 3.3°/g. Nothing about it was fitted.
- **Per-axle track** moved nothing measurable, since Chrono's tracks differ
  by 1 cm.
- **Settling at Chrono's start speed** took 0.3 m/s of harness offset out
  of every moving manoeuvre.

## Findings

**1. Static toe closes the transient gap.** Toe-in puts each tire partway
up its curve, where it is less stiff, and its benefit to the loaded outer
wheel arrives only with the load transfer. So the car answers later and
overshoots less.

**2. Fixed toe overstates the toe benefit in hard cornering.** Chrono's toe
changes with the suspension: 1.43° front and 0.67° rear driving straight,
falling to about 0.9° and 0.52° at 0.8 g as the body rolls. Skidpad holds
it at the straight-running value, so the loaded outer wheel gains more grip
than Chrono's does as lateral acceleration builds. That is the likely
reason the understeer gradient fell from 0.15 to 0.01°/g against Chrono's
0.20, still inside its band.

**3. Pitch geometry closes half the braking pitch gap.** Skidpad now pitches
3.3°/g against Chrono's 4.4°/g, from 2.4°/g. The springs and the
geometry-derived fractions predict 3.35°/g by hand, so the model does what
the parameters say. The rest is the geometry itself. The front instant
centre sits 10.9 m away, nearly at infinity, so its angle swings with a
few centimetres of dive, and Chrono's moves while Skidpad's is fixed at
ride height.

**4. Fixed roll centres.** As lateral acceleration rises from 0.25 to
0.9 g, Chrono's front share of lateral load transfer falls from 60 % to
51 % and its roll per g grows by a fifth. Its nose also dips by up to
0.5°. Skidpad's share stays at 55 %, its roll is linear and its pitch stays
near zero. Chrono's roll centres migrate with travel and its links push the
body up or down (jacking). The effect shows only above about 0.5 g.

**5. Roll overshoot in the sine steer.** Skidpad's peak roll is 15 % above
Chrono's against 5 % more peak lateral acceleration, so it overshoots in
roll more. Sensitivity runs move it toward Chrono with more roll damping,
and a little with less roll inertia (Skidpad rolls its unsprung mass with
the body). The cause is open.

**6. Chrono's part-pedal braking.** At 0.4 pedal Chrono stops in 79 m
against Skidpad's 73 m. Chrono's tire forces, rebuilt from its own logged
slips through its own tire formula, show it realising about 7 % less brake
torque than its nominal 800 N·m per wheel. Skidpad realises the nominal
torque. The finding sits on the reference side. The likely cause is
Chrono's friction-clutch brake constraint, but that is unconfirmed.

**7. A small coast-down remainder.** At the same start speed and engine map,
Skidpad still decelerates 5 to 9 % faster than Chrono through the coast,
50 to 120 N more drag. Rolling resistance, toe drag and the engine map are
all carried over. The remaining difference is open and within tolerance.

## Recommendations

1. **Leave travel-dependent geometry for after 1.0.** Toe, roll centres and
   anti fractions that change with travel all belong with multibody
   suspension. Findings 2 to 4 are what it would close.
2. **Look at roll damping** if the sine-steer roll overshoot matters for
   feel. It is open, small and not a format question.

None of the findings blocks M7, and the definition format now carries every
geometry parameter the comparison needed.

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
