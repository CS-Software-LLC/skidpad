---
"@skidpad/core": minor
"@skidpad/input": minor
---

- core: `SteeringTorqueSlice0` … `SteeringTorqueSlice7`, the host step's steering torque in eight equal slices of time (ADR-0032). Telemetry only; state and determinism hashes are unchanged.
- input: `LogitechWebHidSink` can play the slices out between host steps (`playoutRate`, Hz, default 0 = off) through the new `TorquePlayout`; `FfbScaler.scale` is split into `watch` (the runaway guard, once per host step) and `shape`. `setRotation()` sets the wheel's rotation, clamped to the model's `maxRotationDeg` (1080° on the G PRO); `WheelInput.rotationDeg` follows it, and a car lock wider than the wheel is then reached at the wheel's end stop. `DIRECT_DRIVE_SCALER` holds the slew and smoothing suggested for a direct-drive base. All off by default until tried on a wheel.
