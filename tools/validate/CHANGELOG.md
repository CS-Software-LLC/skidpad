# @skidpad/validate

## 0.5.0

### Minor Changes

- c9afbb2: Milestone 5: steering geometry, assists, wheels and force feedback.

  - physics: steering geometry (ADR-0012). `steering` gains `mechanicalTrail`, `scrubRadius`, `steeringArm`, `powerAssist`, `columnFriction`, `columnDamping` and `jackingRate`. The hand-wheel torque is now the kingpin torque of both steered wheels (aligning moment, mechanical trail on the lateral force, scrub radius on the longitudinal force) through the ratio and the assist, in the sign of the steer input; `RackForce` is new. Jacking moves the front contacts along their rays with steer so a kart's solid axle unloads its inner rear wheel. Vehicle motion is unchanged for `jackingRate: 0`; the presets get trail, scrub and assist values and the kart a jacking rate, so its results move.
  - physics: an automatic now lifts the throttle while its clutch is open for a shift, so the engine falls toward the next gear's speed instead of dumping its inertia into the wheels on re-engagement. 0–100 km/h times move by a tenth; scripted-drive hashes and recorded laps change.
  - Driving assists (ADR-0013), off by default and stateless inside the core: `assists.abs`, `assists.tractionControl`, `assists.stabilityControl` and `assists.steeringAssist`, with telemetry `AbsActivity`, `TcActivity`, `EscYawError`, `EscBrakeTorque`, `SteerAssistScale` and `ThrottleEffective`. The sandbox's speed-sensitive steering moved into the core. The validate tool reports the 100–0 km/h stop with the ABS beside the locked-wheel stop.
  - `@skidpad/input`: axis calibration (`AxisCalibrator`, `calibrateCentred`, `calibratePedal`), wheel profiles stored as JSON (`WheelProfile`, `loadProfiles`, `saveProfiles`, built-in Logitech G PRO, G29/G923 and generic profiles), `WheelInput` over the Gamepad API with steering scaled by the car's lock and paddle shifting, `AxisFinder` for assigning controls by moving them, `TouchInput` on-screen controls, and force feedback: `FfbFrame`, `FfbSink`, `FfbScaler`, `ffbFrameFromTelemetry`, `GamepadRumbleSink`, and `LogitechWebHidSink` (HID++ 0x8123 for the G PRO / G923 / G920, classic seven-byte protocol for the G29 / G27 / G25) with a diagnostics log. Protocol constants are reconstructed from open-source drivers and marked [VERIFY] until tried on hardware. `clamp`, `Ramp` and friends moved to a `filters` module (re-exported).
  - Sandbox: a Wheel setup panel (devices, assign and calibrate controls, connect force feedback, gain, test pulse, log, assists toggles); touch driving on the canvas.

