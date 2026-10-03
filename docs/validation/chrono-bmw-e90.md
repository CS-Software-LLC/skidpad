# Skidpad against Project Chrono: BMW E90

|           |                                                                                                    |
| --------- | -------------------------------------------------------------------------------------------------- |
| Date      | 2026-10-03                                                                                         |
| Reference | [Project Chrono](https://projectchrono.org) 9.0.1 (PyChrono, conda), `BMW_E90` model, BSD-3-Clause |
| Skidpad   | core with toe, anti-pitch, braking curve, axle tracks, travel curves (ADR-0026), 1 kHz             |
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
- **Travel curves (ADR-0026):** the same front-view solver, swept from 4 cm
  of droop to 8 cm of bump, gives each axle's roll-centre height and anti
  fraction against travel. The front roll centre falls 2.9 mm per mm of
  bump and the rear 1.6 mm. The anti fractions barely move: the front's
  changes by 0.02 over the whole range. Camber against travel comes from
  `chrono/bmw_e90_kc.py`, which holds the parked car's chassis and moves it
  in heave and roll as a kinematics-and-compliance rig does. The static
  camber is Chrono's at rest, −1.19° front (Chrono's front spindle is built
  at −2°) and −0.09° rear. Neither tire produces force from camber, so the
  camber values change nothing; they are there so the geometry is complete.
  The toe stays fixed (finding 2).
- **Measured:** static toe, from Chrono's own road-wheel angles while it
  drives straight before the steering moves: 1.43° toe-in per front wheel
  and 0.67° per rear wheel. Every manoeuvre's straight section agrees within
  0.03°. At rest Chrono's linkage sits at 1.27° and 0.53°.
- **Tire:** TMsimple carried into Skidpad's Magic Formula. Peak friction
  and longitudinal stiffness match exactly at every load. The lateral
  stiffness matches at the nominal load and at 1.5 times it. The curve shape
  is a least-squares fit, within 5 % of TMsimple's peak force out to 0.3 rad
  laterally and within 8 % out to a locked wheel longitudinally.
- **Fitted:** the anti-roll bar wheel rates, 14 750 N/m front and 8 250 N/m
  rear (12 750 and 6 000 before the travel curves). Chrono's bars act through linkages Skidpad does not model, so they
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

| Manoeuvre    | Metric                                        | Chrono | Skidpad | Difference (tolerance) |         |
| ------------ | --------------------------------------------- | ------ | ------- | ---------------------- | ------- |
| accel        | 0–60 km/h (s)                                 | 3.59   | 3.61    | 0.6 % (±10 %)          | pass    |
| accel        | 0–100 km/h (s)                                | 7.21   | 7.05    | −2.2 % (±10 %)         | pass    |
| accel        | speed at 30 s (km/h)                          | 209    | 210     | 0.7 % (±5 %)           | pass    |
| coast        | speed at 20 s (km/h)                          | 74.5   | 71.9    | −3.4 % (±5 %)          | pass    |
| brake100     | stopping distance, wheels locked (m)          | 40.4   | 40.7    | 0.8 % (±5 %)           | pass    |
| brakeHalf    | stopping distance, 0.4 pedal (m)              | 79.0   | 72.8    | −7.8 % (±5 %)          | outside |
| brakeHalf    | pitch per g of braking (deg/g)                | 4.37   | 4.33    | −0.9 % (±20 %)         | pass    |
| rampSteer    | understeer gradient (deg/g)                   | 0.20   | −0.01   | −0.22 deg/g (±0.3)     | pass    |
| rampSteer    | lateral acceleration at 15 s (g)              | 0.70   | 0.72    | 2.0 % (±5 %)           | pass    |
| rampSteer    | peak lateral acceleration (g)                 | 0.91   | 0.90    | −1.4 % (±5 %)          | pass    |
| rampSteer    | roll gradient (deg/g)                         | 3.76   | 3.76    | 0.1 % (±15 %)          | fitted  |
| rampSteer    | front share of lateral load transfer (%)      | 55.4   | 55.4    | +0.00 % (±3)           | fitted  |
| rampSteer    | body slip gradient (deg/g)                    | 0.58   | 0.68    | +0.11 deg/g (±0.3)     | pass    |
| rampSteer    | pitch in the turn at 0.7 g (deg)              | 0.34   | 0.27    | −0.07 deg (±0.2)       | pass    |
| stepSteer    | steady yaw rate (deg/s)                       | 14.5   | 15.0    | 3.1 % (±10 %)          | pass    |
| stepSteer    | yaw rate overshoot (%)                        | 2.94   | 4.88    | +1.95 % (±5)           | pass    |
| stepSteer    | yaw rate response time (ISO 7401, 90 %) (s)   | 0.24   | 0.21    | −12.1 % (±20 %)        | pass    |
| stepSteer    | lateral acceleration response time (90 %) (s) | 0.25   | 0.21    | −15.7 % (±20 %)        | pass    |
| stepSteer    | steady lateral acceleration (g)               | 0.57   | 0.59    | 3.1 % (±10 %)          | pass    |
| stepSteer    | steady roll (deg)                             | 2.13   | 2.26    | 5.8 % (±15 %)          | pass    |
| sineSteer    | peak yaw rate (deg/s)                         | 14.5   | 15.4    | 6.2 % (±10 %)          | pass    |
| sineSteer    | peak lateral acceleration (g)                 | 0.57   | 0.61    | 6.2 % (±10 %)          | pass    |
| sineSteer    | yaw rate lag behind steer (ms)                | 190    | 160     | −15.8 % (±20 %)        | pass    |
| sineSteer    | peak roll (deg)                               | 1.82   | 2.10    | 15.1 % (±15 %)         | outside |
| lowSpeedTurn | turn radius (m)                               | 10.2   | 10.3    | 0.8 % (±5 %)           | pass    |

