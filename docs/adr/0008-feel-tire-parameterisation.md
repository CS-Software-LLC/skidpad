# ADR-0008: Feel tire model parameterisation

- Status: Accepted
- Date: 2026-10-01

## Context

Most users will never see a `.tir` file. They need a tire they can tune by
feel: "more grip", "sharper breakaway", "more progressive". The curve still has
to behave like a tire (linear region, peak, falloff to a sliding value) and the
parameters must map to things people can reason about.

## Decision

The feel model uses the Magic Formula curve shape
`y = D sin(C atan(B x − E (B x − atan(B x))))` (Bakker, Nyborg, Pacejka, SAE 870421) because it is the best-known tire curve shape and is published, but it
is parameterised by:

| Parameter                        | Meaning                                                            | Units              |
| -------------------------------- | ------------------------------------------------------------------ | ------------------ |
| `peakFriction`                   | Peak friction coefficient at the nominal load                      | –                  |
| `peakSlipRatio`, `peakSlipAngle` | Where the longitudinal and lateral peaks occur                     | –, deg             |
| `stiffness` (per axis)           | Initial slope, normalised by load (`C_α / F_z`)                    | 1/rad, 1/unit slip |
| `falloff`                        | Sliding friction as a fraction of peak friction                    | –                  |
| `loadSensitivity`                | Fractional drop in peak friction per unit of `(F_z − F_z0) / F_z0` | –                  |
| `nominalLoad`                    | Load at which the friction parameters are quoted                   | N                  |
| `camberStiffness`                | Lateral force per radian of camber, normalised by load             | 1/rad              |
| `relaxationLength` (per axis)    | Transient slip relaxation length                                   | m                  |
| `pneumaticTrail`                 | Trail at zero slip, from which the aligning moment is built        | m                  |
| `rollingResistance`              | Rolling resistance coefficient                                     | –                  |

`C` is derived from `falloff` (`C = 2 − (2/π) asin(falloff)`), `B` from the
stiffness, and `E` from the peak location, with `E` clamped to at most 1 so
the curve is always well behaved. Combined slip uses the resultant-slip method:
normalise each slip by its peak location, evaluate each curve at the resultant
normalised slip, and scale by direction cosines (Milliken & Milliken, ch. 2).

### Amendment A: theoretical slips in the combined-slip resultant

The original resultant combined the slip ratio `κ` and the slip angle `α`
directly. That is blind to the braking/driving asymmetry of a real tire. The
slips that combine in Pacejka's brush-model derivation are the _theoretical_
slips `σx = κ / (1 + κ)` and `σy = tan α / (1 + κ)` (Pacejka, _Tire and
Vehicle Dynamics_, 3rd ed., ch. 3, brush model; **[VERIFY]** against the
exact equation numbers of the edition at hand). Under braking `κ < 0`, so the
`1 + κ` denominator inflates both theoretical slips and the tire is further
along its curves than a driven tire at the same `|κ|` and `α`. The feel model
now:

- computes `σx = κ / (1 + s·κ)` and `σy = tan α / (1 + s·κ)` from the
  transient slips, with `s` the direction of travel, so that braking in
  reverse behaves like braking forward (theoretical slip assumes forward
  rolling). `s` is `Vx / lowSpeedFloor` clamped to ±1 rather than a hard
  sign: a parked car's velocity crosses zero endlessly, and a hard switch
  stepped the combined-slip force by a fraction of a percent at each
  crossing, enough to sustain a 3 Hz limit cycle on a cross slope (found by
  the ADR-0010 scenarios). At `s = 0` the theoretical slips are the plain
  slips, which is symmetric, and at `|Vx| ≥ lowSpeedFloor` nothing changes;
- normalises them by sign-specific peak theoretical slips,
  `σx,peak = κp / (1 + κp)` driving and `κp / (1 − κp)` braking, and
  `σy,peak = tan αp`, so `peakSlipRatio` marks the peak in both drive and
  brake;
- takes the resultant `s` of the normalised slips and keeps the direction
  cosines in normalised space;
