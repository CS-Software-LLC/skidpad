---
"@skidpad/core": minor
---

- physics: static toe per axle (ADR-0017). `axles[].staticToeDeg`, degrees per wheel, positive toe-in, default 0, bounded at ±10. The four-wheel model adds it to each wheel's road-wheel angle, so `WheelSteer_*` includes it and `SteerAngle` does not; the single-track model ignores it. Definitions without it are unchanged, and so are the golden results.
