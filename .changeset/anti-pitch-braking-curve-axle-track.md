---
"@skidpad/core": minor
---

- physics: anti-dive and anti-squat (ADR-0018). `suspension.antiBrake` and `suspension.antiDrive`, fractions of the load transfer each axle's braking or driving force causes that its links carry straight to the tires, default 0, bounded at ±2. New telemetry `PitchLinkLoad_F` and `PitchLinkLoad_R`. Snapshot format version 4: the previous substep's axle longitudinal forces are part of the state, so state hashes change; the golden scripted-drive hashes are regenerated and no other validation result moves.
- physics: measured engine braking (ADR-0011 amendment). `powerUnit.engineBrakingCurve`, `[rpm, N·m]` drag points that replace the `engineBrakingIdle`–`engineBrakingRedline` line when given.
- `axles[].trackWidth`: an axle's own track, 0 (default) for `chassis.trackWidth`. The four-wheel model, roll-centre transfer, Ackermann geometry, lane-change course and sandbox use it.
