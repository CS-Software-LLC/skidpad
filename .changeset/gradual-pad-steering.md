---
"@skidpad/input": minor
---

Gamepad steering turns the wheel over time instead of capping the lock. Full stick asks for full lock again (`steerSensitivity` now defaults to 1, was 0.75), and the wheel winds toward the stick at `steerRate` (default 2 full locks a second, was 5; now a live property) and unwinds toward centre at the faster `steerReturnRate` (new, default 5). Wheels, keyboard and touch are unchanged.
