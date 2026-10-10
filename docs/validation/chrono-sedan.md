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
tolerances. Those tolerances were set before the E90's first run. Two
ride-height metrics were added for both cars, with their tolerances set
before either car was run against them.

## How the Skidpad model was built

**Nothing is fitted to the car's behaviour.** The E90's anti-roll bars are
identified from Chrono's roll gradient and front share of load transfer; the
Sedan has none, so those two metrics are predictions here.

- **Taken from Chrono:** mass, inertia about the centre of mass,
  centre-of-mass position, wheelbase, each axle's track, spring and damper
  rates and the front spring stops, wheel and driveline inertias, brake
  torque, the full-throttle and closed-throttle engine maps, gear and
  final-drive ratios, aero drag (`src/chrono-sedan.ts`).
- **Ride height, measured at equilibrium** (`chrono/equilibrium.py`): the
  chassis held with the tires off the ground, each spindle pushed up by its
  static load, so no tire force props or jacks the car. Skidpad's travel is
  measured from its own equilibrium, so the travel curves and the
  centre-of-mass height are taken there. The parked car is not at
  equilibrium: its front rests 24 mm high, propped by its tires' static
  friction (finding 2).
- **Measured from Chrono's kinematics sweep** (`chrono/kc.py sedan`, the
  parked car's chassis held and moved in heave, read from the equilibrium
  ride height): the spring and damper motion ratios (0.52 front; 0.63 and
  0.68 rear), each axle's roll-centre height from the contact patch's
  lateral scrub, and the anti fractions from the wheel centre's fore-aft
  travel, all as travel curves (ADR-0026). The E90's come from
  instant-centre constructions on its hardpoints, but the Sedan's multi-link
  has no two-arm construction, so both axles are measured
  (`src/sedan-kc.ts`). At equilibrium the front roll centre sits at 0.188 m
  and falls 2.3 mm per mm of bump; the rear's is 0.059 m. The rear's
  anti-lift is 0.69, and the front has almost no anti geometry.
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

## Results

| Manoeuvre    | Metric                                                    | Chrono | Skidpad | Difference (tolerance) |         |
| ------------ | --------------------------------------------------------- | ------ | ------- | ---------------------- | ------- |
| accel        | 0–60 km/h (s)                                             | 4.05   | 4.07    | 0.5 % (±10 %)          | pass    |
| accel        | 0–100 km/h (s)                                            | 7.60   | 7.40    | −2.6 % (±10 %)         | pass    |
| accel        | speed at 30 s (km/h)                                      | 216    | 224     | 3.4 % (±5 %)           | pass    |
| coast        | speed at 20 s (km/h)                                      | 86.3   | 85.9    | −0.5 % (±5 %)          | pass    |
| brake100     | stopping distance, wheels locked (m)                      | 35.6   | 35.8    | 0.7 % (±5 %)           | pass    |
| brakeHalf    | stopping distance, 0.4 pedal (m)                          | 69.9   | 71.2    | 2.0 % (±5 %)           | pass    |
| brakeHalf    | pitch per g of braking (deg/g)                            | 2.03   | 1.84    | −9.3 % (±20 %)         | pass    |
| rampSteer    | understeer gradient (deg/g)                               | 0.14   | −0.08   | −0.22 deg/g (±0.3)     | pass    |
| rampSteer    | lateral acceleration at 15 s (g)                          | 0.72   | 0.79    | 10.7 % (±5 %)          | outside |
| rampSteer    | peak lateral acceleration (g)                             | 0.93   | 1.18    | 26.3 % (±5 %)          | outside |
| rampSteer    | roll gradient (deg/g)                                     | 3.37   | 3.24    | −3.8 % (±15 %)         | pass    |
| rampSteer    | front share of lateral load transfer (%)                  | 38.0   | 38.4    | +0.4 % (±3)            | pass    |
| rampSteer    | body slip gradient (deg/g)                                | 1.77   | 1.93    | +0.17 deg/g (±0.3)     | pass    |
| rampSteer    | pitch in the turn at 0.7 g (deg)                          | −0.03  | 0.17    | +0.20 deg (±0.2)       | outside |
| stepSteer    | front ride height running straight, from equilibrium (mm) | −4.1   | −6.2    | −2.1 mm (±3)           | pass    |
| stepSteer    | rear ride height running straight, from equilibrium (mm)  | 0.0    | 0.2     | +0.2 mm (±3)           | pass    |
| stepSteer    | steady yaw rate (deg/s)                                   | 13.7   | 15.0    | 9.4 % (±10 %)          | pass    |
| stepSteer    | yaw rate overshoot (%)                                    | 23.2   | 14.7    | −8.6 % (±5)            | outside |
| stepSteer    | yaw rate response time (ISO 7401, 90 %) (s)               | 0.09   | 0.10    | 12.4 % (±20 %)         | pass    |
| stepSteer    | lateral acceleration response time (90 %) (s)             | 0.09   | 0.11    | 23.6 % (±20 %)         | outside |
| stepSteer    | steady lateral acceleration (g)                           | 0.54   | 0.59    | 9.3 % (±10 %)          | pass    |
| stepSteer    | steady roll (deg)                                         | 1.85   | 1.95    | 5.5 % (±15 %)          | pass    |
| sineSteer    | peak yaw rate (deg/s)                                     | 15.5   | 16.1    | 3.7 % (±10 %)          | pass    |
| sineSteer    | peak lateral acceleration (g)                             | 0.61   | 0.63    | 3.7 % (±10 %)          | pass    |
| sineSteer    | yaw rate lag behind steer (ms)                            | 70     | 80      | 14.3 % (±20 %)         | pass    |
| sineSteer    | peak roll (deg)                                           | 1.74   | 1.69    | −2.9 % (±15 %)         | pass    |
| lowSpeedTurn | turn radius (m)                                           | 9.21   | 9.42    | 2.3 % (±5 %)           | pass    |

