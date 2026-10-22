# Magic Formula against Pacejka

|           |                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------ |
| Date      | 2026-10-22                                                                                                   |
| Reference | H. B. Pacejka, _Tire and Vehicle Dynamics_, 2nd ed. (2006), §4.3.1 and eq. 4.E9 to 4.E78                     |
| Skidpad   | `MagicFormulaParams::eval` at this commit                                                                    |
| Harness   | [`crates/skidpad-core/tests/magic_formula_tests.rs`](../../crates/skidpad-core/tests/magic_formula_tests.rs) |

The Chrono Sedan report found that Chrono's `ChPac02Tire` departs from
Pacejka's equations, so Chrono can't be the reference for the tire. These
tests check skidpad's Magic Formula against the book's equations directly,
in two ways:

1. **Closed-form properties.** The equations fix several values exactly:
   the peak, the slope at the origin, the sliding asymptote, where the peak
   sits, how the cornering stiffness varies with load and camber, and the
   combined-slip weights. The test writes each one out from the book and
   compares it with what the code returns.
2. **Every term at once.** The test writes out the pure-slip, combined-slip
   and aligning-moment equations in full and compares them with the code on
   a tire that has every shift term switched on.

The book's own worked example (Table A3.1 of the 3rd edition) is not in the
repository. Its values may only enter from a copy that permits it, typed in
by hand as numbers with a citation.

## Parameter sets

Two sets, both built from `tests/fixtures/synthetic_passenger.tir`:

- **synthetic**: the fixture with the shift terms (`PHX*`, `PVX*`, `PHY*`,
  `PVY*`, `QHZ*`, `RHX1`, `RHY*`) set to zero, so each characteristic value
  reads straight off the curve.
- **shifted**: the fixture with every shift term on, `PKY4 = 2.05`, and a
  non-zero residual moment and `Fx` arm in `Mz`. The values are made up, at
  a passenger tire's order of magnitude.

The closed-form checks run on both, with the shifts zeroed. The every-term
check runs **shifted** as is. Every check sweeps the load over 0.5, 1, 1.5
and 2 times `F'z0`.

## PKY4

MF 6.x files carry `PKY4`, the curvature of the cornering stiffness against
load, where MF 5.2 fixes it at 2. Skidpad now reads it, with a default of 2,
so MF 5.2 files run exactly as before. A 6.x tire with `PKY4` slightly off 2
was previously evaluated as if it were 2, an error of order `(PKY4 − 2)` in
its cornering stiffness. Fixing `PKY4` back at 2 fails six of the checks.

## Results

Tolerances were set before the first run, from the numerics of each check:
a central difference with step 1e-5 is good to about 1e-8, a golden-section
search finds a peak's value to round-off but its location only to about
1e-8, and `κ = 10⁶` leaves the asymptote's arctangent about 1e-7 short of
`π/2`. The worst result is over both sets.

| Check                                             | Pacejka                                                         | Tolerance    | Worst result   |
| ------------------------------------------------- | --------------------------------------------------------------- | ------------ | -------------- |
| Slope at the origin, `Fx(κ)` and `Fy(α)`          | `BCD = Kxκ` (4.E15), `Kyα` (4.E25)                              | 1e-6         | 1.7e-8         |
| Peak force                                        | `D = (PD1 + PD2 dfz) Fz`                                        | 1e-9         | 1.1e-16        |
| Peak slip                                         | Root of `Bx − E(Bx − atan Bx) = tan(π/2C)`                      | 1e-5         | 1.8e-8         |
| Sliding force at `κ = 10⁶`                        | `D sin(πC/2)`                                                   | 1e-5         | 3.1e-7         |
| Cornering stiffness against load                  | Peaks at `Fz = PKY2 F'z0 tan(π/2 PKY4)` with value `PKY1 F'z0`  | 1e-4, 1e-6   | 2.5e-8, 2.3e-9 |
| Camber at ±0.02 and ±0.06 rad                     | `Kyα` scaled by `1 − PKY3 \|γ\|`                                | 1e-6         | 4.6e-9         |
| Scaling factors and surface grip                  | `λμy` and grip scale the peak only; `λKy` scales the slope only | 1e-9, 1e-6   | 2.6e-9         |
| Combined slip, 6 × 6 grid of `κ` and `α`          | `Fx = Gxα Fx0`, `Fy = Gyκ Fy0 + SVyκ` (4.E50 to 4.E67)          | 1e-9         | 0              |
| Pneumatic trail at zero slip                      | `Dt = Fz (QDZ1 + QDZ2 dfz) R0 / F'z0` (4.E42)                   | 1e-12        | 2.2e-16        |
| Aligning stiffness                                | `−Dt Kyα`, with no slope from `Mzr`                             | 1e-6         | 1.2e-10        |
| Every term, `Fx` and `Fy`, 9 × 9 grid of `κ`, `α` | The full equations at zero camber                               | 1e-9 `Fz`    | 1.3e-16, 0     |
| Every term, `Mz` at `κ = 0`                       | The same                                                        | 1e-9 `Fz R0` | 7.8e-20        |

All residuals are numerical error. Given the same slip input, the code
computes the book's equations exactly.

## Findings

**Skidpad feeds the formula `α`, where the book uses `tan α`.** Pacejka
defines the lateral slip input as `α* = tan α · sgn Vcx`, and every lateral
equation takes `α*`. The vehicle models pass the tire `atan(v / σy)`, a true
angle, and `eval` uses it as `α*`. The two agree at small slip angles and
part as the angle grows. For the synthetic tire (no shifts zeroed):

| Slip angle | `Fy` gap, 4.5 kN | `Fy` gap, 9 kN | `Mz` gap as a share of its peak, 9 kN |
| ---------- | ---------------- | -------------- | ------------------------------------- |
| 4°         | 0.08 %           | 0.12 %         | under 0.1 %                           |
| 6°         | 0.07 %           | 0.17 %         | 0.2 %                                 |
| 10°        | 0.05 %           | 0.09 %         | 1.0 %                                 |
| 15°        | 0.21 %           | 0.15 %         | 1.6 %                                 |

The force gap is small. The aligning-moment gap is larger because `Mz`
falls steeply past its peak, so a small shift in slip moves it a lot. The
tests feed both sides the same slip, so they pin the equations and leave
this choice to be settled on its own.

**Camber is MF 5.2's.** MF 6.x restructures the camber terms of `Fy` and
`Mz` (camber stiffness `PKY6`, `PKY7`; `PHY3` dropped). Skidpad implements
5.2's, so given a 6.x file it reads `PKY3`, `PVY3`, `PVY4`, `QBZ4`, `QDZ3`,
`QDZ8` and `QDZ9` with their MF 5.2 meanings and ignores `PKY6` and `PKY7`
with a warning. Its camber thrust will then not be the one the file
intends.

**Also outside these checks:** inflation pressure, turn slip, the
overturning and rolling-resistance moments, and the aligning moment under
combined slip, where the editions write the equivalent slip angle
differently.

**The tests catch real errors.** Each of these mutations of
`magic_formula.rs` fails at least one check, and each was reverted:
scaling `Gxα` by 1.001, dropping the absolute value on camber in `Kyα`,
dividing the trail by `Fz` instead of `F'z0`, scaling `Cy` by 1.0001, and
fixing `PKY4` at 2.

**What this does not cover.** These checks pin the equations, not the
tire. A tire fitted wrongly would still pass.
