# Skidpad against exact answers

|           |                                                                                                    |
| --------- | -------------------------------------------------------------------------------------------------- |
| Date      | 2026-10-14                                                                                         |
| Reference | Closed-form textbook theory (Gillespie, Rajamani, Milliken, Pacejka ch. 1)                         |
| Skidpad   | core at this commit, both models, 1 kHz                                                            |
| Harness   | [`crates/skidpad-core/tests/analytic_tests.rs`](../../crates/skidpad-core/tests/analytic_tests.rs) |

The comparisons against Chrono and NHTSA's Jeep ask whether the model
describes a car. These tests ask whether the code solves the equations it
claims to. Each one drives the core where the answer has a closed form and
compares the two. They need no outside data and run with `cargo test`.

## The textbook car

Every test runs one car, built by `textbook_car()` in
`tests/common/textbook.rs`. It is the default definition with the effects
that have no closed form removed:

- The rear spring and damper rates are set so `k_f a = k_r b`, so heave and
  pitch do not couple.
- Bump and rebound damping are equal.
- There are no anti-roll bars (the roll test adds them back), no Ackermann
  and no aero drag (the coast-down adds it back).
- Toe, camber, compliance steer, jacking and roll-centre height are already
  zero in the default.

The wheels are massless and rigid (`vehicle/four_wheel.rs`), so each body
mode is a single spring, mass and damper rather than the two-mass quarter
car.

## Results

Tolerances were set from the theory before the first run.

| Check                                                                  | Theory                                                                                  | Tolerance               | Worst result                     |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------- | -------------------------------- |
| Heave free decay: frequency, damping ratio                             | `√(K/m)`, `C / 2√(Km)`                                                                  | 2 %, 0.02               | 0.17 %, 0.0006                   |
| Heave energy balance                                                   | Spring and kinetic energy lost equals damper work                                       | 0.5 % of initial energy | 0.27 %                           |
| Pitch free decay: frequency, damping ratio                             | `√((Σkx² − mgh) / I_eff)`                                                               | 2 %, 0.02               | 0.10 %, 0.0011                   |
| Four-post rig, heave, 0.5 to 8 Hz: gain, phase                         | Base-excited oscillator `(K + iωC) / (K − mω² + iωC)`                                   | 2 %, 2°                 | 0.38 %, 0.25°                    |
| Four-post rig, pitch, 0.5 to 8 Hz: gain, phase                         | The same in pitch, with `m g h` and `I_eff`                                             | 2 %, 2°                 | 0.42 %, 0.16°                    |
| Coast-down from 30 m/s over 30 s, without and with aero, both models   | `m_eff v' = −(C_rr m g + ½ρC_dA v²)`, straight line or tangent                          | 0.5 % of speed          | 0.06 %                           |
| Step steer, single-track: yaw rate, lateral acceleration along the run | Linear single-track model with first-order tire lag, driven by the same steer and speed | 2 % of steady state     | 0.54 %, 0.55 %                   |
| Step steer, four-wheel: yaw rate along the run                         | The same                                                                                | 3 % of steady state     | 1.3 %                            |
| Sine steer, single-track, 0.2 to 3 Hz: yaw rate and lat accel          | The model's transfer function at the run's mean speed                                   | 3 %, 3°                 | 1.9 % (lat accel at 2 Hz), 0.75° |
| Steady roll at 0.8, 1.6 and 2.4 m/s²                                   | `φ = m a_y h / (K_φ − m g h)`; each axle moves `K_φ,axle φ / t`; overturning moment     | 2 %, 2 %, 1 %           | 0.22 %, 0.07 %, 0.14 %           |
| Convergence, 500 Hz to 2 kHz against 16 kHz                            | Semi-implicit Euler is first order                                                      | order 0.85 to 1.15      | 1.00 (heave, single-track), 0.96 |

## Notes

