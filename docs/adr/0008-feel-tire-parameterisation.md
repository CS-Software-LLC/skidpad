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

- computes `σx` and `σy` from the transient slips, with the slip ratio
  mirrored by the direction of travel so that braking in reverse behaves like
  braking forward (theoretical slip assumes forward rolling);
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

## Alternatives considered

- **Piecewise linear / cubic "arcade" curves.** Simple but discontinuous
  slope at the knee shows up as a force-feedback artifact. Rejected.
- **Expose raw B, C, D, E.** Not tunable by feel. Rejected; available through
  the Magic Formula model anyway.

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
