# @skidpad/validate

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