- 8502c19: Milestone 6: surfaces, aero lift, solid axles and roll centres, the full validation runner, reference vehicles, a tuning editor.

  - physics: surface table (ADR-0014). A world holds up to 16 surfaces (`grip`, `rollingResistance`, `drag`) set with `World.setSurfaces()`; wheel contacts index it through their `surfaceId` (the Rapier adapter's `surfaceId` option, or `World.setSurface()` for the built-in ground). Grip scales the tire's peak and sliding friction like the Magic Formula `λμ`, rolling resistance scales the rolling-resistance moment, and drag is a ploughing resistance on the chassis. `TireInput` gains `grip` and `rollingResistance`. Telemetry `SurfaceId_*`, `SurfaceGrip_*`. The reference table (every id → scales of 1) changes nothing. `@skidpad/presets` ships an eleven-surface reference table with sources (`surfaces`, `surfaceTable()`, `surfaceId()`); its former placeholder `gripScale` / `rollingResistanceScale` fields are renamed `grip` / `rollingResistance`.
  - physics: aero lift (ADR-0015). `aero.liftCoefficientFront`, `aero.liftCoefficientRear` (on `frontalArea`, negative is downforce) act at each axle along the body's up axis and reach the tires through the springs; `aero.dragHeightAboveCg` puts the drag on a line above the centre of mass. Telemetry `AeroLift_F`, `AeroLift_R`. Defaults reproduce the previous physics.
  - physics: solid axles and roll centres (ADR-0016). `suspension.kind` (`"independent"` | `"solid"`): a solid axle's wheels stay upright to the line through its two contacts while the body rolls. `suspension.rollCenterHeight` moves the share `h_rc / h_cg` of an axle's lateral load transfer through the links as a couple on the contacts instead of rolling the body. Telemetry `GeometricTransfer_F`, `GeometricTransfer_R`. The snapshot grows by two values (format version 3). The presets get published roll-centre heights and small lift coefficients, the kart a solid rear axle, so every golden result, scripted-drive hash and recorded lap moves.
  - Validation: step steer after ISO 7401 (`stepSteer`) and the double lane change after ISO 3888-1, with the ISO 3888-2 course as an option (`doubleLaneChange`): a preview driver with practice runs reports the highest entry speed at which every wheel stayed between the cones. The straight-line scenario takes a `surface` and reports `spun` and `finalYaw`; it measures the stop by speed over ground. The validate tool and the docs validation page report the step steer, the lane change and the 100–0 km/h stop on wet asphalt, gravel, snow and ice for every preset.
  - Three reference vehicles with data sheets: `pickup4x4` (solid rear axle with a high roll centre, full-time four-wheel drive), `crossoverEv` (dual-motor electric, modelled as one unit), `openWheeler` (winged single-seater with downforce). The determinism harness replays a recorded lap for every preset.
  - Sandbox: a Tuning panel that edits every definition parameter live (units and ranges from the JSON schema, reset to preset, copy, download and load JSON), and a surface selector for the built-in ground and the Rapier scene.
  - ABI version 4 (`sp_world_set_surfaces`, `sp_world_set_surface`).

### Patch Changes

- Updated dependencies [e578005]
- Updated dependencies [375b78b]
- Updated dependencies [c9afbb2]
- Updated dependencies [8502c19]
- Updated dependencies [7cec8a8]
- Updated dependencies [43ef906]
  - @skidpad/core@0.5.0
  - @skidpad/presets@0.5.0

## 0.4.0

### Minor Changes

- ad985bc: Milestone 3: stability and determinism as tested features.

  - New validation scenario `timestepSweep`: the skidpad, a locked-wheel stop from 100 km/h and a parked hold on a 30 % grade at every combination of substep rate (250, 500, 1000, 2000 Hz) and host rate (30, 60, 120, 240 Hz), against a reference cell at the definition's rate and a 100 Hz host. Reports the gradient and braking-distance spreads and a `stable` verdict; every preset is within 0.001 deg/g and 1 %.
  - The `straightLine` scenario measures the locked-brake behaviour: `lockTime`, `lockTransitions` and `lockReleases` (lock chatter), `lockedDecelRipple` (relative RMS of the sliding deceleration about a 0.2 s moving average), and after the stop, with the brake held for `restTime` (new config, default 2 s), `restSpeed`, `restDistance` and `settledSpeed`. `maxAccelTime: 0` now skips the acceleration phase.
  - The skidpad controller of the `understeerGradient` scenario normalises its gains by the kinematic yaw-rate gain `V / L`, so it is stable for every vehicle at every host rate (the single-track kart defeated it at a 30 Hz host step). Not a physics change: the golden gradients move by less than 0.001 deg/g and the scripted-drive hashes are unchanged.
  - The validate tool reports the lock and sweep results per preset and its golden file carries them.
  - Determinism harness: three recorded laps of the sandbox track (one per preset, driven once by a closed-loop driver and stored as integer input traces) are replayed in Chromium, Firefox, WebKit and Node alongside the scripted drive.
  - Snapshot and hash coverage on the four-wheel model: restore-and-continue in built-in and external host mode, hash sensitivity to every state value, mixed-model worlds.

- 0fdace3: Milestone 4: the drivetrain (ADR-0011).

  - physics: the interim `drive` torque law is replaced by a drivetrain solved each substep as one constrained rotational system in the wheel speeds plus the engine speed: a power unit (`direct`, `combustion` with a torque curve, engine braking, idle governor and rev limiter, or `electric` with constant torque then constant power and lift-off regeneration), a clutch with an automatic law, a gearbox with reverse and a final drive, open, locked and clutch-pack limited-slip differentials, and a centre differential for all-wheel drive. Shafts have no speed state; their inertias are reflected onto the wheels and the clutch, differential locks and brakes are bounded constraints solved jointly, so the exact brake lock of milestone 3 is kept and a locked clutch or spool is stable at every substep rate. Every preset gets a drivetrain (hatchback: five-speed automatic on an open front differential; sports car: six-speed with a clutch-pack LSD; kart: single speed with a centrifugal-style clutch and a solid rear axle), so 0–100 km/h now includes the launch and the shifts. Golden results, scripted-drive hashes and the recorded laps change.
  - Definitions: `drive` is gone; `drivetrain: { powerUnit, transmission, front, rear, center }` takes its place with defaults (a `direct` power unit). `migrateDefinition()` and `World.addVehicle()` convert a legacy `drive` block; the format version stays 1.
  - Inputs gain `clutch` (0 engaged … 1 open) and `gear` (negative reverse, 0 neutral or drive, positive gear). Input stride 6, WASM ABI version 3. `@skidpad/input` maps Q / E (or the Shift keys) to one gear per press and C to the clutch.
  - Telemetry gains `EngineRpm`, `EngineTorque`, `Gear`, `ClutchSlip`, `ClutchTorque`, `DiffLockTorque_F`, `DiffLockTorque_R`, `CenterLockTorque` and `Clutch`; `DriveTorque_*` is now the half-shaft torque per wheel. Snapshot format version 2 adds the drivetrain state.
  - The understeer scenario reduces each point by the Ackermann angle of the path actually driven (ISO 4138) and holds speed with a PI controller, so part-throttle speed errors no longer bias the gradient; the single-track gradients move within a few hundredths of a degree per g of the previous values.
  - The sandbox HUD shows the engine's rpm and gear from telemetry and the engine note follows them; the benchmark baseline is refreshed for the added solve (about 0.5 µs per vehicle-substep on the four-wheel model).

### Patch Changes

- Updated dependencies [ad985bc]
- Updated dependencies [0fdace3]
  - @skidpad/core@0.4.0
  - @skidpad/presets@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [7ae5798]
- Updated dependencies [a933c50]
- Updated dependencies [023714b]
- Updated dependencies [d719a01]
  - @skidpad/core@0.3.0
  - @skidpad/presets@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [183e243]
  - @skidpad/core@0.2.0
  - @skidpad/presets@0.2.0
