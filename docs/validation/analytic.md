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
