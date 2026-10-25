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

| Check                                              | Pacejka                                                         | Tolerance    | Worst result   |
| -------------------------------------------------- | --------------------------------------------------------------- | ------------ | -------------- |
| Slope at the origin, `Fx(κ)` and `Fy(α)`           | `BCD = Kxκ` (4.E15), `Kyα` (4.E25)                              | 1e-6         | 1.7e-8         |
| Peak force                                         | `D = (PD1 + PD2 dfz) Fz`                                        | 1e-9         | 1.1e-16        |
| Peak slip                                          | Root of `Bx − E(Bx − atan Bx) = tan(π/2C)`                      | 1e-5         | 1.8e-8         |
| Sliding force at `κ = 10⁶`                         | `D sin(πC/2)`                                                   | 1e-5         | 3.1e-7         |
| Cornering stiffness against load                   | Peaks at `Fz = PKY2 F'z0 tan(π/2 PKY4)` with value `PKY1 F'z0`  | 1e-4, 1e-6   | 2.5e-8, 2.3e-9 |
| Camber at ±0.02 and ±0.06 rad                      | `Kyα` scaled by `1 − PKY3 \|γ\|`                                | 1e-6         | 4.6e-9         |
| Scaling factors and surface grip                   | `λμy` and grip scale the peak only; `λKy` scales the slope only | 1e-9, 1e-6   | 2.6e-9         |
| Combined slip, 6 × 6 grid of `κ` and `α`           | `Fx = Gxα Fx0`, `Fy = Gyκ Fy0 + SVyκ` (4.E50 to 4.E67)          | 1e-9         | 0              |
| Pneumatic trail at zero slip                       | `Dt = Fz (QDZ1 + QDZ2 dfz) R0 / F'z0` (4.E42)                   | 1e-12        | 2.2e-16        |
| Aligning stiffness                                 | `−Dt Kyα`, with no slope from `Mzr`                             | 1e-6         | 1.2e-10        |
| Every term, `Fx` and `Fy`, 9 × 9 grid of `κ`, `α*` | The full equations at zero camber                               | 1e-9 `Fz`    | 1.3e-16, 0     |
| Every term, `Mz` at `κ = 0`                        | The same                                                        | 1e-9 `Fz R0` | 7.8e-20        |
| Slip input, ±2° to ±20°                            | `Fy`, `Mz` at `α* = tan α`                                      | 1e-9 `Fz`    | 0              |

All residuals are numerical error. The code computes the book's equations
exactly.

## Findings

**The formula is fed `tan α`, as in the book.** Pacejka defines the lateral
slip input as `α* = tan α · sgn Vcx` (eq. 4.E3), and every lateral equation
takes `α*`. The vehicle models pass the tire the angle `α = atan(v / σy)`.
Until 2026-10-22, `eval` used that angle as `α*`. It now takes `tan α`, and
the angle itself enters only through `cos α` in the aligning moment. The
equivalent slips of the aligning moment under combined slip (4.E77, 4.E78)
take the 3rd edition's `α*` form, `√(αt² + (Kxκ / Kyα)² κ²)`, which is
the same as before at `κ = 0`. A further check feeds `eval` the angle and
compares with the equations at `tan α`; it matches exactly.

The change was small. On the synthetic tire, before and after:

| Slip angle | `Fy` change, 4.5 kN | `Fy` change, 9 kN | `Mz` change as a share of its peak, 9 kN |
| ---------- | ------------------- | ----------------- | ---------------------------------------- |
| 4°         | 0.08 %              | 0.12 %            | under 0.1 %                              |
| 6°         | 0.07 %              | 0.17 %            | 0.2 %                                    |
| 10°        | 0.05 %              | 0.09 %            | 1.0 %                                    |
| 15°        | 0.21 %              | 0.15 %            | 1.6 %                                    |

The aligning moment moves more than the force because `Mz` falls steeply
past its peak, so a small shift in slip moves it a lot.

