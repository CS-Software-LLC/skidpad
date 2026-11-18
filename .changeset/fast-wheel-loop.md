---
"@skidpad/input": patch
---

- input: `LogitechWebHidSink.update()` without playout now sends one report at a time and the newest level next, so a host that steps faster than the wheel answers (a G PRO takes 200 reports a second) no longer stacks reports up behind one another.
- sandbox: **Fast wheel loop** (on by default): while a force-feedback wheel is connected the simulation steps at 240 Hz from a timer, reads the wheel and sends its torque every step, with no playout. About halves the delay around the rim (40 ms to 20 ms on a G PRO). Lap timing, the ghost and the telemetry recorder stay at 60 Hz.
- physics: no simulated behaviour changes.
