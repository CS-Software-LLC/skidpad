---
"@skidpad/input": minor
---

- input: `LogitechWebHidSink.measureDamper()` measures the firmware damper's units with the hands off. It spins the rim at three constant torques with the damper at a known coefficient, then `fitDamper` fits `T = c·ω + f` for the damping, the friction and the sink's `damperRate`. The sandbox's wheel panel has a "Measure damping" button, and it remembers the result in this browser.