Traces, as RMS difference over the manoeuvre divided by Chrono's range
(tolerance 5 %):

| Manoeuvre    | Channel         | Difference |         |
| ------------ | --------------- | ---------- | ------- |
| accel        | speed           | 1.0 %      | pass    |
| coast        | speed           | 4.7 %      | pass    |
| brakeHalf    | speed           | 3.4 %      | pass    |
| brakeHalf    | pitch           | 24.5 %     | outside |
| rampSteer    | yaw rate        | 1.3 %      | pass    |
| rampSteer    | roll            | 8.4 %      | outside |
| rampSteer    | front-left load | 2.9 %      | pass    |
| rampSteer    | rear-left load  | 2.8 %      | pass    |
| stepSteer    | yaw rate        | 3.2 %      | pass    |
| stepSteer    | roll            | 6.0 %      | outside |
| sineSteer    | yaw rate        | 2.3 %      | pass    |
| sineSteer    | roll            | 8.1 %      | outside |
| lowSpeedTurn | yaw rate        | 0.8 %      | pass    |

21 of 23 predicted metrics and 9 of 13 traces are within tolerance. Steady
and transient handling both agree: understeer, lateral acceleration to the
limit, yaw gain, roll, the step-steer response and the sine-steer lag are
all inside their bands, and with the travel curves so are the braking
pitch and the pitch in the turn. The roll centres, pitch geometry, their
travel curves and track come from the hardpoints, the toe from Chrono's
own wheel angles. In the
locked-wheel stop both cars lock their rear wheels and spin, in whichever
direction a rounding difference sends them, so only its distance is
compared.

### How the comparison got here

The first run had no toe, linear engine braking, a shared track and no
pitch geometry, because Skidpad could express none of them. Each round
added what the previous one found:

| Metric                             | Chrono      | First run | With toe | Fixed geometry | Travel curves | Also toe curves |
| ---------------------------------- | ----------- | --------- | -------- | -------------- | ------------- | --------------- |
| yaw rate response time (s)         | 0.24        | 0.18      | 0.22     | 0.21           | 0.21          | 0.41            |
| yaw rate overshoot (%)             | 2.9         | 7.4       | 4.1      | 4.2            | 4.9           | 0.3             |
| sine yaw rate lag (ms)             | 190         | 140       | 160      | 160            | 160           | 210             |
| body slip gradient (deg/g)         | 0.58        | 1.00      | 0.68     | 0.68           | 0.68          | 1.15            |
| understeer gradient (deg/g)        | 0.20        | 0.15      | 0.01     | 0.01           | −0.01         | −0.45           |
| pitch per g of braking (deg/g)     | 4.37        | 2.38      | 2.39     | 3.30           | 4.33          | 5.23            |
| pitch in the turn at 0.7 g (deg)   | 0.34        |           |          | 0.00           | 0.27          | 0.59            |
| front share at 0.25 / 0.85 g (%)   | 60.6 / 51.6 |           |          | 55.5 / 55.7    | 56.5 / 51.7   |                 |
| coast, speed at 20 s (km/h)        | 74.5        | 73.9      | 69.8     | 71.9           | 71.9          | 66.6            |
| predicted metrics within tolerance |             | 16 of 23  | 18 of 23 | 19 of 23       | 21 of 23      | 12 of 23        |
| traces within tolerance            |             | 10 of 13  | 9 of 13  | 10 of 13       | 9 of 13       | 6 of 13         |

