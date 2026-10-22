---
"@skidpad/core": minor
---

- physics: the Magic Formula tire takes Pacejka's lateral slip `α* = tan α` (eq. 4.E3) instead of the slip angle itself, and the aligning moment's combined-slip equivalent slips take the matching `α*` form. Lateral force moves by at most about 0.2 % and the aligning moment by up to about 1.6 % of its peak at 15° of slip; the feel tire is unchanged. See `docs/validation/magic-formula.md`.
