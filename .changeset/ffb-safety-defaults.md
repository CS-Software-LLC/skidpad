---
"@skidpad/input": minor
---

input: safer force-feedback defaults. The Logitech sink caps every level at `maxOutput` (default 0.4 of the device's peak, about 4.4 N·m on a G PRO; `maxTorque` now reports the capped torque and `peakTorque` the device's), `FfbScaler` defaults to a gain of 0.5 and a rate limit of 5 full scales per second, and a runaway guard latches the output at zero when the hand wheel moves away from the centre faster than 10 rad/s under force, until `scaler.rearm()`. Pass the hand-wheel angle as `ffbFrameFromTelemetry`'s new third argument to enable the guard. The sink also zeroes the force when the page is hidden or closed and when updates stop for 0.25 s. The HID++ constant force's sign is flipped to match a G PRO on hardware, and the test pulse is gentler and bypasses the scaler.
