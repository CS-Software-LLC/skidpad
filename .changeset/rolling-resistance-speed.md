---
"@skidpad/core": minor
"@skidpad/presets": minor
---

- core: the feel tire's rolling resistance can grow with speed. `rollingResistanceSpeed` (default 0) adds `rollingResistanceSpeed · |vx| / 16.7 m/s` to the coefficient, as the Magic Formula's QSY3 does; a coast-down shows it as the `B` term.
- physics: the sports car's tires have `rollingResistanceSpeed` 0.004, which puts its road load inside the EPA coast-down range of its class at 50 and 100 km/h (it was 13 % low at 100 km/h). Its understeer gradient moves from 0.71 to 0.72 deg/g. The other presets are unchanged.
