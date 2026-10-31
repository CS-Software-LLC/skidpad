---
"@skidpad/core": minor
"@skidpad/presets": minor
---

- core: the feel tire has a `longitudinalFrictionRatio` (default 1), the peak braking and traction friction as a multiple of `peakFriction`, which then sets the cornering peak only (ADR-0037). Definitions without it run as before.
- physics: presets: the hatchback, crossover, pickup and sports car set `longitudinalFrictionRatio` (1.12, 1.08, 1.07, 1.05) and the hatchback's front brakes go from 3000 to 3400 N·m, so their 100–0 km/h ABS stops land on their `dataSheet` targets (38.3, 37.2, 44.1 and 33.9 m, were 42.6, 40.1, 47.1 and 35.5 m) while their skidpad figures stay put. Stops on wet, gravel, snow and ice shorten in proportion, and traction-limited launches are slightly quicker.