"Fixed geometry" is the car before ADR-0026, rerun on today's core
(`pnpm compare --fixed-geometry`; 0–100 km/h is now 7.05 s, from an
unrelated drivetrain change). "Travel curves" is the comparison car.
"Also toe curves" adds the toe curves from Chrono's kinematics sweep
(`pnpm compare --toe-curve`); the anti-roll bars are refitted for each.

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
- **Travel curves (ADR-0026)** for the roll centres, anti fractions and
  camber brought the braking pitch to Chrono's (4.33 against 4.37°/g),
  put the pitch in the turn inside its band, made the front share of load
  transfer fall with lateral acceleration and brought the rear-left load
  trace inside. The roll traces moved outside (finding 4).

### Travel-dependent geometry: expected results

Written before the run, as the original tolerances were. ADR-0026 lets a
definition carry toe, camber, roll-centre height and the anti-pitch
fractions as curves against each wheel's travel. The E90's curves are
derived from Chrono's hardpoints, not fitted: the linkages are swept from
droop to bump, with the tie-rod (front) and toe-link (rear) hardpoints
added for toe. The anti-roll bars are then refitted, because the roll
gradient and front share they are fitted to depend on the roll centres.
Expected:

- **Understeer gradient** moves from 0.01 toward Chrono's 0.20°/g, as the
  outer wheels lose toe-in in roll (finding 2).
- **Braking pitch** moves from 3.3 toward 4.4°/g, as the front's pro-dive
  grows with dive (finding 3).
- **Pitch in the turn** moves off zero toward Chrono's nose-down 0.34° at
  0.7 g, from the links' jacking (finding 4).
- **Front share of lateral load transfer** falls as lateral acceleration
  rises, as Chrono's does from 60 % to 51 % (finding 4). Its value on the
  ramp stays fitted.
- **Nothing currently inside its tolerance moves outside it.**

If a metric moves the wrong way it is reported, not tuned away.

Outcome, with the roll-centre, anti and camber curves and the toe fixed
(finding 2 says why):

- **Understeer gradient: not met.** −0.01°/g against 0.01 before. The
  improvement was to come from the toe, and Chrono's toe does not follow
  travel. With its toe curves as well the gradient goes to −0.45°/g, the
  wrong way.
- **Braking pitch: met.** 4.33°/g against Chrono's 4.37, from 3.3. The
  gain comes from the roll centres, not the anti curve, which barely
  moves. The toe-in pushes each front tire inward, and through the
  per-wheel links (decision 7 of ADR-0026) those forces lift the nose; as
  the nose dives the front roll centre falls and the lift shrinks.
- **Pitch in the turn: met.** 0.27° at 0.7 g against Chrono's 0.34, from
  zero. It keeps growing past Chrono's above that: 0.74° at 0.85 g
  against 0.47.
- **Front share falls with lateral acceleration: met in direction.** 56.5 %
  at 0.25 g to 51.7 % at 0.85 g, against Chrono's 60.6 % to 51.6 %.
- **Nothing passing moves outside: not met.** The roll traces of the ramp
  and the step steer moved outside, 4.5 % to 8.4 % and 4.2 % to 6.0 %. No
  metric moved outside.

## Findings

**1. Static toe closes the transient gap.** Toe-in puts each tire partway
up its curve, where it is less stiff, and its benefit to the loaded outer
wheel arrives only with the load transfer. So the car answers later and
overshoots less.

