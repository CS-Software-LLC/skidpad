---
"@skidpad/core": minor
---

Feel tire: aligning moment that goes light at the limit (ADR-0008 amendment B).

- physics: the feel tire's pneumatic trail now follows `t0·(1 − x²)/(1 + k·x⁴)` on the combined equivalent slip angle, so it crosses zero at the lateral peak, dips negative past it and shortens under braking or drive. The aligning moment (and so the steering torque) peaks at about 0.41 of the peak slip angle, is zero at the peak and reverses by about a fifth of its peak past it, which is the "going light" cue. Understeer golden results move by less than 0.01 deg/g; the scripted-drive hashes change; the straight-line results do not.
- New feel-tire parameters, all with defaults: `trailZeroCrossing` (1.0, multiples of the peak slip angle), `trailReversal` (0.1 of `pneumaticTrail`) and `fxMomentArm` (0 m, the Magic Formula `SSZ2` contact-patch shift, opt-in). `TireOutput.trail` and the `Trail_*` telemetry channels can now be negative.
