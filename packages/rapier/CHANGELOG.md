# @skidpad/rapier

## 0.5.0

### Minor Changes

- 8502c19: Milestone 6: surfaces, aero lift, solid axles and roll centres, the full validation runner, reference vehicles, a tuning editor.

  - physics: surface table (ADR-0014). A world holds up to 16 surfaces (`grip`, `rollingResistance`, `drag`) set with `World.setSurfaces()`; wheel contacts index it through their `surfaceId` (the Rapier adapter's `surfaceId` option, or `World.setSurface()` for the built-in ground). Grip scales the tire's peak and sliding friction like the Magic Formula `λμ`, rolling resistance scales the rolling-resistance moment, and drag is a ploughing resistance on the chassis. `TireInput` gains `grip` and `rollingResistance`. Telemetry `SurfaceId_*`, `SurfaceGrip_*`. The reference table (every id → scales of 1) changes nothing. `@skidpad/presets` ships an eleven-surface reference table with sources (`surfaces`, `surfaceTable()`, `surfaceId()`); its former placeholder `gripScale` / `rollingResistanceScale` fields are renamed `grip` / `rollingResistance`.
  - physics: aero lift (ADR-0015). `aero.liftCoefficientFront`, `aero.liftCoefficientRear` (on `frontalArea`, negative is downforce) act at each axle along the body's up axis and reach the tires through the springs; `aero.dragHeightAboveCg` puts the drag on a line above the centre of mass. Telemetry `AeroLift_F`, `AeroLift_R`. Defaults reproduce the previous physics.
  - physics: solid axles and roll centres (ADR-0016). `suspension.kind` (`"independent"` | `"solid"`): a solid axle's wheels stay upright to the line through its two contacts while the body rolls. `suspension.rollCenterHeight` moves the share `h_rc / h_cg` of an axle's lateral load transfer through the links as a couple on the contacts instead of rolling the body. Telemetry `GeometricTransfer_F`, `GeometricTransfer_R`. The snapshot grows by two values (format version 3). The presets get published roll-centre heights and small lift coefficients, the kart a solid rear axle, so every golden result, scripted-drive hash and recorded lap moves.
  - Validation: step steer after ISO 7401 (`stepSteer`) and the double lane change after ISO 3888-1, with the ISO 3888-2 course as an option (`doubleLaneChange`): a preview driver with practice runs reports the highest entry speed at which every wheel stayed between the cones. The straight-line scenario takes a `surface` and reports `spun` and `finalYaw`; it measures the stop by speed over ground. The validate tool and the docs validation page report the step steer, the lane change and the 100–0 km/h stop on wet asphalt, gravel, snow and ice for every preset.
  - Three reference vehicles with data sheets: `pickup4x4` (solid rear axle with a high roll centre, full-time four-wheel drive), `crossoverEv` (dual-motor electric, modelled as one unit), `openWheeler` (winged single-seater with downforce). The determinism harness replays a recorded lap for every preset.
  - Sandbox: a Tuning panel that edits every definition parameter live (units and ranges from the JSON schema, reset to preset, copy, download and load JSON), and a surface selector for the built-in ground and the Rapier scene.
  - ABI version 4 (`sp_world_set_surfaces`, `sp_world_set_surface`).

### Patch Changes

- 375b78b: Every `@skidpad/*` package now releases at one shared version. The packages
  that build on `@skidpad/core` depend on it with a caret range (`^0.5.0`)
  instead of an exact version, so an app's own `@skidpad/core` is shared rather
  than installed twice.
- Updated dependencies [e578005]
- Updated dependencies [c9afbb2]
- Updated dependencies [8502c19]
- Updated dependencies [7cec8a8]
- Updated dependencies [43ef906]
  - @skidpad/core@0.5.0

## 0.4.0

### Patch Changes

- 0fdace3: Milestone 4: the drivetrain (ADR-0011).

  - physics: the interim `drive` torque law is replaced by a drivetrain solved each substep as one constrained rotational system in the wheel speeds plus the engine speed: a power unit (`direct`, `combustion` with a torque curve, engine braking, idle governor and rev limiter, or `electric` with constant torque then constant power and lift-off regeneration), a clutch with an automatic law, a gearbox with reverse and a final drive, open, locked and clutch-pack limited-slip differentials, and a centre differential for all-wheel drive. Shafts have no speed state; their inertias are reflected onto the wheels and the clutch, differential locks and brakes are bounded constraints solved jointly, so the exact brake lock of milestone 3 is kept and a locked clutch or spool is stable at every substep rate. Every preset gets a drivetrain (hatchback: five-speed automatic on an open front differential; sports car: six-speed with a clutch-pack LSD; kart: single speed with a centrifugal-style clutch and a solid rear axle), so 0–100 km/h now includes the launch and the shifts. Golden results, scripted-drive hashes and the recorded laps change.
  - Definitions: `drive` is gone; `drivetrain: { powerUnit, transmission, front, rear, center }` takes its place with defaults (a `direct` power unit). `migrateDefinition()` and `World.addVehicle()` convert a legacy `drive` block; the format version stays 1.
  - Inputs gain `clutch` (0 engaged … 1 open) and `gear` (negative reverse, 0 neutral or drive, positive gear). Input stride 6, WASM ABI version 3. `@skidpad/input` maps Q / E (or the Shift keys) to one gear per press and C to the clutch.
  - Telemetry gains `EngineRpm`, `EngineTorque`, `Gear`, `ClutchSlip`, `ClutchTorque`, `DiffLockTorque_F`, `DiffLockTorque_R`, `CenterLockTorque` and `Clutch`; `DriveTorque_*` is now the half-shaft torque per wheel. Snapshot format version 2 adds the drivetrain state.
  - The understeer scenario reduces each point by the Ackermann angle of the path actually driven (ISO 4138) and holds speed with a PI controller, so part-throttle speed errors no longer bias the gradient; the single-track gradients move within a few hundredths of a degree per g of the previous values.
  - The sandbox HUD shows the engine's rpm and gear from telemetry and the engine note follows them; the benchmark baseline is refreshed for the added solve (about 0.5 µs per vehicle-substep on the four-wheel model).

- Updated dependencies [ad985bc]
- Updated dependencies [0fdace3]
  - @skidpad/core@0.4.0

## 0.3.0

### Minor Changes

- 023714b: Milestone 2: four wheels, suspension, Rapier host.

  - physics: the default vehicle model is now `simulation.model = "fourWheel"`: four wheels on independent raycast suspension (spring, bump and rebound damping, anti-roll bar, bump stop) over a six-degree-of-freedom chassis proxy with roll and pitch inertia, Ackermann steering and per-wheel camber. The planar single-track model stays as `"singleTrack"`. Golden validation results, the scripted-drive hashes and the determinism scenario hashes change.
  - physics: low-speed handling (ADR-0005) gains a damping term on the wheel-tire mode and a rolling-resistance moment that is smooth through zero, so a nudged parked car no longer rings. New tire parameter `lowSpeedDamping` (damping ratio, default 0.3).
  - Definitions gain `chassis.rollInertia`, `chassis.pitchInertia`, `axles[].suspension`, `steering.ackermann` and `simulation.model`, all with defaults; the format version stays 1.
  - Telemetry gains body pose channels (`PosZ`, `Roll`, `Pitch`, rates, `Quat*`) and per-wheel channels (`_FL`, `_FR`, `_RL`, `_RR`) for load, slips, forces, camber, suspension travel, rate and force, steer, contact, lock and spin angle. The `_F`/`_R` channels are now axle sums (forces) and means (speeds, slips).
  - External host contract (ADR-0002, ADR-0009): `World.setHostMode`, `writeHostBody`, `writeWheelContact`, `clearWheelContact`, `readHostImpulse`, `wheelRays`, `wheelPositionsView`. WASM ABI version 2.
  - New package `@skidpad/rapier` with `RapierVehicle` and `createChassisBody`, driving a Rapier 3D rigid body in a y-up or z-up scene, including moving platforms.
  - Presets carry suspension rates, roll and pitch inertia.

### Patch Changes

- Updated dependencies [7ae5798]
- Updated dependencies [a933c50]
- Updated dependencies [023714b]
- Updated dependencies [d719a01]
  - @skidpad/core@0.3.0
