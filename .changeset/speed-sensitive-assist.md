---
"@skidpad/core": minor
"@skidpad/presets": minor
---

- core: speed-sensitive power assist (ADR-0034). `steering.powerAssistAtSpeed`, `powerAssistFadeStart` and `powerAssistFadeEnd` (default 0, off) fade the assist fraction linearly with road speed. It acts at the hand wheel only, so motion and hashes are unchanged.
- physics: presets: the hatchback, crossover, pickup and sports car fade from full assist at 4 m/s to about 60 % of it at 28 m/s, so `SteeringTorque` grows at speed. Their motion does not change.