- evaluates each pure-slip curve at the slip whose own normalised theoretical
  slip equals `s`: `|κ*| = s·σx,peak / (1 ∓ s·σx,peak)` and
  `α* = atan(s · tan αp)`. For pure slip that is `κ` and `|α|` themselves, so
  pure braking, pure drive and pure cornering reproduce the old curves to
  better than `10^-9` relative and the straight-line results do not move.
  Evaluating at `s·κp` instead would silently scale the initial longitudinal
  stiffness by `1 ± κp` (about 12 % with the defaults).

Guards, all covered by tests: the denominator `1 + κ` is floored at
`10^-9` so a locked wheel (`κ = −1`) or a wheel spun backwards is fully
sliding but finite (both curves are at their asymptotes long before the
floor binds, and the squared resultant stays far from overflow); `1 − σ*`
is floored at `10^-3` so a driving `κ*` stays finite when a huge slip angle
pushes the resultant theoretical slip past one; the slip angle fed to `tan`
is clamped to ±1.5 rad, since the camber shift can push the effective angle
past 90°. Cost: two divisions, one `tan` and one `atan` per evaluation on top
of the twenty libm calls the evaluation already made (22 in total).

**What the model does, measured with the default tire.** The brush model's
asymmetry is not "less lateral force under braking" in the linear region. At
the same slip angle below the peak a braked tire carries a few percent
_more_ lateral force than a driven one (the inflated `σy` puts it further up
its curve), and its lateral peak sits at a smaller slip angle: with
`κ = ∓0.05` the lateral peak is at `1.29 αp` braking against `1.57 αp`
driving, so the braked tire saturates laterally sooner and falls off sooner
past the limit. The sign-specific normalisation also gives the braked tire a
more lateral share of the friction budget at equal `|κ|`. The acceptance
criterion in the change request (a smaller `|Fy|` under braking at `0.7 αp`)
is the opposite of what the cited model does, so the test asserts the brush
behaviour instead.

**Direction error at full sliding [DERIVED].** With direction cosines taken
in normalised space, a locked wheel's force differs in direction from the
slide velocity by the ratio `r = σx,peak,brake / tan αp` between the two
normalisations; the worst case over all slide angles is
`atan(√r) − atan(1/√r)`. With the defaults (`κp = 0.12`, `αp = 7°`) that is
3.0°, measured 2.7°; the previous resultant method had the same error with
`r = κp / αp`, which happened to be 0.98 for the defaults. For tires whose
peaks differ more it grows fast: `κp = 0.08` with `αp = 10°` gives about 20°.
Proposed fix, not applied: blend the direction cosines from normalised space
(which gives the right initial stiffness on each axis) toward physical
theoretical-slip space `(σx, σy)`, which is exactly the slip-velocity
direction, with a weight that rises from 0 at the peak to 1 at full sliding.
Adopt it if a preset ever needs widely different peaks.

### Amendment B: a trail that crosses zero, and combined-slip trail

The original trail was `t0 · clamp(1 − (α/αp)², 0, 1)`: never negative, and
blind to longitudinal slip. The sandbox's steering torque is the front
aligning moment over the steering ratio, so that curve was the force
feedback, and it never gave the "going light" warning a wheel driver reads.
The published reference shape is the Magic Formula cosine trail
`Dt · cos(Ct · atan(Bt · α_t,eq − Et · (…)))` (Pacejka ch. 4, eq. 4.E42
**[VERIFY]**), which falls from its zero-slip value, crosses zero near the
lateral peak, dips negative and returns toward zero; Milliken & Milliken
ch. 2 describe the same shape against slip angle, and `magic_formula.rs`
already implements it. The feel model now uses a libm-free curve with the
same features, which is this project's own form, not a published law
**[DERIVED]**:

```text
trail = t0 · (1 − x²) / (1 + k · x⁴),   x = α_t,eq / (trailZeroCrossing · αp)
```

