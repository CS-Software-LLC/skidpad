---
"@skidpad/input": minor
---

- Force feedback: `LogitechWebHidSink` now sends the definition's `steering.columnFriction` and `steering.columnDamping` to the wheel's own friction and damper effects over HID++ (they were downloaded at zero and never updated, which left the wheel free around the centre). Both scale with `gain` and a new `columnScale` option (default 1), are capped at `maxOutput` by the effect saturation, are sent only when they change, and stay on when the runaway guard or the watchdog cuts the constant force. A new `damperRate` option (default 10 rad/s, [VERIFY] on hardware) sets the hand-wheel rate of full damper output. `columnEffects()` exposes the mapping. The classic protocol does not send them yet.
