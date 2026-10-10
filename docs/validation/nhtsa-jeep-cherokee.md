# Skidpad against measured data: NHTSA's 1997 Jeep Cherokee

|           |                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------- |
| Date      | 2026-10-10                                                                                                          |
| Reference | Instrumented tests of a 1997 Jeep Cherokee Sport by NHTSA's Vehicle Research and Test Center, from SAE 2000-01-0700 |
| Skidpad   | core at this commit, four-wheel model, 1 kHz                                                                        |
| Harness   | [`tools/nhtsa-compare`](../../tools/nhtsa-compare)                                                                  |

The first comparison against a real car rather than another simulator.
NHTSA's Vehicle Research and Test Center (VRTC) instrumented a 1997 Jeep
Cherokee Sport (4.0 l I6, four-speed automatic, solid axles, Goodyear
Wrangler RT/S P225/75R15 at 33 psi) to validate the vehicle model of the
National Advanced Driving Simulator, and published the measured responses
against the simulator's in M. K. Salaani and G. J. Heydinger, "Model
Validation of the 1997 Jeep Cherokee for the National Advanced Driving
Simulator", SAE 2000-01-0700 (NHTSA hosts a copy as `jeep_valid.pdf`). The
handling manoeuvres were driven open loop against steering stops and repeated
up to ten times; the plotted experiment is the mean of the repeats.

## The reference data

The paper's plots are vector drawings, so the traces are read exactly rather
than traced by eye: `digitise/digitise.py` takes each curve's polyline from
the PDF and calibrates each axis from its own tick marks by least squares.
The worst tick misfit is under 0.5 % of a tick spacing on every axis used.
The CSVs are committed in `tools/nhtsa-compare/reference/jeep_cherokee/`; the
paper is not (SAE copyright).

| Manoeuvre                                 | Figures | Measured channels                                               |
| ----------------------------------------- | ------- | --------------------------------------------------------------- |
| Slowly increasing steer, 11 m/s           | 1–4     | hand wheel, lateral acceleration, yaw rate, front and rear roll |
| Step steer (J-turn), 158° at 12 m/s       | 5–8     | the same                                                        |
| Double lane change, 12 m/s and 22.5 m/s   | 9–12    | the same                                                        |
| Straight-line braking, moderate, severe   | 15–22   | pedal force, line pressures, deceleration, speed                |
| Straight-line acceleration, 10 % throttle | 23–25   | throttle, acceleration, speed                                   |

The braking and acceleration runs are digitised but not compared yet: they
are driven by pedal force and throttle-plate opening, and turning those into
brake torque and engine torque needs the brake gain and the part-throttle
engine map, which nothing public gives. They become useful once those are
measured or fitted on one run and predicted on the other. The pulse-steer
frequency responses (figures 13–14) are on log axes the extractor does not
read yet.

## How the Skidpad model was built

The measured parameter set is in a companion paper, SAE 1999-01-0121, which
this comparison does not have. The car is built from published
specifications and class-typical values (`src/jeep.ts`, each value marked
with its source or as an estimate):

- **Published:** wheelbase, track, steering ratio and lock, curb mass, the
  engine's rating, the transmission and axle ratios, the tire size and
  pressure.
- **Estimated:** test mass (curb plus driver and instrumentation), the
  centre-of-mass position and height, the inertias, spring rates (owners'
  figures for the coils and leaf packs, carried to the wheel at their roll
  rate), damping, the front anti-roll bar, roll-centre heights, and the tire,
  which is the pickup preset's light-truck all-terrain tire resized.

Three builds are compared:

1. **Estimated:** exactly as above, nothing taken from the measured
   behaviour.
2. **Fitted, ratio:** three values identified from the slowly increasing
   steer alone (`src/fit.ts`). The steering ratio is fitted to the lateral
   acceleration gain; it stands in for the steering compliance and the
   tire's cornering stiffness, which that test cannot separate. The front
   anti-roll bar is fitted to the roll gradient, and the tire peak friction
   to the maximum lateral acceleration. The step steer and both lane changes
   remain predictions.
3. **Fitted, compliance** (added after the first fitted run, see below):
   the same, but the ratio stays at the published 14 and the harness
   instead takes a compliance proportional to lateral acceleration off the
   hand wheel, `(hand wheel − c · a_y) / 14`, with `c` fitted to the same
   gain.