**Pitch carries the wheels' spin.** As the body pitches by `θ`, every ray
tilts with it and its contact slides `h θ` along the ground. That does two
things. The static loads gain a moment `m g h θ` that helps the rotation.
The free-rolling wheels also turn by `h θ / r`, which adds `I_w h² / r²` per
wheel to the pitch inertia (25 kg·m² on 1800 for this car). The first run
left out the wheel term. It still passed, but with a steady residual of
0.8 % on the pitch frequency and 1.6 % on the rig's gain above resonance,
the size the wheel term predicts. With the term in, the residuals fell to
0.1 % and 0.4 %. It is in `pitch_inertia()`.

**Roll free decay is not tested.** Released in roll, the body also sways,
because the contacts slide sideways under it and the tires resist that
through their standstill damping (ADR-0010). That makes it a coupled system
with no textbook answer. It measured 1.25 Hz, below both the free-pivot
(1.65 Hz) and ground-pivot (1.29 Hz) limits. Steady roll, where the sway
has settled, is tested instead.

**Four-wheel lateral acceleration is not compared on the step steer.** The
`LatAccel` channel is body-fixed, as an accelerometer reads it, so it
carries `g sin φ` from roll. The four-wheel yaw rate settles 1 % below the
single-track theory, because lateral load transfer costs the more loaded
tires a little stiffness.

**The tests catch real errors.** Scaling the spring force by 1.05 in
`four_wheel.rs` fails the heave, pitch, rig and roll tests. Scaling the tire
relaxation rate by 1.1 fails both step steers and the frequency response.
Both mutations were reverted.

**Coast-down leaves out the drivetrain's inertia.** It adds about 0.2 % to
the effective mass, which is where most of the 0.06 % speed residual comes
from.

## Unsprung mass (ADR-0028)

Harness: [`crates/skidpad-core/tests/unsprung_tests.rs`](../../crates/skidpad-core/tests/unsprung_tests.rs),
2026-10-23.

These run the "two-mass car" of `tests/common/textbook.rs`. It is the
textbook car made symmetric front to rear (centre of mass at mid wheelbase,
equal springs and dampers), with 40 kg wheels on 250 kN/m tires damped at
500 N·s/m. Its heave is then exactly four two-mass quarter cars
(Gillespie ch. 5), with a body mode near 1.4 Hz and a wheel hop near
13 Hz. Tolerances were set before the first run.

| Check                                                                              | Theory                                                                         | Tolerance               | Worst result                                                         |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------- | -------------------------------------------------------------------- |
| Free response from a 5 mm drop of body and wheels, 3 s, 1 kHz                      | The two-mass quarter car, integrated with RK4 at 10 µs                         | 2 % of the drop         | body 0.72 %, wheels 1.25 %                                           |
| Four-post rig, 0.5 to 25 Hz: body and total tire load                              | `Z_s/Y` and `(K_t + iωC_t)(Y − Z_u)/Y` of the quarter car                      | 3 %, 3°                 | 1.08 %, 2.37° (4 kHz; see below)                                     |
| Heave energy balance, 1 kHz                                                        | Energy lost equals suspension and tire damper work                             | 0.5 % of initial energy | **3.7 %, missed** (see below)                                        |
| Convergence, 500 Hz to 2 kHz against 16 kHz, hop excited                           | Both masses stepped at first order                                             | order 0.85 to 1.15      | 1.00 to 1.01 (body), 1.03 to 1.08 (wheels)                           |
| Static settle, default car with 40 kg wheels                                       | Same ride height and wheel loads as the massless strut                         | 1e-9 m, 1e-6 N          | pass                                                                 |
| 1 kg wheel on a 2.5 MN/m tire against the massless strut                           | The massless strut                                                             | 1 %                     | heave 0.67 %, step-steer yaw rate 0.13 %                             |
| External host, 3 s of steer and throttle at a 60 Hz host step                      | Impulse plus gravity on the whole mass equals the velocity change              | 1e-9 m/s                | pass                                                                 |
| Timestep grid corners, 250–2000 Hz × 30–240 Hz                                     | Same thresholds as the massless default car                                    | 0.01 deg/g, 0.5 %       | 0.0007 deg/g, 0.17 %                                                 |
| Open-wheeler preset on a 40 m skidpad, 250 Hz against 1 kHz                        | The same car at its own substep rate                                           | 0.01 deg/g              | pass                                                                 |
| Beam heave: both axles solid, beam roll inertia 0.6 of lumped, 5 mm drop           | The same two-mass quarter car                                                  | 2 % of the drop         | body 0.72 %, beams 1.27 %                                            |
| Beam roll, body held, 5 mm each way at the ends, 0.5 s at 1 kHz                    | One damped oscillator: `I_a`, `(k_s + k_t + 2 k_bar) t²/2`, `(c_s + c_t) t²/2` | 3 % of the release      | 1.30 % (inertia at the wheels, 13.3 Hz), 1.33 % (0.6 of it, 17.1 Hz) |
| Kart and pickup presets (solid rear beams) on a 40 m skidpad, 250 Hz against 1 kHz | The same car at its own substep rate                                           | 0.01 deg/g              | pass                                                                 |
| Snapshot, restore and continue                                                     | Bit-identical to the uninterrupted run                                         | exact                   | pass                                                                 |

