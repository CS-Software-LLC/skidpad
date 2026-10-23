---
"@skidpad/core": minor
"@skidpad/input": minor
---

- core: force-feedback torque channels (ADR-0031). `SteeringTorqueMean` is the mean of `SteeringTorque` over the host step's substeps, and `SteerTorqueMz`, `SteerTorqueTrail`, `SteerTorqueScrub`, `SteerTorqueLift` and `SteerTorqueAssist` split `SteeringTorque` by source at the hand wheel. Telemetry only; state and determinism hashes are unchanged.
- input: `ffbFrameFromTelemetry` sends `SteeringTorqueMean` instead of the last substep's torque, which aliased anything above half the host rate. `FfbScaler` reports `requested`, `sent`, `lastClipped` and `peak`; `FfbSink` has an optional `scaler`.