The harness steers with the measured hand-wheel angle and holds the test's
constant speed with the Chrono harness's PI controller at stiffer gains,
after driving up to speed and settling in a straight line, in a gear held
for the whole manoeuvre: second at 11 and 12 m/s, third at 22.5 m/s, the
highest that keeps the engine above about 1500 rpm. Lateral acceleration is
compared in the road plane, as VRTC reports it (see below). Roll is the mean
of the front and rear measurements, from its value at the start of the
window, since Skidpad's body is rigid and the Jeep's frame twists between
the two sensors.

## Expected results, set before the run

The tolerances in `src/compare.ts` and these expectations were committed
before Skidpad was first run against the measured data.

Measured, from the digitised traces: the yaw-rate gain in the linear range
is 0.18 deg/s per degree of hand wheel, the lateral acceleration gain
3.6 m/s² per 100°, the maximum lateral acceleration 7.05 m/s², and the roll
gradient 3.6 deg/g. Read at the published ratio of 14, the hand-wheel angle
implies an understeer gradient of 7.4 deg/g, about twice what a car of this
kind has; most of the difference is the steering's compliance, which
Skidpad's kinematic steering does not have.

- **Estimated build.** The steady-state gains (yaw rate, lateral
  acceleration, the step steer's steady values, the lane changes' peaks) are
  expected to come out 30–60 % too high, all for the one reason above, and
  the understeer gradient read at 14 to be 4–5 deg/g low. Roll gradient,
  maximum lateral acceleration and the response times are expected inside
  their bands but are coin flips: they rest on estimated springs, bars, roll
  centres and tire.