Traces, as RMS difference over the manoeuvre divided by Chrono's range
(tolerance 5 %):

| Manoeuvre    | Channel         | Difference |         |
| ------------ | --------------- | ---------- | ------- |
| accel        | speed           | 2.7 %      | pass    |
| coast        | speed           | 1.3 %      | pass    |
| brakeHalf    | speed           | 0.9 %      | pass    |
| brakeHalf    | pitch           | 27.3 %     | outside |
| rampSteer    | yaw rate        | 8.8 %      | outside |
| rampSteer    | roll            | 7.0 %      | outside |
| rampSteer    | front-left load | 6.8 %      | outside |
| rampSteer    | rear-left load  | 10.0 %     | outside |
| stepSteer    | yaw rate        | 6.2 %      | outside |
| stepSteer    | roll            | 5.2 %      | outside |
| sineSteer    | yaw rate        | 1.6 %      | pass    |
| sineSteer    | roll            | 5.9 %      | outside |
| lowSpeedTurn | yaw rate        | 2.2 %      | pass    |

**22 of 27 predicted metrics and 5 of 13 traces are within tolerance, with
nothing fitted.** Acceleration, coast-down and both stops agree, as do the
roll gradient, the front share of load transfer, the steady and peak roll,
and the yaw gain. The ride height while running straight is a prediction:
Skidpad's own toe-in forces lift its front 6.2 mm from equilibrium, against
Chrono's 4.1 mm. What is outside is the car near its limit and the step
response (findings 4 and 5).

### The blind run, and the variants

The first run took the travel curves from the parked car, as the E90 did,
and Skidpad's straight-running ride height was not yet compared. It was run
once, blind, and is kept here as it came out. Its load transfer was 5.2
points off, which led to finding 2.

| Metric                                   | Chrono | Blind (parked) | Equilibrium (default) | Equilibrium, fixed geometry | Equilibrium, also toe curves |
| ---------------------------------------- | ------ | -------------- | --------------------- | --------------------------- | ---------------------------- |
| understeer gradient (deg/g)              | 0.14   | −0.04          | −0.08                 | −0.07                       | 0.30                         |
| front share of lateral load transfer (%) | 38.0   | 43.2           | 38.4                  | 39.2                        | 39.4                         |
| roll gradient (deg/g)                    | 3.37   | 3.06           | 3.24                  | 3.18                        | 3.15                         |
| peak lateral acceleration (g)            | 0.93   | 0.96           | 1.18                  | 0.96                        | 1.22                         |
| pitch in the turn at 0.7 g (deg)         | −0.03  | 0.10           | 0.17                  | −0.03                       | 1.48                         |
| front ride height running straight (mm)  | −4.1   |                | −6.2                  | 0.3                         | −68.5                        |
| yaw rate overshoot (%)                   | 23.2   | 16.8           | 14.7                  | 15.5                        | 0.0                          |
| coast, speed at 20 s (km/h)              | 86.3   | 85.9           | 85.9                  | 85.9                        | 73.8                         |
| predicted metrics within tolerance       |        | 22 of 25       | 22 of 27              | 24 of 27                    | 14 of 27                     |
| traces within tolerance                  |        | 9 of 13        | 5 of 13               | 9 of 13                     | 2 of 13                      |

