# Skidpad against measured data: NHTSA's 1994 Ford Taurus

|           |                                                                                                     |
| --------- | --------------------------------------------------------------------------------------------------- |
| Date      | 2026-11-01                                                                                          |
| Reference | Instrumented tests of a 1994 Ford Taurus GL by NHTSA's Vehicle Research and Test Center, SAE 970563 |
| Skidpad   | core at this commit, four-wheel model, 1 kHz                                                        |
| Harness   | [`tools/nhtsa-compare`](../../tools/nhtsa-compare) (`pnpm taurus`)                                  |

The second real car, after the [Jeep Cherokee](nhtsa-jeep-cherokee.md), and
the first front-drive one. VRTC tested a 1994 Ford Taurus GL (3.8 l V6,
four-speed automatic, speed-sensitive power rack and pinion, General
Ameri-tech 205/65R15 at 35 psi) for the same simulator programme, and
published sample results in J. P. Chrstos and P. A. Grygier, "Experimental
Testing of a 1994 Ford Taurus for NADSdyna Validation", SAE 970563 (NHTSA
hosts a copy as `taurus_test.pdf`). Unlike the Jeep paper it has no
simulation results, and it plots only a few of its runs.

## The reference data

`digitise/taurus.py` reads the vector plots with the Jeep's extractor
(`digitise.py`), with the tick limit raised for this paper's longer ticks.
The frequency responses are on log axes labelled only at 10⁰ and 10¹, so
their frequency axis is calibrated from the minor ticks (1, 2, … 10,
20 rad/s). The CSVs are committed in
`tools/nhtsa-compare/reference/ford_taurus/`; the paper is not (SAE
copyright).

| Data                                               | Figure | Used as                                                     |
| -------------------------------------------------- | ------ | ----------------------------------------------------------- |
| J-turn, 33 m/s, 6 m/s²: lateral acceleration       | 7      | one run (V0RCX06), compared                                 |
| The same J-turn: hand-wheel angle                  | 10     | mean of ten repeats, drives the model                       |
| The same J-turn: speed                             | 11     | mean of ten repeats, followed by the speed controller       |
| J-turn, 11 m/s, 2 m/s²: lateral acceleration       | 8      | digitised, not compared: its hand-wheel angle isn't plotted |
| Pulse steer, 22.8 m/s: yaw-rate frequency response | 14     | magnitude, phase and coherence at 7 frequencies, compared   |
| The same: lateral acceleration frequency response  | 15     | the same                                                    |

The J-turn's accelerometer reads 0.16 m/s² on the straight before the
steer, so the measured lateral acceleration is zeroed by its mean before
the steer. Its 2–5 s mean is then 5.96 m/s² (VRTC quotes 6.11 m/s² for the
raw signal).

VRTC computed the frequency responses from repeat pulse steers of about
0.57 rad of hand wheel at 22.8 m/s (maneuver PD, 8 runs), as cross spectrum
over input spectrum. Their magnitudes are per radian of hand wheel. Every
channel went through the same 10 Hz filter, so its phase cancels in the
ratio.

## How the Skidpad model was built

There is no measured inertia record for this car that the comparison can
use, and published specifications are thin, so this is an estimated build
(`src/taurus.ts`, every value without a source marked ESTIMATE):

- **Sourced**: the wheelbase (2.692 m), and the mass. The paper says the
  car's mass varied over the programme by "more than 70 kilograms, which is
  approximately 4 percent of the total", so about 1750 kg with the driver
  and data system. Also the drivetrain layout, tire size and steering type.