- `pneumaticTrail` (`t0`) keeps its meaning as the trail at zero slip, so
  `static_trail` and the "linear theory with trail" understeer column are
  unchanged.
- `trailZeroCrossing` (default 1.0) is the equivalent slip angle, in
  multiples of `peakSlipAngle`, at which the trail crosses zero. Below it
  the curve is close to the old quadratic.
- `trailReversal` (default 0.1) is the depth of the negative lobe as a
  fraction of `t0`. The deepest point of `(1 − x²)/(1 + k x⁴)` is at
  `x² = 1 + √(1 + 1/k)` with value `−(√(1 + 1/k) − 1)/2`, so a depth `D`
  needs `k = 1 / (4 D (1 + D))` **[DERIVED]**, in closed form. Reference
  points: `k = 2 → 0.11`, `k = 1 → 0.21`, `k = 0.5 → 0.37` of `t0`. The
  depth is floored at 0.001 (a zero depth would make `k` infinite and
  collapse the curve) and capped at 0.5.
- Combined slip enters through the MF 5.2 equivalent slip angle
  `α_t,eq = sign(α) · √(α² + (Kx/Ky)² κ²)` (Pacejka 2nd ed. eq. 4.E77
  **[VERIFY]**), with `Kx` and `Ky` the stiffnesses the evaluation already
  computes; MF 6.1 uses an `atan(√(tan² α + …))` variant, which
  `magic_formula.rs` implements. Cost: one `sqrt`, no libm call. Braking or
  drive therefore shortens the trail and lightens the wheel.
- `fxMomentArm` (default 0, opt-in) adds the contact-patch shift of the
  longitudinal force, `Mz += s · Fx` with `s = fxMomentArm · (Fy / Fz0)`,
  the Magic Formula `SSZ2` term (eq. 4.E76 **[VERIFY]**) with `fxMomentArm`
  standing in for `R0 · SSZ2`, same sign convention.
- The residual torque `Mzr` and the `cos α` factor of the Magic Formula are
  left out of the feel model.

Measured with the default tire (crossing 1.0, reversal 0.1, so `k = 2.27`):
`Mz` peaks at 0.41 `αp` while `Fy` peaks at `αp`, `Mz` is zero at `αp`, and
its deepest value is about −18 % of its peak near 1.5 `αp`. A crossing of
1.2 moves the `Mz` peak to 0.47 `αp`. `TireOutput.trail` reports the signed
trail; the tire explorer's vertical range now reaches below zero to show
it. Steering lightens before grip runs out, and braking at a fixed slip
angle in the linear region lowers `|Mz|`, both tested in
`tire_aligning_moment_tests.rs` together with continuity of `Mz` and of its
slope over the slip plane.

Understeer validation moves only slightly, because the aligning moment
feeds the yaw balance: four-wheel gradients change by less than 0.01 deg/g
for every preset (the straight-line results do not move at all).

## Alternatives considered

- **Piecewise linear / cubic "arcade" curves.** Simple but discontinuous
  slope at the knee shows up as a force-feedback artifact. Rejected.
- **Expose raw B, C, D, E.** Not tunable by feel. Rejected; available through
  the Magic Formula model anyway.
- **Port the Magic Formula cosine trail into the feel model** (amendment
  B). Gives the published shape directly, but costs a `cos` and two `atan`
  per evaluation and its `Bt`, `Ct`, `Et` are not feel parameters. The
  rational curve has the same features for two intuitive knobs and no libm
  call. Rejected.

## Consequences

- The feel model and the Magic Formula model share a curve-shape function and
  a combined-slip interface, so everything downstream is model-agnostic.
- Unit tests check peak location, peak value, symmetry, and that combined
  slip never exceeds the friction circle. `tire_combined_slip_tests.rs`
  guards amendment A: pure slip unchanged in both directions of travel,
  the braking/driving asymmetry, the friction circle, the locked-wheel
  direction error, reverse symmetry and the guards.
- `peakSlipRatio` must be below 1 and `peakSlipAngleDeg` at most 45 for the
  sign-specific normalisation to be defined; both are validated.