Anchoring the curves at equilibrium brought the load transfer and the roll
gradient onto Chrono's. It also raised the car's grip at the limit and moved
the ramp and step traces outside. Fixed geometry, with no travel curves,
scores best. But it cannot jack the car while running straight, so its ride
height (0.3 mm) does not follow Chrono's, and it is not chosen for its score.
The default stays the one the E90 uses, travel curves, so the two cars are
judged the same way. With the toe curves as well, Skidpad's front lifts
68 mm running straight (finding 6).

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
force than Chrono's. Importing it also exposed two bugs in Skidpad's core,
both fixed:

- The cornering stiffness applied the nominal-load scale `LFZO` twice.
  Pacejka's eq. 4.E25 applies it once, and the file's `LFZO = 0.81` made
  Skidpad 19 % too soft.
- The importer did not read `FNOMIN`, the nominal-load key that PAC2002 and
  MF-Tyre files use. It kept a default of 4 000 N against the file's 4 850 N.

No preset sets `LFZO`, so no other validation result moved. Separately, the
harness's Chrono driver read each tire force from a temporary that SWIG had
already freed. The loads it logged were right by chance, within 15 N of the
ground-normal load. The longitudinal and lateral forces were not. No metric
uses them, and the driver now copies the force first.

**2. A parked Chrono car is not at its equilibrium.** Settling with its
brakes on, the Sedan's tires grip sideways as the suspension compresses and
prop the front 24 mm above its equilibrium. Rolling releases them, and the
front settles 4 mm above equilibrium, lifted by its toe-in forces. The E90's
parked state is within 0.6 mm of its equilibrium. Every travel curve was
read from the parked car, so on the Sedan the front's geometry was taken
24 mm away from where the car runs. With its steep roll-centre curve, that
put the front roll centre at 0.234 m instead of 0.188 m, and the front share
of load transfer 5.2 points high. Read from equilibrium, the front share is
38.4 % against Chrono's 38.0 %, and the roll gradient is 3.24 against
3.37°/g.

**3. Chrono's toe follows travel; there is no compliance steer.** The E90
report put its understeer gap down to toe that moves with tire force (its
finding 2), and the first version of this report agreed. Measured properly,
that is wrong on both cars:

- Running straight, each front wheel's toe sits on its own K&C
  toe-against-travel curve at the travel it actually runs at: within 0.01° on
  the Sedan and 0.04° on the E90, coasting, cruising and under full drive.
  The large toe changes between parked, rolling and driving all come from
  ride height through the bump steer.
- In a turn, the left-right toe difference includes Ackermann. With
  Ackermann taken out (from a fine parked steering sweep) and the bump steer
  at each wheel's travel, less than 0.06° is left up to 0.6 g on both cars,
  and 0.1–0.16° on the outer wheel at 0.8 g.
- It is not the solver either. Chrono's vehicles use an iterative solver
  capped at 150 iterations, but ten times the iterations and a much tighter
  tolerance leave the toe unchanged.

Compliance steer in the engine would therefore have nothing to be checked
against here. The understeer gap of about 0.2°/g on both cars remains open.

**4. Near the limit Skidpad holds more grip.** On the ramp Skidpad's car
reaches 1.0 g where Chrono's holds 0.93 g, and its peak reading of
`speed × yaw rate` touches 1.18 g. Its outer rear tire carries about 300 N
more load than Chrono's near the limit, with the outer front wheel 50 mm
into bump, near the end of its roll-centre curve. With fixed geometry the
peak is 0.96 g. The ramp's load, roll and yaw traces follow from this
difference. The cause is open.