- **Estimated**: 62 % of the weight on the front, a 0.55 m centre of mass,
  yaw inertia m·a·b (which the Jeep's measured value matches within 1 %),
  tracks, springs, bars, dampers, roll centres, the tire's feel parameters
  (peak friction 0.85, a 1990s all-season), the engine curve and the
  gearbox ratios.
- **Fitted**: only the steering ratio, on the J-turn's steady lateral
  acceleration. It stands in for everything between the hand wheel and the
  tires' force that the build cannot separate: the steering's compliance,
  the tires' cornering stiffness and the understeer. The frequency response,
  at another speed and amplitude, is then a prediction.

## The runs

The J-turn is driven with the measured hand-wheel angle while a PI
controller follows the measured speed (33.5 m/s falling to 32.8 m/s), in
fourth gear. The frequency response is read from a sine of hand wheel at
each of the paper's seven frequencies, 0.2 rad (about 1 m/s²), at 22.8 m/s:
after at least 3 s of settling, the yaw rate and road-plane lateral
acceleration are projected onto the input over whole cycles. For a linear
response this is the quantity VRTC's pulse method estimates.

## Tolerances

Set before the first run, not moved since:

| Result                                                | Tolerance           |
| ----------------------------------------------------- | ------------------- |
| J-turn steady lateral acceleration, 2–5 s             | ±10 %               |
| J-turn response time, 50 % wheel to 90 % lateral acc. | ±0.1 s              |
| J-turn peak (0.2 s mean) over steady                  | ±0.05               |
| J-turn lateral acceleration trace                     | RMS ≤ 10 % of range |
| Frequency response magnitude                          | ±20 %               |
| Frequency response phase                              | ±15°                |

A frequency point is judged only where VRTC's coherence is at least 0.8.
The yaw-rate coherence is above 0.9 at every point. The lateral
acceleration's falls to 0.5 to 0.7 above 9.8 rad/s, where the paper's
confidence band widens, so those four points are shown but not judged.

## Results

The fitted steering ratio is 18.7 (the estimated 16 steers 8 % too much in
the J-turn). `pnpm taurus` prints both builds in full.

| Fitted build, ratio 18.7       | Measured | Skidpad | Difference |             |
| ------------------------------ | -------- | ------- | ---------- | ----------- |
| J-turn steady ay, 2–5 s (m/s²) | 5.96     | 5.96    | 0 %        | fitted      |
| J-turn response time (s)       | 0.41     | 0.35    | −0.06      | pass        |
| J-turn peak over steady        | 1.157    | 1.101   | −0.056     | **outside** |
| J-turn ay trace, RMS / range   |          | 3.6 %   |            | pass        |

| Frequency (rad/s) | Yaw gain, measured / Skidpad (1/s) | Yaw phase, measured / Skidpad (°) | Ay gain, measured / Skidpad (m/s²) | Ay phase, measured / Skidpad (°) |
| ----------------- | ---------------------------------- | --------------------------------- | ---------------------------------- | -------------------------------- |
| 2.5               | 0.220 / 0.291 **+32 %**            | −14 / −12                         | 5.00 / 6.33 **+27 %**              | −20 / −20                        |
| 4.9               | 0.243 / 0.296 **+22 %**            | −36 / −25                         | 4.63 / 5.43 +17 %                  | −42 / −41                        |
| 7.4               | 0.250 / 0.293 +17 %                | −62 / −41 **+21**                 | 3.58 / 3.69 +3 %                   | −65 / −62                        |
| 9.8               | 0.224 / 0.263 +18 %                | −89 / −58 **+31**                 | (2.54 / 1.83)                      | (−76 / −65)                      |
| 12.3              | 0.190 / 0.225 +18 %                | −111 / −71 **+40**                | (1.87 / 1.07)                      | (−70 / −32)                      |
| 14.7              | 0.157 / 0.192 **+23 %**            | −129 / −81 **+48**                | (1.72 / 1.26)                      | (−58 / +6)                       |
| 17.2              | 0.142 / 0.164 +16 %                | −143 / −90 **+53**                | (1.49 / 1.87)                      | (−62 / +17)                      |

Bold is outside tolerance; parentheses are not judged (low coherence). 14
of 24 judged results are within tolerance for the fitted build, 9 of 24
for the estimated one.

## Findings

1. **The lateral acceleration's phase is right.** Up to 7.4 rad/s, where
   its coherence is high, Skidpad's lateral acceleration lags the hand
   wheel within 3° of the car's, from the estimated build with no phase
   fitting at all.

2. **The gain at 22.8 m/s is 20–30 % high once the ratio is fitted at
   33.5 m/s.** The car's gain grows with speed more than the model's does:
   at the J-turn's 0.6 g the estimated tires (peak friction 0.85, 62 % of
   the weight on the front) are nearer their limit than the car's, so the
   fit takes a long ratio, which is then too short for the pulse steer's
   linear range. With peak friction 1.0 the fitted ratio is 21.4 and the
   low-frequency yaw gain 16 % high, inside tolerance, though a ratio of
   21 is long for this car; the tire's cornering stiffness and the steering
   compliance are the other unknowns in the same number. The tires' force
   and moment data exist (the paper's reference 6, a thesis) but are not
   public.

3. **The car's yaw rate lags far more than the model's at high
   frequency.** Skidpad's yaw phase tends to −90°, as a rigid car with
   kinematic steering does; the car's reaches −143° at 17.2 rad/s. Above
   7 rad/s the extra lag is close to a constant 55 ms delay (21° at 7.4,
   53° at 17.2 rad/s). Something between the hand wheel and the yaw moment
   lags: the power steering and the steering's compliance against the
   tires' aligning moment, and the tires' relaxation. Doubling the lateral
   relaxation length (0.45 m to 0.9 m) takes the model to −111° at
   17.2 rad/s, part of the way. The lateral acceleration doesn't show the
   same lag, so a time offset between the channels is unlikely to be the
   cause, but this comparison can't rule it out.

4. **The J-turn is close.** The fitted build's trace is within 3.6 % of the
   measured range; it rises 0.06 s sooner and overshoots a little less
   (1.10 against 1.16 of steady), which fits finding 3: less lag to
   overshoot with.

## Reproducing

```sh
pnpm --filter @skidpad/nhtsa-compare taurus   # both builds, tables, out/taurus/
pnpm --filter @skidpad/nhtsa-compare test     # the regression guard (CI runs it)
```

To regenerate the CSVs (needs `pdfplumber` and the paper):
`python3 -I tools/nhtsa-compare/digitise/taurus.py taurus_test.pdf tools/nhtsa-compare/reference/ford_taurus`.
