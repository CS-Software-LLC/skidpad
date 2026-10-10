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

Two builds are compared:

1. **Estimated:** exactly as above, nothing taken from the measured
   behaviour.
2. **Fitted:** three values identified from the slowly increasing steer
   alone (`src/fit.ts`). The steering ratio is fitted to the lateral
   acceleration gain; it stands in for the steering compliance and the
   tire's cornering stiffness, which that test cannot separate. The front
   anti-roll bar is fitted to the roll gradient, and the tire peak friction
   to the maximum lateral acceleration. The step steer and both lane changes
   remain predictions.

The harness steers with the measured hand-wheel angle over the steering
ratio and holds the test's constant speed with the Chrono harness's PI
controller, after driving up to speed and settling in a straight line.
Lateral acceleration is compared as measured and as Skidpad reports it;
roll is the mean of the front and rear measurements, from its value at the
start of the window, since Skidpad's body is rigid and the Jeep's frame
twists between the two sensors.

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

Not run yet.
