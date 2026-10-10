# @skidpad/core

## 0.8.0

### Minor Changes

- a69723f: Close a batch of API gaps found building a game on the packages:

  - `world.setWheelSurface(vehicle, wheel, id)` sets the built-in ground's surface under one wheel, so two wheels on the grass no longer means the whole car is on the grass. The single-track model runs each axle on the mean of its wheels' surfaces. Also on `WorkerWorld`.
  - `world.resetVehicle(vehicle, x, y, [dx, dy])` accepts a heading direction as well as a yaw angle; the core converts it with its own deterministic `atan2`. Also on `WorkerWorld`.
  - `wheelPositionsView` is filled in by `addVehicle`, `resetVehicle`, `restore`, `setLod`, `setDefinition` and `setHostMode`, instead of reading zero until the first step and staying stale after a restore. `restore` now also rewrites the vehicle's telemetry, so its pose channels follow the restore immediately.
  - `world.snapshotWorld()` / `restoreWorld(bytes)` snapshot every vehicle plus the step counter, and `world.setStepCount(n)` sets the counter, so `worldHash()` after a seek matches straight playback.
  - Breaking: `Skidpad.version` is now the npm version of `@skidpad/core` (it reported the Rust crate's `0.1.0`). The crate version moved to `crateVersion`, and the new `simulationVersion` is a hash of the sources the WASM was built from: equal values simulate identically. Every package now exports `./package.json`.
  - `@skidpad/core/compat` exports the same API as the main entry (it lacked `LodController`, `chooseLod`, `validateSurfaces`, `migrateLegacyDrive` and `InitOptions`); only `defaultWasmUrl` stays main-entry only. Its `init()` accepts `{ wasm }`.
  - The main entry documents how to bundle a Node server (keep `@skidpad/core` external, use `/compat`, or pass `init({ wasm })`), and `VehicleInput.gear` documents how gear requests map onto an automatic.

  physics: an automatic transmission without a reverse ratio (the kart preset) now treats a reverse request (`gear < 0`) as neutral; it used to drive forwards. No validation result moves.

- 4365732: New per-wheel telemetry channels: `TireFmax_FL` … `TireFmax_RR`, each tire's friction limit at its load and surface (the axle channels `TireFmax_F`/`_R` are their sums), and `PeakSlip_FL` … `PeakSlip_RR`, the combined slip relative to the slip of the tire's peak force: below 1 the tire grips, above 1 it slides. For tire sound and grip meters without reading tire parameters. The channels are appended, so existing channel indices do not move; the telemetry stride grows by eight.
- 5f88288: physics: the automatic has a part-throttle shift schedule (ADR-0025). Before, it upshifted only at `shiftUpAt × redline` whatever the throttle, so a car holding a moderate speed stayed in a low gear at high revs. The hatchback held by the AI at 12 m/s sat in first at about 5,560 rpm on both models (F-25). A new transmission parameter, `shiftLightFactor` (default 0.55, range (0, 1]), sets both shift points on a closed throttle as a fraction of `shiftUpAt` and `shiftDownAt`. The points move linearly with the driver's pedal (the throttle before traction or stability control), back to the full-throttle points at full throttle. Upshifts are held back so the new gear lands at least 15 % above its downshift point, at the throttle that gear needs, so the gearbox does not hunt. Pressing the pedal raises the downshift point, and that is the kickdown. With the brake on, the automatic uses the full-throttle points. Full-throttle runs are bit-identical, so 0–100 km/h and the straight-line results do not change. The 12 m/s hatchback now cruises in second at about 3,060 rpm on both models. Validation results that hold part throttle move (lane change, step steer, timestep sweep, scripted drive hash). The presets set `shiftLightFactor` explicitly: hatchback 0.55, pickup 0.55, sports 0.6, open-wheeler 0.65, and 1 on the single-speed kart and EV. Set it to 1 to restore the old fixed points.
- 446d725: Definitions are typed for what they are:

  - Breaking (types only): `presets.*` and `preset()` are typed as `PresetDefinition`, a partial definition with a complete `name` and `chassis`, instead of a full `VehicleDefinition` they never were (no preset carries static toe or per-axle track widths, and `hatchbackFwd`, `kart` and `pickup4x4` carry no `assists`, so every assist is off on them). Reading `preset("kart").assists.abs` no longer type-checks and then throws. The package docs list which presets ship which assists.
  - `sp.completeDefinition(def)` returns a partial definition completed with the core's defaults exactly as `addVehicle` reads it.
  - `createChassisBody` in `@skidpad/rapier` and `@skidpad/jolt` takes a partial definition and reads the chassis sizes it needs, with an error pointing at `completeDefinition` when one is missing.
  - `@skidpad/rapier` types Rapier structurally, so `@dimforge/rapier3d-deterministic-compat` works without a cast and without installing the standard build; both are optional peer dependencies. `surfaceIdsByHandle(map)` builds the `surfaceId` callback from a collider-handle map, and the option's docs no longer suggest collider user data, which Rapier colliders do not have.

- 875ff5b: Every package now ships a README (install, a minimal example, links to the guide), so the npm pages are no longer empty; the core's covers bundling a Node server.

  Breaking (types only): `World.read` and `WorkerWorld.read` take a `ChannelName`, the union of every telemetry channel name, so a typo such as `"Speeed"` fails to compile instead of throwing at runtime; `readAll` returns `Record<ChannelName, number>`. `CHANNEL_NAMES` lists them at runtime. Per-wheel names compose from `WHEEL_ORDER` (`` `SlipRatio_${WHEEL_ORDER[i]}` ``); a name held in a plain `string` needs a `ChannelName` type, or use `sp.channel(name)` and `telemetryView` to probe.

- f48a141: Suspension geometry that changes with travel (ADR-0026). An optional `suspension.kinematics` block carries piecewise-linear curves of toe, camber, roll-centre height, anti-brake and anti-drive against each wheel's travel (metres, positive in bump), as offsets from the static fields. Each curve has 2 to 16 points, is zero at zero travel, and is mirrored to the right wheel. Toe and camber curves are rejected on solid axles. The Rust and TypeScript validators give the same messages, and `evalTravelCurve` is exported. New telemetry: `Toe_FL` … `Toe_RR` and `JackingForce_F` / `JackingForce_R`. The core WASM budget rises from 200 KB to 224 KB gzipped.

  - physics: an axle with a roll-centre curve takes each wheel's lateral force through its own link at its own roll-centre height, so unequal forces jack the body. Definitions without curves simulate bit for bit as before.
  - physics: the hatchback, sports car, crossover, pickup (front) and open-wheeler presets carry illustrative roll-centre curves, and the road cars camber gain. The road cars understeer up to 5 % less; lane-change limits, braking distances and every stability result are unchanged. Golden results and the determinism laps of those presets are regenerated.
  - physics: snapshot format version 5. Each wheel's previous lateral force is now part of the state, so every state hash changes. The golden scripted-drive hashes are regenerated, and no other validation result moves.

### Patch Changes

- df5031b: - physics: the Magic Formula cornering stiffness applies the nominal-load scale `LFZO` once, as Pacejka's eq. 4.E25 does (`F'z0 = λFz0·Fz0`), instead of twice. A `.tir` with `LFZO` other than 1 gave a cornering stiffness `LFZO` times too small: 19 % too small for Project Chrono's Sedan tire (`LFZO = 0.81`), which found it. No preset sets `LFZO`, so no validation result moves.
- 78cd842: - physics: `.tir` import reads the nominal load from `FNOMIN`, the key PAC2002 and MF-Tyre files use in `[VERTICAL]`; `FZ0` is still accepted. Before, a real `.tir` kept the default 4000 N nominal load with only a warning, which shifts every load-dependent coefficient. Definitions that do not import a `.tir` are unaffected.
- a69723f: The WASM build now re-encodes the module with `wasm-opt` (binaryen is a dev dependency), which drops the padded integers the linker leaves: about 7 % smaller, with the gzipped size about 1 % smaller. No optimisation passes run, so the code is unchanged. The WASM ABI version is 6.
- d61b245: `WorkerWorld.lodTarget` is a synchronous `LodTarget`, so a `LodController` can drive a worker world: it keeps each vehicle's level locally, sends changes without waiting, and follows `restore`. `WorkerWorld.lod()` and `restore()` keep the local levels up to date. The `LodController` doc example now matches its signature (`pin()` the player's car, `update(distance)`), and the worker guide explains why Rapier- and Jolt-hosted cars cannot run in a `WorkerWorld`.

## 0.7.0

### Patch Changes

- af4ad45: physics: restrict four-wheel suspension contacts to the finite forward ray. Behind-origin plane intersections during rapid steering and rollover could generate enormous contact lever arms and nonfinite chassis motion. Valid forward contacts and bump stops keep their existing behavior. The built-in host still has no chassis collision body; external hosts remain responsible for rollover collisions. Snapshot and definition formats are unchanged.

## 0.6.0

### Patch Changes

- 9e42f48: physics: an automatic no longer flares the engine after an upshift. The throttle came straight back to full once the shift time ended, while the re-engaging clutch could barely carry any torque, so the engine revved back up toward the shift point before the clutch dragged it down to the new gear's speed (heard in the sandbox as a flat-foot shift). Until the engine has come down to the gearbox input speed, the engine now makes at most 70 % of what the clutch can carry. Accelerating from 0 to 100 km/h takes slightly longer on the combustion presets (sports 6.58 → 6.62 s, hatchback 9.52 → 9.82 s, pickup 7.26 → 7.44 s, open-wheeler 3.16 → 3.19 s), because the flywheel no longer dumps a rev flare into the wheels.

## 0.5.0

### Minor Changes

- e578005: - physics: anti-dive and anti-squat (ADR-0018). `suspension.antiBrake` and `suspension.antiDrive`, fractions of the load transfer each axle's braking or driving force causes that its links carry straight to the tires, default 0, bounded at ±2. New telemetry `PitchLinkLoad_F` and `PitchLinkLoad_R`. Snapshot format version 4: the previous substep's axle longitudinal forces are part of the state, so state hashes change; the golden scripted-drive hashes are regenerated and no other validation result moves.
  - physics: measured engine braking (ADR-0011 amendment). `powerUnit.engineBrakingCurve`, `[rpm, N·m]` drag points that replace the `engineBrakingIdle`–`engineBrakingRedline` line when given.
  - `axles[].trackWidth`: an axle's own track, 0 (default) for `chassis.trackWidth`. The four-wheel model, roll-centre transfer, Ackermann geometry, lane-change course and sandbox use it.
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

- 7cec8a8: Milestone 7, scale. Core: per-vehicle level of detail (`setLod`: full,
  single-track, frozen, with a substep-rate override) that carries a car's
  motion across a model switch, `stepMany` for batched stepping, and a
  path-following driver inside the step (`setAi`, `aiStatus`, `clearAi`) with
  a curvature and braking speed profile; `LodController` picks levels by
  distance with hysteresis. A snapshot of the other model restores by
  switching to it. WASM ABI version 5. New packages: `@skidpad/replay`
  (deterministic replays as inputs plus keyframes, seekable, and pose-track
  ghosts, with binary formats), `@skidpad/worker` (a world in a Web Worker or
  Node worker thread), and `@skidpad/jolt` (Jolt Physics host adapter). A
  Babylon.js example on Jolt.
- 43ef906: - physics: static toe per axle (ADR-0017). `axles[].staticToeDeg`, degrees per wheel, positive toe-in, default 0, bounded at ±10. The four-wheel model adds it to each wheel's road-wheel angle, so `WheelSteer_*` includes it and `SteerAngle` does not; the single-track model ignores it. Definitions without it are unchanged, and so are the golden results.

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

## 0.3.0

### Minor Changes

- 7ae5798: Standstill: contact-patch deflection instead of a floored relaxation (ADR-0010, amends ADR-0005).

  - physics: the tire transient is now the contact-patch deflection driven by the slip velocity and decaying at the true rolling speed, integrated linearly implicitly. At speed it is the same relaxation as before up to discretisation; at standstill the tire is a spring, so parked cars hold on slopes instead of creeping at millimetres per second (every preset holds 10/20/30 % grades on the service brake, 10/20 % on the handbrake and a 20 % cross slope, at 250 to 2000 Hz). The deflection is capped at the force peak, so a car pushed past its grip slides at the falloff force; low-speed damping is a damping ratio on the corner mass that fades out by `lowSpeedDampingFade`. The implicit wheel-spin integration is re-derived for the new state. Straight-line figures move by well under 1 %, understeer gradients by less than 0.01 deg/g; scripted-drive hashes change.
  - New validation scenario `parkedOnSlope` and `World.setGroundSlope(vehicle, grade, cross)`: road grade and cross slope as a gravity component on the built-in host (ignored by an external host, which has its own gravity). The validate tool and the docs table report the standstill cases per preset.
  - `lowSpeedDamping` changes meaning (damping ratio of the contact-patch spring on the corner mass) and default (0.3 → 0.7); new `lowSpeedDampingFade` (m/s, default 2). `lowSpeedFloor` keeps its role for the kinematic slip only. `TireOutput` gains `fxSlide`/`fySlide` in Rust; the WASM tire-sweep record is unchanged.
  - physics: the feel tire's direction-of-travel sign for the theoretical slips is taken smoothly over ±`lowSpeedFloor` instead of switching at zero speed, which removed a sustained 3 Hz micro-oscillation (4e-5 m/s) of a car parked across a slope. Nothing changes at or above the speed floor.

- a933c50: Feel tire: aligning moment that goes light at the limit (ADR-0008 amendment B).

  - physics: the feel tire's pneumatic trail now follows `t0·(1 − x²)/(1 + k·x⁴)` on the combined equivalent slip angle, so it crosses zero at the lateral peak, dips negative past it and shortens under braking or drive. The aligning moment (and so the steering torque) peaks at about 0.41 of the peak slip angle, is zero at the peak and reverses by about a fifth of its peak past it, which is the "going light" cue. Understeer golden results move by less than 0.01 deg/g; the scripted-drive hashes change; the straight-line results do not.
  - New feel-tire parameters, all with defaults: `trailZeroCrossing` (1.0, multiples of the peak slip angle), `trailReversal` (0.1 of `pneumaticTrail`) and `fxMomentArm` (0 m, the Magic Formula `SSZ2` contact-patch shift, opt-in). `TireOutput.trail` and the `Trail_*` telemetry channels can now be negative.

- 023714b: Milestone 2: four wheels, suspension, Rapier host.

  - physics: the default vehicle model is now `simulation.model = "fourWheel"`: four wheels on independent raycast suspension (spring, bump and rebound damping, anti-roll bar, bump stop) over a six-degree-of-freedom chassis proxy with roll and pitch inertia, Ackermann steering and per-wheel camber. The planar single-track model stays as `"singleTrack"`. Golden validation results, the scripted-drive hashes and the determinism scenario hashes change.
  - physics: low-speed handling (ADR-0005) gains a damping term on the wheel-tire mode and a rolling-resistance moment that is smooth through zero, so a nudged parked car no longer rings. New tire parameter `lowSpeedDamping` (damping ratio, default 0.3).
  - Definitions gain `chassis.rollInertia`, `chassis.pitchInertia`, `axles[].suspension`, `steering.ackermann` and `simulation.model`, all with defaults; the format version stays 1.
  - Telemetry gains body pose channels (`PosZ`, `Roll`, `Pitch`, rates, `Quat*`) and per-wheel channels (`_FL`, `_FR`, `_RL`, `_RR`) for load, slips, forces, camber, suspension travel, rate and force, steer, contact, lock and spin angle. The `_F`/`_R` channels are now axle sums (forces) and means (speeds, slips).
  - External host contract (ADR-0002, ADR-0009): `World.setHostMode`, `writeHostBody`, `writeWheelContact`, `clearWheelContact`, `readHostImpulse`, `wheelRays`, `wheelPositionsView`. WASM ABI version 2.
  - New package `@skidpad/rapier` with `RapierVehicle` and `createChassisBody`, driving a Rapier 3D rigid body in a y-up or z-up scene, including moving platforms.
  - Presets carry suspension rates, roll and pitch inertia.

- d719a01: Feel tire: theoretical-slip combined slip (ADR-0008 amendment A).

  - physics: the feel tire combines slips through the brush model's theoretical slips `σx = κ/(1+κ)` and `σy = tan α/(1+κ)` instead of the raw slip ratio and slip angle. Pure braking, pure drive and pure cornering are unchanged to better than 1e-9 relative, so the straight-line golden results stay; combined slip now has the braking/driving asymmetry of a real tire (a braked tire reaches its lateral peak at a smaller slip angle), reverse travel mirrors forward travel, and a locked wheel is fully sliding at any slip ratio at or below −1. Understeer golden results and the scripted-drive hashes move slightly.
  - `peakSlipRatio` must now be below 1 and `peakSlipAngleDeg` at most 45; every shipped preset and the defaults already comply.

## 0.2.0

### Minor Changes

- 183e243: Initial public release of the foundation (milestone 0) and the tire lab with the single-track model (milestone 1).

  physics: feel and Magic Formula 5.2 tire models with combined slip, load sensitivity, relaxation-length transients and aligning moment; planar single-track vehicle with longitudinal load transfer, implicit wheel spin, constraint brakes and aerodynamic drag; ISO 4138 understeer-gradient and straight-line validation scenarios with golden results.
