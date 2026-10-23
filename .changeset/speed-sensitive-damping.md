---
"@skidpad/core": minor
"@skidpad/input": minor
"@skidpad/presets": minor
---

- core: speed-sensitive column damping (ADR-0033). `steering.columnDampingAtSpeed` and `steering.columnDampingSpeed` (default 0, off) raise the force-feedback column damping linearly with speed. The `ColumnDamping` channel reports the current value. The column is not simulated, so state and hashes are unchanged.
- input: `ffbFrameFromTelemetry` sends `ColumnDamping`. `LogitechWebHidSink` re-sends the damper only when it moves by more than about 5 %.
- presets: the hatchback, sports car, crossover, pickup and open-wheeler reach four times their parking damping by 20 m/s.