- **Fitted build.** The three fitted metrics pass by construction. Expected
  to pass as predictions: the step steer's steady lateral acceleration and
  yaw rate (±10 %, at a higher level than the fit's range), its response
  times (±0.08 s), the lane changes' peaks (±15 %) and the lateral
  acceleration and yaw-rate traces (≤ 15 % of range). Expected at risk: the
  roll traces of the 22.5 m/s lane change, which depend on the estimated
  damping and roll inertia, and anything past 6 m/s², where the measured
  car's front tires plough and Skidpad's resized tire was not built for this
  load range.

## Results

The fitted rows marked "(fit)" are matched by construction; everything else
in the fitted builds is a prediction. Differences outside tolerance are in
bold.

| Manoeuvre | Metric (unit)                                                 | Tolerance | Measured | Estimated         | Fitted, ratio     | Fitted, compliance |
| --------- | ------------------------------------------------------------- | --------- | -------- | ----------------- | ----------------- | ------------------ |
| sis       | yaw-rate gain, 1–4 m/s² (deg/s per deg)                       | ±15 %     | 0.18     | 0.28 (**+53 %**)  | 0.19 (+4 %)       | 0.19 (+4 %)        |
| sis       | lateral acceleration gain, 1–4 m/s² (m/s² per 100 deg)        | ±15 %     | 3.60     | 5.28 (**+46 %**)  | 3.60 (-0 %) (fit) | 3.60 (+0 %) (fit)  |
| sis       | understeer gradient at the published ratio of 14 (deg/g)      | ±1        | 7.40     | 1.30 (**-6.10**)  | 7.48 (+0.08)      | 7.47 (+0.07)       |
| sis       | maximum lateral acceleration, 1 s mean (m/s²)                 | ±10 %     | 7.05     | 7.24 (+3 %)       | 7.05 (-0 %) (fit) | 7.05 (-0 %) (fit)  |
| sis       | roll gradient, 1–4 m/s² (deg/g)                               | ±25 %     | 3.63     | 4.80 (**+32 %**)  | 3.63 (+0 %) (fit) | 3.63 (+0 %) (fit)  |
| step      | steady lateral acceleration, 10–16 s (m/s²)                   | ±10 %     | 5.54     | 7.25 (**+31 %**)  | 6.05 (+9 %)       | 5.97 (+8 %)        |
| step      | steady yaw rate, 10–16 s (deg/s)                              | ±10 %     | 27.1     | 34.6 (**+28 %**)  | 28.9 (+7 %)       | 28.5 (+5 %)        |
| step      | steady roll, 10–16 s (deg)                                    | ±25 %     | 1.89     | 3.54 (**+87 %**)  | 2.24 (+19 %)      | 2.21 (+17 %)       |
| step      | yaw-rate response time, 50 % wheel to 90 % yaw rate (s)       | ±0.08     | 0.28     | 0.23 (-0.05)      | 0.26 (-0.02)      | 0.23 (-0.05)       |
| step      | lateral acceleration response time, 50 % wheel to 90 % ay (s) | ±0.08     | 0.28     | 0.23 (-0.05)      | 0.22 (-0.06)      | 0.19 (**-0.09**)   |
| step      | yaw-rate overshoot (%)                                        | ±10       | 0.77     | 2.75 (+1.98)      | 1.83 (+1.06)      | 2.42 (+1.65)       |
| lc12      | peak lateral acceleration (m/s²)                              | ±15 %     | 5.57     | 7.09 (**+27 %**)  | 5.91 (+6 %)       | 5.95 (+7 %)        |
| lc12      | peak yaw rate (deg/s)                                         | ±15 %     | 27.6     | 35.4 (**+28 %**)  | 29.1 (+6 %)       | 29.7 (+8 %)        |
| lc12      | peak roll (deg)                                               | ±25 %     | 2.13     | 3.95 (**+86 %**)  | 2.40 (+13 %)      | 2.39 (+12 %)       |
| lc22      | peak lateral acceleration (m/s²)                              | ±15 %     | 6.21     | 8.35 (**+35 %**)  | 7.21 (**+16 %**)  | 6.61 (+6 %)        |
| lc22      | peak yaw rate (deg/s)                                         | ±15 %     | 22.1     | 38.9 (**+76 %**)  | 26.6 (**+20 %**)  | 22.6 (+2 %)        |
| lc22      | peak roll (deg)                                               | ±25 %     | 3.42     | 10.6 (**+211 %**) | 4.41 (**+29 %**)  | 3.80 (+11 %)       |

| Manoeuvre | Channel | Tolerance | Estimated   | Fitted, ratio | Fitted, compliance |
| --------- | ------- | --------- | ----------- | ------------- | ------------------ |
| sis       | ay      | ≤15 %     | 11.9 %      | 2.9 %         | 2.0 %              |
| sis       | yawRate | ≤15 %     | 14.5 %      | 4.3 %         | 3.9 %              |
| sis       | roll    | ≤25 %     | **39.8 %**  | 8.8 %         | 7.4 %              |
| step      | ay      | ≤15 %     | **28.3 %**  | 9.7 %         | 8.7 %              |
| step      | yawRate | ≤15 %     | **26.2 %**  | 7.1 %         | 6.1 %              |
| step      | roll    | ≤25 %     | **75.4 %**  | 18.4 %        | 17.4 %             |
| lc12      | ay      | ≤15 %     | 10.5 %      | 5.4 %         | 6.1 %              |
| lc12      | yawRate | ≤15 %     | 11.5 %      | 4.9 %         | 5.3 %              |
| lc12      | roll    | ≤25 %     | **26.0 %**  | 10.0 %        | 10.6 %             |
| lc22      | ay      | ≤15 %     | **47.9 %**  | 9.2 %         | 9.5 %              |
| lc22      | yawRate | ≤15 %     | **52.0 %**  | 8.4 %         | 10.9 %             |
| lc22      | roll    | ≤25 %     | **115.1 %** | 14.3 %        | 15.2 %             |

| Build              | Front anti-roll bar | Steering                              | Peak friction | Within tolerance                        |
| ------------------ | ------------------- | ------------------------------------- | ------------- | --------------------------------------- |
| Estimated          | 20.0 kN/m           | ratio 14 (published)                  | 0.85          | 4 of 17 metrics, 4 of 12 traces         |
| Fitted, ratio      | 28.7 kN/m           | ratio 20.5                            | 0.82          | 14 of 17 (9 of 12 predicted), 12 of 12  |
| Fitted, compliance | 28.6 kN/m           | ratio 14, 8.8° of hand wheel per m/s² | 0.82          | 16 of 17 (11 of 12 predicted), 12 of 12 |

### What changed after the first run

Three things in the harness changed after Skidpad first ran against the
data. None moves a tolerance or a measured value; each is recorded here
with what it did.

- **The gear is held.** In the first fitted run, Skidpad's automatic
  kicked down from second to first at 42.5 s, near the limit of the slowly
  increasing steer, as the speed controller opened the throttle; the shift's
  drive-torque transient on the open rear differential, with the inside rear
  tire lightly loaded, spun the car (yaw rate to 90 deg/s, the car stopped).
  The measured car carries on ploughing at 6.4–6.6 m/s². Skidpad's automatic
  sits in first at 11 m/s, at 2900 rpm, right at its own 1–2 shift point.
  The test car's engine speed is not published for these runs, and a shift
  is a powertrain-control event rather than handling, so each manoeuvre now
  holds one gear.
- **The linear range is the rise.** The slowly increasing steer's linear
  range was defined as the rows with 1–4 m/s² "before the peak"; when the
  model spun, its lateral acceleration came back down through that range
  before its later peak, and those rows entered the fit. It is now the rows
  before the lateral acceleration first passes 4 m/s², as the text above
  meant. The measured metrics are unchanged by it to the last digit.
- **Lateral acceleration is compared in the road plane.** Skidpad's
  `LatAccel` is the contact and aero force over mass rotated into the body,
  what a body-fixed accelerometer reads, so in a turn it carries
  `g · sin(roll)` of gravity. VRTC's is in the road plane: in the step
  steer its steady 5.54 m/s² sits below speed × yaw rate (5.68 m/s²), where
  a body-fixed reading would sit about 0.3 m/s² above it. The first run
  compared the two as they were, which the pre-run text above says; the
  harness now takes the gravity component out of Skidpad's reading
  (`--body-fixed-ay` keeps the old comparison). Compared the old way, the
  ratio fit lands at 22.0 instead of 20.5 and predicts 11 of 12 metrics,
  but the lateral acceleration and the yaw rate then disagree with each
  other in the step steer by the roll term, so that result was partly an
  error cancelling the steering's.

## Findings

1. **The car's steering gives way under load, and Skidpad's kinematic
   steering cannot show it.** At the published 14:1, the measured hand-wheel
   angle implies 7.4 deg/g of understeer gradient; the estimated build,
   with a resized class tire and no compliance, has 1.3 deg/g, and all its
   steady-state gains come out 30–75 % high. A constant effective ratio
   fitted at 11 m/s (20.5:1) fixes the steady states at 11 and 12 m/s but
   steers too much at 22.5 m/s: the lane change's peaks come out 16–29 %
   high. A compliance proportional to lateral acceleration at the published
   ratio (8.8° of hand wheel per m/s², 0.63° at the road wheels) predicts
   both lane changes and the step steer: 11 of 12 predicted metrics and
   every trace. So what the car adds to its kinematic steering grows with
   lateral force, not with steering angle, which is what compliance steer
   under the aligning moment and lateral force does. The term cannot be
   separated, from these tests, from other understeer that grows with
   lateral force: a lower front cornering stiffness than the class tire's,
   or roll steer of the axles. Skidpad has neither compliance steer nor
   axle roll steer yet; the README's roadmap names compliance steer as the
   next step after the travel curves, and this is the first measured
   evidence for it.
2. **Transient lateral acceleration builds faster than the car's.** Every
   build reaches 90 % of its steady lateral acceleration 0.05–0.09 s sooner
   after the step than the car (0.28 s), while the yaw rate is within
   0.05 s. The harness's compliance acts instantly; real compliance and the
   tire's lag have dynamics of their own. The estimated relaxation length
   (0.45 m) and the steering's own dynamics are the candidates.
3. **Roll grows less than linearly on the car.** With the bar fitted to the
   roll gradient between 1 and 4 m/s², the model rolls 17–19 % more than
   the car in the step steer at 5.5 m/s² and 11–13 % more at the lane
   changes' peaks. The car's roll stiffness rises with roll (leaf springs
   and progressive jounce bumpers are the usual reasons); Skidpad's springs
   are linear until the bump stop. Within tolerance, but consistent.
4. **The class tire is close on grip.** The pickup preset's all-terrain
   tire, resized, gives a maximum of 7.24 m/s² against the car's 7.05
   (+3 %); the fit wants peak friction 0.82 instead of 0.85.
5. **The measured car ploughs at the limit; the model's inside front tire
   nearly lifts.** Past its peak the car loses lateral acceleration slowly
   as the hand wheel winds on, with the yaw rate steady, which is limit
   understeer. The model at the same point carries about 600 N on the
   inside front tire out of a static 4600 N. The Jeep's own load split at
   the limit is not measured here.
6. **Front and rear roll differ on the car.** The measured roll at the
   front sensors is 14–23 % larger than at the rear in the steady parts of
   the step steer and the slowly increasing steer: the frame twists. A
   rigid body cannot show that; the comparison uses the mean.

## Recommendations

- **Compliance steer in the core.** A per-axle steer compliance under the
  aligning moment and lateral force (and its lag) is what this car most
  needs, and the measured data here can check it: with it, the fitted
  build should not need the harness's compliance term, and the response
  times should come into line. The same data can then judge axle roll
  steer, which a solid axle on leaf springs has.
- **Measured inertia and centre of mass.** NHTSA measured this car's
  inertial parameters (SAE 1999-01-1336; a copy is hosted by Auburn
  University, which this environment cannot reach). Replacing the estimated
  mass, centre-of-mass height and inertias would remove the largest
  remaining estimates outside the fit.
- **The braking and acceleration runs**, digitised but not compared, once a
  brake gain and a part-throttle map are fitted on one run and predicted on
  the other.
- **The automatic at a constant 11 m/s.** Skidpad's shift schedule holds
  first gear to 11 m/s at part throttle and kicks down with a torque
  transient big enough to spin a car near the limit. Worth a look on its
  own, outside this comparison.

## Compliance steer in the core

### Expected results, set before the run

Finding 1 led to compliance steer in the core (ADR-0027). The rerun keeps
everything about the fitted builds but the steering: the ratio stays at the
published 14, the harness steers with the measured hand wheel alone, and the
core's aligning-torque compliance, `steering.alignTorqueComplianceDeg`, is
fitted to the slowly increasing steer's lateral acceleration gain in place
of the harness's term (`pnpm fit --core`). The tolerances are unchanged. The
lateral-force compliances stay at zero: the slowly increasing steer cannot
separate them from the aligning-torque term, and nothing public says how the
Jeep's split between them.

Expected, before the run:

- **The fitted value** near 10 deg/kN·m. The harness's term took 0.63° of
  road-wheel angle off per m/s²; the front kingpin torque grows by about the
  mechanical trail (0.035 m) plus the class tire's pneumatic trail
  (0.03 m) times the front axle's 935 N per m/s², about 61 N·m per m/s².
  Within the schema's bound of 30.
- **The predictions** as good as the harness's compliance or better on the
  steady and peak metrics: the kingpin torque follows the front lateral
  force, which in steady cornering is lateral acceleration times the front
  axle's share, so the two terms differ only in transients and at the limit,
  where the pneumatic trail collapses and the core's compliance lets go of
  the wheels a little. Pass expected on 11 of 12 predicted metrics again,
  every trace within tolerance.
- **The lateral acceleration response time**, the harness version's one
  miss (0.09 s quicker than the car against ±0.08 s), expected to move
  toward the car's 0.28 s: the core's compliance acts through the tire's
  force, which lags the slip angle by the relaxation length, where the
  harness's acted on the body's acceleration at once. Expected inside its
  band, but not by much.
- **Maximum lateral acceleration** and the slowly increasing steer's limit
  expected unchanged within 1 %: the fit still matches them by the tire's
  peak friction.

## Reproducing

```sh
pnpm --filter @skidpad/nhtsa-compare compare              # estimated build
pnpm --filter @skidpad/nhtsa-compare fit                  # fitted, ratio
pnpm --filter @skidpad/nhtsa-compare fit -- --compliance  # fitted, compliance
pnpm --filter @skidpad/nhtsa-compare test                 # the regression guard
```

The digitised traces are committed. To regenerate them from the paper:
`python3 -I tools/nhtsa-compare/digitise/digitise.py jeep_valid.pdf tools/nhtsa-compare/reference/jeep_cherokee`
(needs `pdfplumber`).
