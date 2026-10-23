---
"@skidpad/core": minor
"@skidpad/presets": minor
---

- physics: the presets now carry unsprung mass (ADR-0028) on their independent axles, with tire vertical rates and damping; the kart's and the pickup's solid rears stay massless for now. Body roll in the step steer grows by 20 to 45 % (the tires now have vertical compliance), the pickup's understeer gradient falls from 0.94 to 0.86 deg/g and the kart's from −0.21 to −0.27, and the kart no longer spins in the locked-wheel stop on snow. Golden results, README tables and determinism laps are regenerated; see `docs/validation/unsprung-presets.md`.
- physics: with unsprung mass on, each wheel now takes its corner's acceleration from the body's heave, roll and pitch (the sprung inertias), and each strut is stepped against the reduced mass of its wheel and that corner. This fixes wheels hopping at a 250 Hz substep on light bodies such as the open-wheeler. Validation rejects unsprung mass that leaves the body less than a tenth of its roll or pitch inertia.
