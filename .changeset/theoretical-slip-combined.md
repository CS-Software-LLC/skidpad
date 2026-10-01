---
"@skidpad/core": minor
---

Feel tire: theoretical-slip combined slip (ADR-0008 amendment A).

- physics: the feel tire combines slips through the brush model's theoretical slips `σx = κ/(1+κ)` and `σy = tan α/(1+κ)` instead of the raw slip ratio and slip angle. Pure braking, pure drive and pure cornering are unchanged to better than 1e-9 relative, so the straight-line golden results stay; combined slip now has the braking/driving asymmetry of a real tire (a braked tire reaches its lateral peak at a smaller slip angle), reverse travel mirrors forward travel, and a locked wheel is fully sliding at any slip ratio at or below −1. Understeer golden results and the scripted-drive hashes move slightly.
- `peakSlipRatio` must now be below 1 and `peakSlipAngleDeg` at most 45; every shipped preset and the defaults already comply.
