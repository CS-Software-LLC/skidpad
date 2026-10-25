---
"@skidpad/input": minor
---

Gamepad steering asks for less lock as speed rises, so small corrections stay small at track speed. Set `GamepadInput.speed` (m/s) before each read; full stick then gives half lock at `steerSpeedHalf` (default 20 m/s, a live property, `Infinity` for off) and falls as `1 / (1 + (v / half)²)`. Left at speed 0 nothing changes. The default wind-on rate is now 4/3 full locks a second (0.75 s to full lock, was 0.5 s). Wheels, keyboard and touch are unchanged.
