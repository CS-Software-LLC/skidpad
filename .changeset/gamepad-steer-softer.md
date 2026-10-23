---
"@skidpad/input": minor
---

Gamepad steering is gentler by default. `GamepadInput` now asks for 75 % of full lock at full stick (`steerSensitivity`, also a live property), uses a square response curve (`steerExponent` default 2, was 1.5), and rate limits the steering output to 5 lock fractions per second (`steerRate`, `Infinity` for off) so a flicked stick no longer snaps the front wheels across in one frame. `map()` and `poll()` take an optional `dt` (default 1/60 s). Wheels, keyboard and touch are unchanged.