**Camber follows the file's version.** MF 6.x restructures the camber
terms of `Fy` and `Mz`. Until 2026-10-25 skidpad used MF 5.2's for every
file, so a 6.x file's `PKY3`, `PVY3`, `PVY4`, `QDZ3`, `QDZ8` and `QDZ9`
were read with their 5.2 meanings and `PKY6`, `PKY7` ignored. A 6.x tire's
camber thrust was then not the one the file intends. See
[MF 6.x camber](#mf-6x-camber) below.

**Also outside these checks:** inflation pressure, turn slip, the
overturning and rolling-resistance moments, and (for MF 5.2) the aligning
moment under combined slip.

**The tests catch real errors.** Each of these mutations of
`magic_formula.rs` fails at least one check, and each was reverted:
scaling `Gxα` by 1.001, dropping the absolute value on camber in `Kyα`,
dividing the trail by `Fz` instead of `F'z0`, scaling `Cy` by 1.0001,
fixing `PKY4` at 2, and feeding the formula `α` instead of `tan α`.

**What this does not cover.** These checks pin the equations, not the
tire. A tire fitted wrongly would still pass.

## MF 6.x camber

|           |                                                                                                                                                                                                                                     |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date      | 2026-10-25                                                                                                                                                                                                                          |
| Reference | Pacejka, _Tire and Vehicle Dynamics_, 3rd ed. (2012), §4.3.2; Besselink, Schmeitz and Pacejka, "An improved Magic Formula/Swift tyre model that can handle inflation pressure changes", _Vehicle System Dynamics_ 48, sup. 1 (2010) |
| Harness   | [`crates/skidpad-core/tests/magic_formula_mf6_tests.rs`](../../crates/skidpad-core/tests/magic_formula_mf6_tests.rs)                                                                                                                |

A file whose `FITTYP` is 61 or 62 now runs the MF 6.x camber equations;
with no `FITTYP`, a `PROPERTY_FILE_FORMAT` of `MF61` or `MF62` does the
same. Everything else (`PAC2002`, `FITTYP` 6, 21 or 52, no `FITTYP`) runs
MF 5.2 as before. The import warns about a non-zero key that belongs to
the other version (`PKY6` in a 5.2 file, `PHY3` in a 6.x file), since that
usually means `FITTYP` is wrong.

What changes in 6.x mode, without inflation pressure or turn slip:

- `γ* = sin γ` replaces `λγy γ` and `λγz γ` everywhere; `LGAY` and `LGAZ`
  have no effect, and `LKYC`, `LKZC` scale the camber stiffnesses instead.
- Camber thrust comes from an explicit camber stiffness
  `Kyγ0 = Fz (PKY6 + PKY7 dfz) λKyγ`. `SVyγ = Fz (PVY3 + PVY4 dfz) γ* λKyγ λμy`
  is its vertical part and `(Kyγ0 γ* − SVyγ) / Kyα` its horizontal shift,
  so `∂Fy/∂γ = Kyγ0` at zero slip whatever the split. `PHY3` is gone.
- `Kyα` peaks at `(PKY2 + PKY5 γ*²) F'z0 tan(π / 2 PKY4)`, and `PEY5 γ*²`
  enters `Ey`.
- Combined slip gains `RBX3 γ*²` in `Bxα` and `RBY4 γ*²` in `Byκ`.
- In `Mz`, `QBZ4` is gone, `QBZ6 γ*²` enters `Bt`, `QDZ3` takes `|γ*|`,
  and `Dr` gains `(QDZ10 + QDZ11 dfz) |γ*|` with `λKzγ`. The trail acts on
  `F'y = Gyκ Fy0` taken at `γ = 0`, with `Kyα` at `γ = 0` in `αt,eq`, so
  camber reaches the aligning moment through `Dr`.
- `Fx` and its camber term `PDX3` are unchanged. `Mx` stays MF 5.2's; the
  6.x overturning terms (`QSX4` onwards) are still ignored with a warning.

The checks run on the synthetic tire read as MF 6.1 with every 6.x camber
term on and made-up values at a passenger tire's order of magnitude. The
5.2-only keys are set too, so a leak would show.

| Check                                                 | Equations                                                         | Tolerance          |
| ----------------------------------------------------- | ----------------------------------------------------------------- | ------------------ |
| Camber stiffness at zero slip                         | `∂Fy/∂γ = Fz (PKY6 + PKY7 dfz) λKyγ`                              | 1e-6               |
| Camber stiffness against `PVY3` of −0.5, 0, 0.5       | unchanged                                                         | 1e-6               |
| `Kyα` at ±0.03, ±0.1 rad, and where it peaks          | `1 − PKY3 \|γ*\|`, peak at `(PKY2 + PKY5 γ*²) F'z0 tan(π/2 PKY4)` | 1e-6               |
| Camber moment stiffness at zero slip                  | `∂Mz/∂γ = Fz R0 (QDZ8 + QDZ9 dfz) λKzγ`                           | 1e-6               |
| 6.x at zero camber with no 6.x terms                  | equals 5.2                                                        | 1e-12 `Fz`         |
| Every term, 5 × 6 × 5 grid of `κ`, `α*`, `γ`, 4 loads | `Fx`, `Fy`, `Mz` written out in full, combined `Mz` included      | 1e-9 `Fz`, `Fz R0` |

All pass. The camber moment check zeroes `QDZ10` and `QDZ11`, whose odd
`|γ*| γ*` adds `h (QDZ10 + QDZ11 dfz)` to a central difference of step `h`.

MF 5.2 is unchanged bit for bit: over 375 points of load, slip and camber,
with every 5.2 camber term, `LGAY` and `LGAZ` off their defaults, a hash of
every output matches the previous core's.

Each of these mutations fails at least one check, and each was reverted:
`γ*` as `γ` instead of `sin γ`, the trail on the cambered side force, `Kyα`
of `αt,eq` with camber, dropping `PKY5`, `QDZ3` without the absolute value,
`SVyγ` without `λKyγ`, and dropping `RBX3`.

As with MF 5.2, these pin the equations, not a tire. No published 6.x tire
with its own reference curves is in the repository yet.
