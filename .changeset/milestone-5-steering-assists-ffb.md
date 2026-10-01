---
"@skidpad/core": minor
"@skidpad/input": minor
"@skidpad/presets": minor
"@skidpad/validate": minor
---

Milestone 5: steering geometry, assists, wheels and force feedback.

- physics: steering geometry (ADR-0012). `steering` gains `mechanicalTrail`, `scrubRadius`, `steeringArm`, `powerAssist`, `columnFriction`, `columnDamping` and `jackingRate`. The hand-wheel torque is now the kingpin torque of both steered wheels (aligning moment, mechanical trail on the lateral force, scrub radius on the longitudinal force) through the ratio and the assist, in the sign of the steer input; `RackForce` is new. Jacking moves the front contacts along their rays with steer so a kart's solid axle unloads its inner rear wheel. Vehicle motion is unchanged for `jackingRate: 0`; the presets get trail, scrub and assist values and the kart a jacking rate, so its results move.
- physics: an automatic now lifts the throttle while its clutch is open for a shift, so the engine falls toward the next gear's speed instead of dumping its inertia into the wheels on re-engagement. 0–100 km/h times move by a tenth; scripted-drive hashes and recorded laps change.
- Driving assists (ADR-0013), off by default and stateless inside the core: `assists.abs`, `assists.tractionControl`, `assists.stabilityControl` and `assists.steeringAssist`, with telemetry `AbsActivity`, `TcActivity`, `EscYawError`, `EscBrakeTorque`, `SteerAssistScale` and `ThrottleEffective`. The sandbox's speed-sensitive steering moved into the core. The validate tool reports the 100–0 km/h stop with the ABS beside the locked-wheel stop.
- `@skidpad/input`: axis calibration (`AxisCalibrator`, `calibrateCentred`, `calibratePedal`), wheel profiles stored as JSON (`WheelProfile`, `loadProfiles`, `saveProfiles`, built-in Logitech G PRO, G29/G923 and generic profiles), `WheelInput` over the Gamepad API with steering scaled by the car's lock and paddle shifting, `AxisFinder` for assigning controls by moving them, `TouchInput` on-screen controls, and force feedback: `FfbFrame`, `FfbSink`, `FfbScaler`, `ffbFrameFromTelemetry`, `GamepadRumbleSink`, and `LogitechWebHidSink` (HID++ 0x8123 for the G PRO / G923 / G920, classic seven-byte protocol for the G29 / G27 / G25) with a diagnostics log. Protocol constants are reconstructed from open-source drivers and marked [VERIFY] until tried on hardware. `clamp`, `Ramp` and friends moved to a `filters` module (re-exported).
- Sandbox: a Wheel setup panel (devices, assign and calibrate controls, connect force feedback, gain, test pulse, log, assists toggles); touch driving on the canvas.