**Two tolerances set before the run were missed, both by integration
error, not by the model.**

- **Rig phase at 2 kHz.** Both masses are stepped at first order, which lags
  each response by about one substep. At 2 kHz, the top of the supported
  range, the tire-load phase lag reaches 3.15° at 14 Hz and 4.75° at 25 Hz;
  the gains are all within 1.9 %. At 4 kHz the lags halve (2.37° at 25 Hz),
  which is what a first-order error does, so the test runs the rig at 4 kHz
  and the convergence test covers the integration error itself.
- **Energy.** The implicit wheel step damps the hop numerically by about
  `ω·dt / 2`, roughly 0.04 at 1 kHz on top of the hop's physical damping
  ratio of 0.45. The 5 mm drop of body and wheels puts nearly all of the
  initial energy in the tires, so the residual is 3.7 % at 1 kHz and 1.9 % at
  2 kHz. The test now checks that it stays under 4 % at 1 kHz and halves
  with the substep. A trapezoidal step cut it to 0.84 % but is not L-stable;
  ADR-0028 says why backward Euler was kept.

**The massless limit is checked with anti-roll bars on.** Without them the
textbook car rolls 5.7° in the step steer. At that angle the two models map
the strut force onto the tire load differently (the massless strut takes
`F cos φ`, the wheel on its strut `F / cos φ`), which moves the transient
yaw rate by 1.7 % whatever the wheel's mass. With the default bars the car
rolls 2.8° and the difference falls to 0.13 %.

**The tests catch real errors.** Scaling the tire spring force by 1.05
fails the rig, the free response, the energy check, the static settle and
the external-host check. Leaving the wheels' mass out of the corner forces
(dividing by the whole mass instead of the sprung mass) fails the free
response, the energy check, the static settle and the external-host check.
Both mutations were reverted.

**Light bodies in roll (added with the presets).** The first version gave
each wheel only the body's heave, so in roll and pitch the wheels moved
with the body without their own inertia, and each strut was stepped
against the wheel's mass alone. The quarter-car checks above are pure
heave and could not see it. Turning the option on in the presets did: the
open-wheeler, whose wheels carry more than half of its 90 kg·m² roll
inertia, hopped its wheels off the ground at 250 Hz and its understeer
gradient moved from 0.64 to 1.44 deg/g, and the hatchback did not quite
come to rest after its locked-wheel stop. Each wheel now takes its own
corner's acceleration from the sprung body's heave, roll and pitch (the
whole car's mass and inertias less the wheels' share), and each strut is
stepped against the reduced mass of its wheel and that corner. Either
change alone passes the skidpad check; with both removed it fails. The heave results above moved by at most a quarter of a percentage point.

**Solid axles (added with the beam).** A solid axle's beam is checked in
heave against the same quarter car, since a beam heaves as its two wheels'
mass, and in roll with the body held against the closed-form damped
oscillator about its own centre. Treating the beam's roll inertia as its
mass at the wheels whatever the definition says fails the roll check at
0.6 of that inertia by 14 % of the release.
