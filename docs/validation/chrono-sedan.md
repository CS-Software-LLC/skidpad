# Skidpad against Project Chrono: Sedan

|           |                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------ |
| Date      | 2026-10-10                                                                                       |
| Reference | [Project Chrono](https://projectchrono.org) 9.0.1 (PyChrono, conda), `Sedan` model, BSD-3-Clause |
| Skidpad   | core with the `LFZO` and `FNOMIN` fixes below, travel curves (ADR-0026), 1 kHz                   |
| Harness   | [`tools/chrono-compare`](../../tools/chrono-compare), `--car sedan`                              |

The second reference car after the [BMW E90](chrono-bmw-e90.md). One car can
be matched by adjusting whatever happens to be wrong. Two cars show which
differences belong to the engine and which to the car, so a change that
helps one car and hurts the other is wrong.

Chrono's `Sedan` is a generic, synthetic mid-size car: 1 684 kg, a double
wishbone front, a five-link multi-link rear, front-wheel drive, a six-speed
automatic, no anti-roll bars, and a PAC2002 Magic Formula tire. Compared
with the E90 it changes the drive layout (front instead of rear), the rear
linkage, the tire model, and how the roll stiffness is split: its rear wheel
rate is nearly three times its front. Its inertias are low for its mass
(yaw 1 442 kg·m²), so it answers the steering quickly. That doesn't matter
when one simulator is compared against another.

Both simulators drive the E90's eight manoeuvres (`chrono/maneuvers.json`)
with the same inputs, the same PI speed controller and the same metrics and
tolerances, which were set before the E90's first run and are not changed
here.

## How the Skidpad model was built

**Nothing is fitted to the car's behaviour.** The E90's anti-roll bars are
identified from Chrono's roll gradient and front share of load transfer; the
Sedan has none, so those two metrics are predictions here.

- **Taken from Chrono:** mass, inertia about the centre of mass,
  centre-of-mass position, wheelbase, each axle's track, spring and damper
  rates and the front spring stops, wheel and driveline inertias, brake
  torque, the full-throttle and closed-throttle engine maps, gear and
  final-drive ratios, aero drag (`src/chrono-sedan.ts`).
- **Measured from Chrono's kinematics sweep** (`chrono/kc.py sedan`, the
  parked car's chassis held and moved in heave): the spring and damper
  motion ratios (0.52 front; 0.63 and 0.68 rear), each axle's roll-centre
  height from the contact patch's lateral scrub, and the anti fractions from
  the wheel centre's fore-aft travel, all as travel curves (ADR-0026). The
  E90's come from instant-centre constructions on its hardpoints, but the
  Sedan's multi-link has no two-arm construction, so both axles are measured
  (`src/sedan-kc.ts`). The front roll centre sits at 0.234 m and falls
  2.3 mm per mm of bump; the rear's is 0.059 m. The front's anti geometry is
  almost nil, and the rear's anti-lift is 0.69.
- **Measured while driving:** the static toe, as for the E90: Chrono's
  front-wheel angles over the first 2 s of the step steer give 0.43° of
  toe-in per front wheel and 0.07° of toe-out at the rear.
- **Tire:** the `.tir` file itself, imported by Skidpad, with the overrides
  in `src/pac02.ts`. Chrono's implementation departs from the published
  Magic Formula in ways that change what its car does (finding 1), so the
  shape and curvature of each pure-slip curve are fitted to Chrono's
  curves as Chrono computes them. The peak friction and the slip
  stiffnesses are the file's, exactly. The fit is within 3.8 % of the peak
  longitudinally and 2.4 % laterally from half to 1.75 times the nominal
  load.

The harness steers Skidpad with Chrono's logged mean front road-wheel angle
and settles it at the speed Chrono's car actually starts from, as for the
E90.

## Results: the blind run

This is the first run, unchanged. The model was built, its derived values
were checked for sense, and then the comparison was run once.

| Manoeuvre    | Metric                                        | Chrono | Skidpad | Difference (tolerance) |         |
| ------------ | --------------------------------------------- | ------ | ------- | ---------------------- | ------- |
| accel        | 0–60 km/h (s)                                 | 4.05   | 4.08    | 0.8 % (±10 %)          | pass    |
| accel        | 0–100 km/h (s)                                | 7.60   | 7.41    | −2.5 % (±10 %)         | pass    |
| accel        | speed at 30 s (km/h)                          | 216    | 224     | 3.4 % (±5 %)           | pass    |
| coast        | speed at 20 s (km/h)                          | 86.3   | 85.9    | −0.5 % (±5 %)          | pass    |
| brake100     | stopping distance, wheels locked (m)          | 35.6   | 36.0    | 1.1 % (±5 %)           | pass    |
| brakeHalf    | stopping distance, 0.4 pedal (m)              | 69.9   | 71.2    | 2.0 % (±5 %)           | pass    |
| brakeHalf    | pitch per g of braking (deg/g)                | 2.03   | 1.87    | −7.8 % (±20 %)         | pass    |
| rampSteer    | understeer gradient (deg/g)                   | 0.14   | −0.04   | −0.18 deg/g (±0.3)     | pass    |
| rampSteer    | lateral acceleration at 15 s (g)              | 0.72   | 0.76    | 5.4 % (±5 %)           | outside |
| rampSteer    | peak lateral acceleration (g)                 | 0.93   | 0.96    | 2.7 % (±5 %)           | pass    |
| rampSteer    | roll gradient (deg/g)                         | 3.37   | 3.06    | −9.2 % (±15 %)         | pass    |
| rampSteer    | front share of lateral load transfer (%)      | 38.0   | 43.2    | +5.2 % (±3)            | outside |
| rampSteer    | body slip gradient (deg/g)                    | 1.77   | 1.91    | +0.15 deg/g (±0.3)     | pass    |
| rampSteer    | pitch in the turn at 0.7 g (deg)              | −0.03  | 0.10    | +0.14 deg (±0.2)       | pass    |
| stepSteer    | steady yaw rate (deg/s)                       | 13.7   | 14.7    | 6.9 % (±10 %)          | pass    |
| stepSteer    | yaw rate overshoot (%)                        | 23.2   | 16.8    | −6.5 % (±5)            | outside |
| stepSteer    | yaw rate response time (ISO 7401, 90 %) (s)   | 0.09   | 0.10    | 12.4 % (±20 %)         | pass    |
| stepSteer    | lateral acceleration response time (90 %) (s) | 0.09   | 0.10    | 12.4 % (±20 %)         | pass    |
| stepSteer    | steady lateral acceleration (g)               | 0.54   | 0.58    | 6.9 % (±10 %)          | pass    |
| stepSteer    | steady roll (deg)                             | 1.85   | 1.79    | −3.2 % (±15 %)         | pass    |
| sineSteer    | peak yaw rate (deg/s)                         | 15.5   | 15.9    | 2.7 % (±10 %)          | pass    |
| sineSteer    | peak lateral acceleration (g)                 | 0.61   | 0.63    | 2.7 % (±10 %)          | pass    |
| sineSteer    | yaw rate lag behind steer (ms)                | 70     | 80      | 14.3 % (±20 %)         | pass    |
| sineSteer    | peak roll (deg)                               | 1.74   | 1.58    | −9.2 % (±15 %)         | pass    |
| lowSpeedTurn | turn radius (m)                               | 9.21   | 9.40    | 2.1 % (±5 %)           | pass    |

Traces, as RMS difference over the manoeuvre divided by Chrono's range
(tolerance 5 %):

| Manoeuvre    | Channel         | Difference |         |
| ------------ | --------------- | ---------- | ------- |
| accel        | speed           | 2.7 %      | pass    |
| coast        | speed           | 1.3 %      | pass    |
| brakeHalf    | speed           | 0.9 %      | pass    |
| brakeHalf    | pitch           | 27.0 %     | outside |
| rampSteer    | yaw rate        | 2.9 %      | pass    |
| rampSteer    | roll            | 1.7 %      | pass    |
| rampSteer    | front-left load | 11.3 %     | outside |
| rampSteer    | rear-left load  | 4.5 %      | pass    |
| stepSteer    | yaw rate        | 4.6 %      | pass    |
| stepSteer    | roll            | 5.3 %      | outside |
| sineSteer    | yaw rate        | 1.4 %      | pass    |
| sineSteer    | roll            | 6.2 %      | outside |
| lowSpeedTurn | yaw rate        | 2.1 %      | pass    |

**22 of 25 predicted metrics and 9 of 13 traces are within tolerance, with
nothing fitted.** Acceleration, coast-down and both stops agree. The roll
gradient, the steady and peak roll, and the steady and transient yaw
response agree. These are predictions from the springs, the measured
geometry and the tire file, with no anti-roll bar to absorb an error. The
locked-wheel stop agrees only because Skidpad's tire is fitted to the curve
Chrono actually computes (finding 1).

### Variants

| Metric                                   | Chrono | Blind (travel curves) | Fixed geometry | Also toe curves |
| ---------------------------------------- | ------ | --------------------- | -------------- | --------------- |
| understeer gradient (deg/g)              | 0.14   | −0.04                 | −0.04          | 1.98            |
| front share of lateral load transfer (%) | 38.0   | 43.2                  | 43.6           | 50.8            |
| roll gradient (deg/g)                    | 3.37   | 3.06                  | 3.01           | 2.80            |
| pitch per g of braking (deg/g)           | 2.03   | 1.87                  | 1.71           | 4.14            |
| pitch in the turn at 0.7 g (deg)         | −0.03  | 0.10                  | −0.03          | 0.43            |
| yaw rate overshoot (%)                   | 23.2   | 16.8                  | 17.3           | 39.1            |
| coast, speed at 20 s (km/h)              | 86.3   | 85.9                  | 85.9           | 72.3            |
| predicted metrics within tolerance       |        | 22 of 25              | 23 of 25       | 9 of 25         |
| traces within tolerance                  |        | 9 of 13               | 8 of 13        | 2 of 13         |

"Fixed geometry" drops the travel curves (`--fixed-geometry`). The curves
bring the braking pitch closer and the front-left load trace inside
(13.5 % to 11.3 %), but they also make the nose dip in a turn where
Chrono's doesn't, by 0.10° at 0.7 g, which is inside the band. "Also toe
curves" (`--toe-curve`) adds the toe against travel from the kinematics
sweep, starting from the parked toe. That makes things much worse,
for the reason finding 3 gives.

## Findings

**1. Chrono's Pac02 is not the published Magic Formula, and the file found
two Skidpad bugs.** Chrono 9.0.1's `ChPac02Tire` differs from Pacejka's
MF 5.2 in four ways:

- It clamps `B·κ` and `B·α` just below π/2 before the formula, so each force
  rises to about its peak and stays there. A locked wheel keeps nearly its
  peak force: 4 670 N at 4 kN of load, where the published formula falls to
  3 360 N.
- It never sets its camber state from the wheel, so camber makes no force
  in Chrono's tire, as on the E90's TMsimple.
- It mirrors the asymmetric coefficients on the right-hand tires. The
  offsets therefore act as a symmetric pair, worth 0.03° of toe-out.
- It combines slips with a friction ellipse and has no rolling resistance,
  because the file has no rolling coefficients.

Loaded unchanged, the file would have left a locked wheel with 28 % less
force than Chrono's. Importing it also exposed two bugs in Skidpad's core, both
fixed:

- The cornering stiffness applied the nominal-load scale `LFZO` twice.
  Pacejka's eq. 4.E25 applies it once, and the file's `LFZO = 0.81` made
  Skidpad 19 % too soft.
- The importer did not read `FNOMIN`, the nominal-load key that PAC2002 and
  MF-Tyre files use. It kept a default of 4 000 N against the file's 4 850 N.

The E90's TMsimple tire never reached either code path, and no preset sets
`LFZO`, so no other validation result moved.

**2. Chrono's car carries less of its load transfer through its links than
its kinematics say.** The front share of lateral load transfer is 43.2 %
against Chrono's 38.0 %. Skidpad does what its inputs say: the elastic
share from the springs plus the geometric share from the roll centres gives
43.9 % by hand. Working backwards from each car's roll angle and wheel
loads on the ramp, with the same springs, Skidpad's effective roll centres
come out at its inputs, 0.234 m front and 0.055 m rear. Chrono's come out
lower, at 0.154 m and 0.028 m.

Chrono's own sweep gives 0.234 m and 0.059 m in heave. In roll, the same
sweep gives 0.213 m and 0.045 m, so about a quarter of the gap comes from
building the roll centre in heave rather than in roll. The rest appears
only when the car is driven. Using the roll-sweep centres moves the front
share only to 41.5 % and puts more traces outside, so they were not
adopted.

The E90 points the same way. Its roll traces moved outside when its roll
centres began to migrate (E90 finding 4), and that report already suggested
"curves measured in roll rather than heave". The lateral acceleration at
15 s (5.4 % against 5 %) and the front-left load trace follow from this
difference.

**3. Chrono's toe follows what its tires do, on both cars.** The Sedan's
front toe-in is 1.28° parked, about 0.4° whenever it rolls (at any speed
from 5 m/s to 30 m/s), and 2–3° under full drive. The E90's moves the same
way, by less: 1.27° parked, 1.44° rolling, 1.67° under drive. In cornering
the Sedan's front toe-in grows by about 0.25° at 0.8 g, which its bump
steer accounts for. The E90's falls, which its kinematics do not account
for (E90 finding 2). Neither car's toe is a function of travel alone.
Starting the toe curve from the parked toe gives the Sedan about 0.85° too
much toe-in while driving, which costs 16 % of the coast-down speed and
overturns the handling. So on both cars the comparison keeps the toe fixed
at the straight-running value, and compliance steer (toe that moves with
tire force) is the common gap.

**4. Step-steer overshoot.** Chrono's yaw rate overshoots by 23 % and
Skidpad's by 17 %. Both respond within 0.1 s. The yaw gain, the lag in the
sine steer and the yaw traces agree, so only the damping of the yaw mode
differs. Skidpad's minimum relaxation length (0.02 m, 1 ms at this speed)
is too short to explain it. The unsprung mass, which Chrono carries on
separate bodies and Skidpad on the chassis, is the next suspect. The cause
is open.

**5. Braking pitch settles faster, on both cars.** The pitch per g matches
(1.87 against 2.03°/g), but the pitch trace in the 0.4-pedal stop is 27 %
out. The E90's is 24.5 % out for the same reason (E90 finding 3). On both
cars Chrono's body keeps moving after Skidpad's has settled.

## Across both reference cars

| Pattern                                       | E90                    | Sedan                  |
| --------------------------------------------- | ---------------------- | ---------------------- |
| understeer gradient, Skidpad − Chrono (deg/g) | −0.22                  | −0.18                  |
| braking pitch trace                           | 24.5 %, settles faster | 27.0 %, settles faster |
| toe moves with tire force                     | yes (finding 2)        | yes (finding 3)        |
| effective roll centres below the kinematics'  | roll traces outside    | front share +5.2       |
| 0.4-pedal stop                                | Skidpad 7.8 % short    | Skidpad 2.0 % long     |
| roll overshoot in the sine steer              | 15 % high              | 9 % low, inside        |

The first four rows match across two cars with different tires,
drivelines and rear linkages, so they belong to the engine or to how Chrono
builds a vehicle, not to either car:

- **Understeer.** Skidpad shows about 0.2°/g less understeer on both. On the
  E90 that was put down to compliance steer. The Sedan has the same gap and
  the same force-dependent toe, which supports that.
- **Pitch damping.** The braking pitch settles too fast on both.
- **Roll centres.** The heave-built roll centres sit above what Chrono's
  cars use on both.

The last two rows differ between the cars, so they are specific to one car:

- **The E90's 0.4-pedal stop** was put down to Chrono's shaft brake
  realising less torque. The Sedan uses the same brake model and stops
  within 2 %, so that cause is less likely. Its TMsimple tire is the more
  likely one.
- **The E90's roll overshoot** doesn't appear on the Sedan.

## Recommendations

1. **Compliance steer.** Two cars now show toe that follows tire force, and
   the same understeer gap. This is the strongest candidate for an engine
   change, and both comparisons will judge it.
2. **Roll centres measured in roll, and the dynamic part.** The roll sweep
   accounts for a quarter of the load-transfer gap. The rest needs Chrono's
   wheel forces logged against its link forces to explain. That is a
   harness change, not an engine change.
3. **Look at the pitch and yaw damping with the unsprung mass in mind.**
   Both settle faster in Skidpad on both cars.

## Reproducing

The reference rows and the tire file are committed, so the comparison needs
no Chrono:

```sh
pnpm --filter @skidpad/chrono-compare compare --car sedan                   # tables, out/sedan/
pnpm --filter @skidpad/chrono-compare compare --car sedan --fixed-geometry  # without travel curves
pnpm --filter @skidpad/chrono-compare compare --car sedan --toe-curve       # with the toe curves too
pnpm --filter @skidpad/chrono-compare test                                  # both cars' regression guards
```

To regenerate the reference, about 8 GB and 2 minutes:

```sh
micromamba create -p /opt/mm/chrono -c projectchrono -c conda-forge python=3.12 pychrono=9.0.1 numpy
/opt/mm/chrono/bin/python tools/chrono-compare/chrono/sedan.py
/opt/mm/chrono/bin/python tools/chrono-compare/chrono/kc.py sedan   # kinematics sweep
```
