---
"@skidpad/core": minor
"@skidpad/presets": minor
---

- physics: solid axles take unsprung mass (ADR-0028). The two wheels' mass becomes one beam that heaves and rolls, with an optional `suspension.beamRollInertia` (kg·m², default: the mass at the wheels) that sets its roll (tramp) frequency apart from its hop. A beam with mass stands its wheels square to the line through its hubs. Validation takes the beam's roll inertia into the body's tenth.
- physics: the kart and pickup presets' solid rears now carry beams with mass. The pickup's understeer gradient returns to 0.93 deg/g (0.86 with only the front massive) and the kart's to −0.16; step-steer roll grows on both. The kart spins in the locked-wheel stop on snow again. The other four presets are unchanged.