**2. Chrono's toe follows force, not travel.** Chrono's toe changes as it
drives: 1.43° front and 0.67° rear driving straight, falling to about 0.9°
and 0.52° at 0.8 g. Its own kinematics sweep (`chrono/bmw_e90_kc.py`, the
parked car's chassis held and rolled) does not produce that. At the 3.2° of
roll the ramp reaches, the sweep holds the front's mean toe-in at 1.29°,
and steers the rear by 0.30° out of the turn, where the driving car steers
it by 0.04°. So the change follows the tire forces, as compliance steer
does, and a toe-against-travel curve cannot carry it: with Chrono's toe
curves Skidpad's car oversteers (−0.45°/g) and its yaw response slows by
70 %. Compliance steer is outside ADR-0026, so the comparison car keeps its
toe fixed at the straight-running value. That is still the likely reason
the understeer gradient sits at about 0 against Chrono's 0.20.

The sweep also shows the front's bump steer is steep: 1.9° of toe-out over
8 cm of bump, through zero at the design ride height, so Chrono's 1.27° at
rest is that bump steer over the 5.2 cm the car settles. Solving the
front linkage in 3D from its hardpoints, with the tie-rod points added
from Chrono's source, gives a tenth of that slope, and puts the spindle at
rest 2.1 mm behind where Chrono's is. Holding the spindle where Chrono's
is reproduces Chrono's toe exactly, with the tie rod 2.8 mm longer than
its hardpoints. The same solve reproduces the rear within 0.1°. Chrono's
front joints are rigid in its source, so the gap is unexplained; it is
consistent with the front linkage giving under load, which would also be
compliance steer.

**3. Travel curves close the braking pitch gap.** Skidpad now pitches
4.33°/g against Chrono's 4.37, from 3.3 with the geometry fixed. The anti
fractions barely change with travel: the front instant centre stays far
away over the whole stroke. The gain comes from the roll centres, as
running the curves one at a time shows. The toe-in pushes each front tire
inward, and through the per-wheel links (decision 7 of ADR-0026) those
forces lift the nose. As the nose dives the front roll centre falls and
the lift shrinks, so the nose goes further down. The pitch trace still
settles faster than Chrono's, so it stays outside.

**4. Roll centres that migrate, and jacking.** With the per-wheel link
forces of ADR-0026, Skidpad's front share of lateral load transfer falls
from 56.5 % at 0.25 g to 51.7 % at 0.85 g (Chrono: 60.6 % to 51.6 %), its
nose dips in the turn (0.27° at 0.7 g against 0.34°), and the rear-left
load trace is inside its band. Its roll per g also grows with lateral
acceleration, as Chrono's does, but faster: 3.48 to 4.36°/g against 3.26 to
4.00. That moves the ramp and step-steer roll traces outside. The roll
centres come from a level-body heave construction, one per wheel at its
own travel; in roll the real instant centres move sideways too, which the
curves do not carry.

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

1. **Compliance steer next, if the understeer gradient matters.** Toe that
   moves with lateral force is what Chrono's car shows and what a
   toe-against-travel curve cannot carry (finding 2). ADR-0026 lists it as
   a follow-up.
2. **Look at the roll progression.** Skidpad's roll per g now grows faster
   than Chrono's at high lateral acceleration (finding 4). A lateral
   roll-centre shift, or curves measured in roll rather than heave, would
   be the next things to try.
3. **Look at roll damping** if the sine-steer roll overshoot matters for
   feel. It is open, small and not a format question.

## Reproducing

The reference rows are committed, so the comparison needs no Chrono:

```sh
pnpm --filter @skidpad/chrono-compare compare     # tables, out/report.json, out/<manoeuvre>.csv
pnpm --filter @skidpad/chrono-compare fit         # refit the anti-roll bars first
pnpm --filter @skidpad/chrono-compare toe-check   # planar model, toe on and off
pnpm --filter @skidpad/chrono-compare compare --fixed-geometry   # without travel curves
pnpm --filter @skidpad/chrono-compare compare --toe-curve        # with the toe curves too
pnpm --filter @skidpad/chrono-compare test        # regression guard, also run by CI
```

To regenerate the reference, about 8 GB and 3 minutes:

```sh
micromamba create -p /opt/mm/chrono -c projectchrono -c conda-forge python=3.12 pychrono=9.0.1 numpy
/opt/mm/chrono/bin/python tools/chrono-compare/chrono/bmw_e90.py
/opt/mm/chrono/bin/python tools/chrono-compare/chrono/bmw_e90_kc.py   # kinematics sweep
```
