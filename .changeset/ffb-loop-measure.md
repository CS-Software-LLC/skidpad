---
"@skidpad/input": minor
---

- input: `LogitechWebHidSink` gains `forceTimeout` (seconds, default 0: off). With it set, every HID++ constant-force report carries that lifetime and renews it, so the wheel ends the force by itself when the page stops sending (paused at a breakpoint, hung or crashed), which the sink's own watchdog cannot catch.
- input: `sink.reportRate` is the constant-force reports the wheel took in the last second, and `sink.measureLoop(readAngleDeg)` measures, hands off, the report rate and round trip, the delay from asking for a torque to the page seeing its effect (`fitPulse`), how often the angle updates, the rim's inertia, and whether the firmware honours a force's lifetime (`timeoutExpires`, `timeoutRenews`).
- input: `WheelInput.readAngleDeg()` reads the hand-wheel angle from the browser afresh, without touching button state.