**5. Step-steer overshoot.** Chrono's yaw rate overshoots by 23 % and
Skidpad's by 15 %. Both respond within 0.11 s, and the yaw gain, the
sine-steer lag and the sine-steer yaw trace agree. Only the damping of the
yaw mode differs. The unsprung mass, which Chrono carries on separate bodies
and Skidpad on the chassis, is the first suspect. The cause is open.

**6. Toe-force jacking is weaker in Chrono than its geometry says.** Toe-in
pushes each front tire inward, and through the roll centre that lifts the
front. Skidpad lifts it as the geometry says, 6.2 mm on the Sedan against
Chrono's 4.1 mm. On the E90 the geometry predicts about 20 mm, and Chrono's
front lifts 6 mm. Skidpad's lifts 27 mm, which puts the E90's new
ride-height metric outside.

With the toe curves added, the loop closes. A higher front gives more
toe-in through the bump steer, which gives more lift, and Skidpad's Sedan
front runs away to 68 mm, wrecking the handling. That is why the toe curves
failed on both cars, not compliance steer.

Separately, the E90's rear rides 29 mm above its equilibrium at every speed
from 5 to 30 m/s, which its rear roll centre (0.12 m, the same from the
hardpoints and from the sweep) cannot explain. Both are open.

**7. Braking pitch settles faster, on both cars.** The pitch per g matches
(1.84 against 2.03°/g), but the pitch trace in the 0.4-pedal stop is 27 %
out. The E90's is 24.5 % out. On both cars Chrono's body keeps moving after
Skidpad's has settled.

## Across both reference cars

| Pattern                                       | E90                    | Sedan                  |
| --------------------------------------------- | ---------------------- | ---------------------- |
| understeer gradient, Skidpad − Chrono (deg/g) | −0.22                  | −0.22                  |
| braking pitch trace                           | 24.5 %, settles faster | 27.3 %, settles faster |
| toe follows travel (no compliance steer)      | yes                    | yes                    |
| parked ride height is the equilibrium         | yes (within 0.6 mm)    | no (front 24 mm high)  |
| front lift running straight, Skidpad / Chrono | 27 / 6 mm              | 6.2 / 4.1 mm           |
| 0.4-pedal stop                                | Skidpad 7.8 % short    | Skidpad 2.0 % long     |

Three patterns hold on both cars, so they belong to the engine or to how
Chrono builds a vehicle:

- **Understeer.** Skidpad shows 0.22°/g less on both cars.
- **Pitch damping.** The braking pitch settles too fast on both cars.
- **Front lift.** Skidpad lifts the front further than Chrono does when
  toe-in forces jack it.

The E90's 0.4-pedal stop was put down to Chrono's shaft brake realising less
torque. The Sedan uses the same brake model and stops within 2 %, so the
E90's TMsimple tire is the more likely cause.

## Recommendations

1. **Not compliance steer.** Neither car has it (finding 3).
2. **Find out why Chrono's front jacks less than its geometry.** The
   understeer gap, the runaway with toe curves, the E90's rear ride height
   and Skidpad's extra grip near the limit may share a cause in how the
   wheel loads reach the body through the links. Logging Chrono's link and
   spring forces per wheel would show it. That is a harness change first,
   and an engine change only once the cause is known.
3. **Look at the pitch and yaw damping with the unsprung mass in mind.**
   Both settle faster in Skidpad on both cars.

## Reproducing

The reference rows, the equilibrium and the tire file are committed, so the
comparison needs no Chrono:

```sh
pnpm --filter @skidpad/chrono-compare compare --car sedan                   # tables, out/sedan/
pnpm --filter @skidpad/chrono-compare compare --car sedan --fixed-geometry  # without travel curves
pnpm --filter @skidpad/chrono-compare compare --car sedan --toe-curve       # with the toe curves too
pnpm --filter @skidpad/chrono-compare test                                  # both cars' regression guards
```

To regenerate the reference, about 8 GB and a few minutes:

```sh
micromamba create -p /opt/mm/chrono -c projectchrono -c conda-forge python=3.12 pychrono=9.0.1 numpy
/opt/mm/chrono/bin/python tools/chrono-compare/chrono/sedan.py
/opt/mm/chrono/bin/python tools/chrono-compare/chrono/kc.py sedan            # kinematics sweep
/opt/mm/chrono/bin/python tools/chrono-compare/chrono/equilibrium.py sedan   # after sedan.py
```
