# @skidpad/presets

## 0.8.0

### Minor Changes

- 5f88288: physics: the automatic has a part-throttle shift schedule (ADR-0025). Before, it upshifted only at `shiftUpAt × redline` whatever the throttle, so a car holding a moderate speed stayed in a low gear at high revs. The hatchback held by the AI at 12 m/s sat in first at about 5,560 rpm on both models (F-25). A new transmission parameter, `shiftLightFactor` (default 0.55, range (0, 1]), sets both shift points on a closed throttle as a fraction of `shiftUpAt` and `shiftDownAt`. The points move linearly with the driver's pedal (the throttle before traction or stability control), back to the full-throttle points at full throttle. Upshifts are held back so the new gear lands at least 15 % above its downshift point, at the throttle that gear needs, so the gearbox does not hunt. Pressing the pedal raises the downshift point, and that is the kickdown. With the brake on, the automatic uses the full-throttle points. Full-throttle runs are bit-identical, so 0–100 km/h and the straight-line results do not change. The 12 m/s hatchback now cruises in second at about 3,060 rpm on both models. Validation results that hold part throttle move (lane change, step steer, timestep sweep, scripted drive hash). The presets set `shiftLightFactor` explicitly: hatchback 0.55, pickup 0.55, sports 0.6, open-wheeler 0.65, and 1 on the single-speed kart and EV. Set it to 1 to restore the old fixed points.
- 446d725: Definitions are typed for what they are:

  - Breaking (types only): `presets.*` and `preset()` are typed as `PresetDefinition`, a partial definition with a complete `name` and `chassis`, instead of a full `VehicleDefinition` they never were (no preset carries static toe or per-axle track widths, and `hatchbackFwd`, `kart` and `pickup4x4` carry no `assists`, so every assist is off on them). Reading `preset("kart").assists.abs` no longer type-checks and then throws. The package docs list which presets ship which assists.
  - `sp.completeDefinition(def)` returns a partial definition completed with the core's defaults exactly as `addVehicle` reads it.
  - `createChassisBody` in `@skidpad/rapier` and `@skidpad/jolt` takes a partial definition and reads the chassis sizes it needs, with an error pointing at `completeDefinition` when one is missing.
  - `@skidpad/rapier` types Rapier structurally, so `@dimforge/rapier3d-deterministic-compat` works without a cast and without installing the standard build; both are optional peer dependencies. `surfaceIdsByHandle(map)` builds the `surfaceId` callback from a collider-handle map, and the option's docs no longer suggest collider user data, which Rapier colliders do not have.

### Patch Changes

- 875ff5b: Every package now ships a README (install, a minimal example, links to the guide), so the npm pages are no longer empty; the core's covers bundling a Node server.

  Breaking (types only): `World.read` and `WorkerWorld.read` take a `ChannelName`, the union of every telemetry channel name, so a typo such as `"Speeed"` fails to compile instead of throwing at runtime; `readAll` returns `Record<ChannelName, number>`. `CHANNEL_NAMES` lists them at runtime. Per-wheel names compose from `WHEEL_ORDER` (`` `SlipRatio_${WHEEL_ORDER[i]}` ``); a name held in a plain `string` needs a `ChannelName` type, or use `sp.channel(name)` and `telemetryView` to probe.

- Updated dependencies [a69723f]
- Updated dependencies [4365732]
- Updated dependencies [df5031b]
- Updated dependencies [5f88288]
- Updated dependencies [446d725]
- Updated dependencies [875ff5b]
- Updated dependencies [78cd842]
- Updated dependencies [f48a141]
- Updated dependencies [a69723f]
- Updated dependencies [d61b245]
  - @skidpad/core@0.8.0

## 0.7.0

### Minor Changes

- b91cbc9: physics: the open-wheeler preset is retuned to be drivable. Full throttle with any steering below about 100 km/h spun it, because the engine overpowers the rear slicks before the wings add grip. The rear tires now model the class's wider rear slick (grip 1.62 → 1.75, cornering stiffness 23 → 30), taking the understeer gradient from 0.15 to 0.64 deg/g, and ABS, traction control and stability control are on in the preset. 0–100 km/h drops from 3.2 s to 2.9 s with traction control holding the launch. Engine, gearing and differential are unchanged; turn the assists off in `assists` for an unassisted car.

### Patch Changes

- Updated dependencies [af4ad45]
  - @skidpad/core@0.7.0

## 0.6.0

### Minor Changes

- 1fe432f: physics: the RWD sports car preset is retuned to be drivable. Peak engine torque stays at 405 N·m (about 250 kW at 7000 rpm); the rear limited-slip differential is milder (preload 20 N·m, 1.6:1 drive, 1.2:1 coast); the rear tires gain grip (1.2) and cornering stiffness (26), taking the understeer gradient from 0.27 to 0.72 deg/g. ABS, traction control and stability control are now on in the preset. The data sheet's weight split and power figures now match the numbers. The validate tool runs the locked-wheel stop with ABS off whatever the preset ships with.

### Patch Changes

- Updated dependencies [9e42f48]
  - @skidpad/core@0.6.0

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

### Minor Changes

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

## 0.2.0

### Minor Changes

- 183e243: Initial public release of the foundation (milestone 0) and the tire lab with the single-track model (milestone 1).

  physics: feel and Magic Formula 5.2 tire models with combined slip, load sensitivity, relaxation-length transients and aligning moment; planar single-track vehicle with longitudinal load transfer, implicit wheel spin, constraint brakes and aerodynamic drag; ISO 4138 understeer-gradient and straight-line validation scenarios with golden results.

### Patch Changes

- Updated dependencies [183e243]
  - @skidpad/core@0.2.0
