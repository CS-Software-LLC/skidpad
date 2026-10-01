# Skidpad against Project Chrono: BMW E90

|           |                                                                                                    |
| --------- | -------------------------------------------------------------------------------------------------- |
| Date      | 2026-10-01                                                                                         |
| Reference | [Project Chrono](https://projectchrono.org) 9.0.1 (PyChrono, conda), `BMW_E90` model, BSD-3-Clause |
| Skidpad   | core at the commit that adds this file, four-wheel model, 1 kHz                                    |
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

Every parameter comes from Chrono's source or its measured static state,
except one pair:

- **Taken from Chrono:** mass, inertia about the centre of mass,
  centre-of-mass position, wheelbase and track, spring and damper wheel
  rates, spring stops, wheel and driveline inertias, brake torque, engine
  map, gear and final-drive ratios, aero drag.
- **Derived:** roll-centre heights from the suspension hardpoints, by the
  front-view instant-centre construction after solving each linkage for
  Chrono's static ride height (front 0.176 m, rear 0.116 m; the solved
  spindle positions agree with Chrono's to 0.1 mm). Spring rates are in
  series with the tire's vertical stiffness, because Skidpad's wheel is
  rigid. The engine's closed-throttle drag is a line fitted to Chrono's map
  over the speeds the manoeuvres use.
- **Tire:** TMsimple carried into Skidpad's Magic Formula. Peak friction
  and longitudinal stiffness match exactly at every load. The lateral
  stiffness matches at the nominal load and at 1.5 times it. The curve shape
  is a least-squares fit, within 5 % of TMsimple's peak force out to 0.3 rad
  laterally and within 8 % out to a locked wheel longitudinally.
- **Fitted:** the anti-roll bar wheel rates, 13 000 N/m front and 6 000 N/m
  rear. Chrono's bars act through linkages Skidpad does not model, so they
  are identified from Chrono's roll gradient and front share of lateral load
  transfer on the steering ramp. Those two metrics are therefore not
  predictions.

Skidpad's steering is kinematic, so the harness steers it with Chrono's
logged mean front road-wheel angle. This takes the steering linkage out of
the comparison: its ratio curve, Ackermann and roll steer.

## Results

The tolerances were set before the first run, from what each metric is for.
Lateral acceleration is speed times yaw rate. Roll and pitch are measured
from their values at the start of each manoeuvre.

| Manoeuvre    | Metric                                   | Chrono | Skidpad | Difference (tolerance) |         |
| ------------ | ---------------------------------------- | ------ | ------- | ---------------------- | ------- |
| accel        | 0–60 km/h (s)                            | 3.59   | 3.54    | −1.4 % (±10 %)         | pass    |
| accel        | 0–100 km/h (s)                           | 7.21   | 6.91    | −4.1 % (±10 %)         | pass    |
| accel        | speed at 30 s (km/h)                     | 209    | 214     | 2.4 % (±5 %)           | pass    |
| coast        | speed at 20 s (km/h)                     | 74.5   | 73.9    | −0.8 % (±5 %)          | pass    |
| brake100     | stopping distance, wheels locked (m)     | 40.4   | 41.2    | 2.1 % (±5 %)           | pass    |
| brakeHalf    | stopping distance, 0.4 pedal (m)         | 79.0   | 72.7    | −8.0 % (±5 %)          | outside |
| brakeHalf    | pitch per g of braking (deg/g)           | 4.37   | 2.38    | −45 % (±20 %)          | outside |
| rampSteer    | understeer gradient (deg/g)              | 0.20   | 0.15    | −0.05 (±0.3)           | pass    |
| rampSteer    | lateral acceleration at 15 s (g)         | 0.70   | 0.70    | 0.4 % (±5 %)           | pass    |
| rampSteer    | peak lateral acceleration (g)            | 0.91   | 0.91    | −0.4 % (±5 %)          | pass    |
| rampSteer    | roll gradient (deg/g)                    | 3.76   | 3.76    | −0.1 %                 | fitted  |
| rampSteer    | front share of lateral load transfer (%) | 55.4   | 55.4    | 0.0                    | fitted  |
| rampSteer    | body slip gradient (deg/g)               | 0.58   | 1.00    | +0.42 (±0.3)           | outside |
| rampSteer    | pitch in the turn at 0.7 g (deg)         | 0.34   | −0.02   | −0.36 (±0.2)           | outside |
| stepSteer    | steady yaw rate (deg/s)                  | 14.5   | 14.3    | −1.2 % (±10 %)         | pass    |
| stepSteer    | yaw rate overshoot (%)                   | 2.9    | 7.4     | +4.5 (±5)              | pass    |
| stepSteer    | yaw rate response time, ISO 7401 (s)     | 0.24   | 0.18    | −25 % (±20 %)          | outside |
| stepSteer    | lateral acceleration response time (s)   | 0.25   | 0.18    | −28 % (±20 %)          | outside |
| stepSteer    | steady lateral acceleration (g)          | 0.57   | 0.57    | −1.2 % (±10 %)         | pass    |
| stepSteer    | steady roll (deg)                        | 2.13   | 2.12    | −0.6 % (±15 %)         | pass    |
| sineSteer    | peak yaw rate (deg/s)                    | 14.5   | 15.2    | 4.6 % (±10 %)          | pass    |
| sineSteer    | peak lateral acceleration (g)            | 0.57   | 0.60    | 4.7 % (±10 %)          | pass    |
| sineSteer    | yaw rate lag behind steer (ms)           | 190    | 140     | −26 % (±20 %)          | outside |
| sineSteer    | peak roll (deg)                          | 1.82   | 2.07    | 13.7 % (±15 %)         | pass    |
| lowSpeedTurn | turn radius (m)                          | 10.2   | 10.0    | −1.5 % (±5 %)          | pass    |

Traces, as RMS difference over the manoeuvre divided by Chrono's range
(tolerance 5 %):

| Manoeuvre    | Channel         | Difference |         |
| ------------ | --------------- | ---------- | ------- |
| accel        | speed           | 2.2 %      | pass    |
| coast        | speed           | 1.1 %      | pass    |
| brakeHalf    | speed           | 3.3 %      | pass    |
| brakeHalf    | pitch           | 38 %       | outside |
| rampSteer    | yaw rate        | 1.5 %      | pass    |
| rampSteer    | roll            | 2.6 %      | pass    |
| rampSteer    | front-left load | 4.8 %      | pass    |
| rampSteer    | rear-left load  | 5.9 %      | outside |
| stepSteer    | yaw rate        | 2.4 %      | pass    |
| stepSteer    | roll            | 3.1 %      | pass    |
| sineSteer    | yaw rate        | 3.3 %      | pass    |
| sineSteer    | roll            | 6.3 %      | outside |
| lowSpeedTurn | yaw rate        | 1.3 %      | pass    |

16 of 23 predicted metrics and 10 of 13 traces are within tolerance. The
steady-state handling is the strongest result: understeer gradient, lateral
acceleration through the whole ramp to the limit, steady yaw gain and roll,
and the low-speed turn all agree within a few percent, with roll centres
taken from geometry rather than tuned. In the locked-wheel stop both cars
lock their rear wheels and spin, in whichever direction a rounding
difference sends them, so only its distance is compared.

## Findings

**1. Static toe drives the transient gap.** Skidpad answers the step steer
about 25 % sooner than Chrono, overshoots more, and leads it by 50 ms in
the sine steer. Chrono's linkage holds the E90 at 1.27° of toe-in per front
wheel and 0.53° per rear wheel at rest, and Skidpad has no toe parameter.
Toe-in places each tire partway up its curve, where its local cornering
stiffness is lower, and its benefit to the loaded outer wheel only arrives
with the load transfer. A minimal planar four-wheel model with Chrono's
tires (`pnpm toe-check`) isolates the effect:

| Planar model | Step response (s) | Overshoot (%) | Sine yaw lag (ms) |
| ------------ | ----------------- | ------------- | ----------------- |
| no toe       | 0.19              | 5.8           | 150               |
| Chrono's toe | 0.25              | 3.1           | 180               |

Applied to Skidpad's numbers, the toe accounts for the whole response-time
difference and about 60 % of the lag and overshoot differences. Chrono's
toe is large: the car rests 4 to 5 cm above the ride height its hardpoints
were drawn at. Road
cars run nearer 0.1° per wheel, but toe is a standard alignment setting
and a common tuning parameter.

**2. No anti-dive or anti-lift geometry.** Skidpad pitches 2.4°/g under
braking, close to the 2.3°/g its springs and tires alone give. Chrono
pitches 4.4°/g.
Chrono reacts all four brake torques on the chassis, and its linkages
transfer the rest through their side-view geometry. Skidpad sends all
longitudinal load transfer through the springs. This is the pitch
counterpart of the roll centres added in ADR-0016.

**3. Fixed roll centres.** As lateral acceleration rises from 0.25 to 0.9 g,
Chrono's front share of lateral load transfer falls from 60 % to 51 % and
its roll per g grows by a fifth. Its nose also dips by up to 0.5°.
Skidpad's share stays at 55 %, its roll is linear and its pitch stays near
zero. Chrono's roll centres migrate with travel and its links push the body
up or down (jacking); Skidpad holds the roll centres at their static
heights and has no jacking force. The effect shows only above about 0.5 g
and is small in every handling metric.

**4. Body slip.** Skidpad's body slip grows by 1.0° per g against Chrono's
0.58°. Toe explains about 0.1° of that in the planar model. The rest is
open. Candidates are the combined-slip weighting at the driven rear wheels,
which differs between the Magic Formula and TMsimple, and the residual
shape of the tire fit.

**5. Chrono's part-pedal braking.** At 0.4 pedal Chrono stops in 79 m
against Skidpad's 73 m. Chrono's tire forces, rebuilt from its own logged
slips through its own tire formula, show it realising about 7 % less brake
torque than its nominal 800 N·m per wheel. Skidpad realises the nominal
torque. The finding sits on the reference side. The likely cause is Chrono's
friction-clutch brake constraint, but that is unconfirmed.

## Recommendations

1. **Add static toe per axle** to the definition, before M7. It is a small,
   self-contained change: one field per axle that defaults to zero, so the
   presets, golden results and recorded laps do not move. Then set Chrono's
   toe in the comparison and confirm finding 1 closes.
2. **Add anti-dive and anti-squat** (side-view pitch centres) with the
   ADR-0016 pattern, before the M8 format freeze. It changes the pitch
   response, and with it the braking and power-on feel.
3. **Leave roll-centre migration and jacking** for after 1.0, with
   multibody suspension.
4. **Re-run the body slip comparison** after toe lands, then look at
   combined slip under drive if the gap remains.

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
