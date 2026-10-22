# Magic Formula against Pacejka

|           |                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------ |
| Date      | 2026-10-22                                                                                                   |
| Reference | H. B. Pacejka, _Tire and Vehicle Dynamics_, 2nd ed. (2006), §4.3.1 and eq. 4.E9 to 4.E78                     |
| Skidpad   | `MagicFormulaParams::eval` at this commit                                                                    |
| Harness   | [`crates/skidpad-core/tests/magic_formula_tests.rs`](../../crates/skidpad-core/tests/magic_formula_tests.rs) |

The Chrono Sedan report found that Chrono's `ChPac02Tire` departs from
Pacejka's equations, so Chrono can't be the reference for the tire. These
tests check skidpad's Magic Formula against the book directly, in two parts:

1. **Closed-form properties** (this commit). Pacejka's equations fix
   several values exactly: the peak, the slope at the origin, the sliding
   asymptote, where the peak sits, how the cornering stiffness varies with
   load and camber, and the combined-slip weights. The test writes each one
   out from the book and compares it with what the code returns.
2. **The book's worked example** (to follow). Appendix 3, Table A3.1, lists
   a full parameter set for a passenger tire, and chapter 4 plots curves
   computed from it. That set will become a fixture, the closed-form checks
   will run on it too, and the code's curves will be compared with points
   read off the book's figures.

## Parameter set

The closed-form checks run on `tests/fixtures/synthetic_passenger.tir` with
the shift terms (`PHX*`, `PVX*`, `PHY*`, `PVY*`, `QHZ*`, `RHX1`, `RHY*`) set
to zero, so each characteristic value reads straight off the curve. Every
check sweeps the load over 0.5, 1, 1.5 and 2 times `F'z0`.

## Results

Tolerances were set before the first run, from the numerics of each check:
a central difference with step 1e-5 is good to about 1e-8, a golden-section
search finds a peak's value to round-off but its location only to about
1e-8, and `κ = 10⁶` leaves the asymptote's arctangent about 1e-7 short of
`π/2`.

| Check                                    | Pacejka                                                         | Tolerance  | Worst result   |
| ---------------------------------------- | --------------------------------------------------------------- | ---------- | -------------- |
| Slope at the origin, `Fx(κ)` and `Fy(α)` | `BCD = Kxκ` (4.E15), `Kyα` (4.E25)                              | 1e-6       | 1.6e-8         |
| Peak force                               | `D = (PD1 + PD2 dfz) Fz`                                        | 1e-9       | 1.1e-16        |
| Peak slip                                | Root of `Bx − E(Bx − atan Bx) = tan(π/2C)`                      | 1e-5       | 1.8e-8         |
| Sliding force at `κ = 10⁶`               | `D sin(πC/2)`                                                   | 1e-5       | 3.1e-7         |
| Cornering stiffness against load         | Peaks at `Fz = PKY2 F'z0` with value `PKY1 F'z0`                | 1e-4, 1e-6 | 9.6e-9, 2.1e-9 |
| Camber at ±0.02 and ±0.06 rad            | `Kyα` scaled by `1 − PKY3 \|γ\|`                                | 1e-6       | 4.5e-9         |
| Scaling factors and surface grip         | `λμy` and grip scale the peak only; `λKy` scales the slope only | 1e-9, 1e-6 | 2.6e-9         |
| Combined slip, 6 × 6 grid of `κ` and `α` | `Fx = Gxα Fx0`, `Fy = Gyκ Fy0 + SVyκ` (4.E50 to 4.E67)          | 1e-9       | 0              |
| Pneumatic trail at zero slip             | `Dt = Fz (QDZ1 + QDZ2 dfz) R0 / F'z0` (4.E42)                   | 1e-12      | 2.2e-16        |
| Aligning stiffness                       | `−Dt Kyα`, with no slope from `Mzr`                             | 1e-6       | 1.2e-10        |

All residuals are numerical error. The code matches the equations as written.

## Notes

**The tests catch real errors.** Each of these mutations of
`magic_formula.rs` fails at least one check, and each was reverted:
scaling `Gxα` by 1.001, dropping the absolute value on camber in `Kyα`,
dividing the trail by `Fz` instead of `F'z0`, and scaling `Cy` by 1.0001.

**What this does not cover.** These checks pin the equations, not their
parameters. A tire fitted wrongly, or a `.tir` file read with the wrong sign
convention, would still pass. The book comparison in part 2 is what ties the
code to published numbers. Overturning and rolling resistance moments are
single algebraic lines and are not checked here.
