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

## Alternatives considered

- **Piecewise linear / cubic "arcade" curves.** Simple but discontinuous
  slope at the knee shows up as a force-feedback artifact. Rejected.
- **Expose raw B, C, D, E.** Not tunable by feel. Rejected; available through
  the Magic Formula model anyway.

## Consequences

- The feel model and the Magic Formula model share a curve-shape function and
  a combined-slip interface, so everything downstream is model-agnostic.
- Unit tests check peak location, peak value, symmetry, and that combined
  slip never exceeds the friction circle.
