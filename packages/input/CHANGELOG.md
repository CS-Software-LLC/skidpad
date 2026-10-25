# @skidpad/input

## 0.11.0

### Minor Changes

- cc6ab8d: Gamepad steering turns the wheel over time instead of capping the lock. Full stick asks for full lock again (`steerSensitivity` now defaults to 1, was 0.75), and the wheel winds toward the stick at `steerRate` (default 2 full locks a second, was 5; now a live property) and unwinds toward centre at the faster `steerReturnRate` (new, default 5). Wheels, keyboard and touch are unchanged.
- 909400b: Gamepad steering asks for less lock as speed rises, so small corrections stay small at track speed. Set `GamepadInput.speed` (m/s) before each read; full stick then gives half lock at `steerSpeedHalf` (default 20 m/s, a live property, `Infinity` for off) and falls as `1 / (1 + (v / half)²)`. Left at speed 0 nothing changes. The default wind-on rate is now 4/3 full locks a second (0.75 s to full lock, was 0.5 s). Wheels, keyboard and touch are unchanged.

### Patch Changes

- 2135cf9: - input: the G PRO models carry a measured `damperRate` of 8.5 rad/s (`G_PRO_DAMPER_RATE`, from `measureDamper()` on a G PRO); `LogitechWebHidSink.damperRate` defaults to the attached model's value, else 10, and setting it to `undefined` goes back to the model's. The sandbox's wheel panel now starts with the settings driven on a G PRO: Column feel 2×, sub-frame playout at 500 Hz, the direct-drive slew and smoothing, and the rotation matched to the car.
  - input: the G PRO profile's paddles were swapped (up was button 5, down 4); up is now 4 and down 5, and a G PRO profile saved with the old pair is corrected on load.

## 0.10.0

### Minor Changes

- 228d8a0: - input: `LogitechWebHidSink.measureDamper()` measures the firmware damper's units with the hands off. It spins the rim at three constant torques with the damper at a known coefficient, then `fitDamper` fits `T = c·ω + f` for the damping, the friction and the sink's `damperRate`. The sandbox's wheel panel has a "Measure damping" button, and it remembers the result in this browser.
- ce60316: - core: `SteeringTorqueSlice0` … `SteeringTorqueSlice7`, the host step's steering torque in eight equal slices of time (ADR-0032). Telemetry only; state and determinism hashes are unchanged.
  - input: `LogitechWebHidSink` can play the slices out between host steps (`playoutRate`, Hz, default 0 = off) through the new `TorquePlayout`; `FfbScaler.scale` is split into `watch` (the runaway guard, once per host step) and `shape`. `setRotation()` sets the wheel's rotation, clamped to the model's `maxRotationDeg` (1080° on the G PRO); `WheelInput.rotationDeg` follows it, and a car lock wider than the wheel is then reached at the wheel's end stop. `DIRECT_DRIVE_SCALER` holds the slew and smoothing suggested for a direct-drive base. All off by default until tried on a wheel.
- 42a2ccb: - core: force-feedback torque channels (ADR-0031). `SteeringTorqueMean` is the mean of `SteeringTorque` over the host step's substeps, and `SteerTorqueMz`, `SteerTorqueTrail`, `SteerTorqueScrub`, `SteerTorqueLift` and `SteerTorqueAssist` split `SteeringTorque` by source at the hand wheel. Telemetry only; state and determinism hashes are unchanged.
  - input: `ffbFrameFromTelemetry` sends `SteeringTorqueMean` instead of the last substep's torque, which aliased anything above half the host rate. `FfbScaler` reports `requested`, `sent`, `lastClipped` and `peak`; `FfbSink` has an optional `scaler`.
- 1f795f8: Gamepad steering is gentler by default. `GamepadInput` now asks for 75 % of full lock at full stick (`steerSensitivity`, also a live property), uses a square response curve (`steerExponent` default 2, was 1.5), and rate limits the steering output to 5 lock fractions per second (`steerRate`, `Infinity` for off) so a flicked stick no longer snaps the front wheels across in one frame. `map()` and `poll()` take an optional `dt` (default 1/60 s). Wheels, keyboard and touch are unchanged.
- 199e026: - core: speed-sensitive column damping (ADR-0033). `steering.columnDampingAtSpeed` and `steering.columnDampingSpeed` (default 0, off) raise the force-feedback column damping linearly with speed. The `ColumnDamping` channel reports the current value. The column is not simulated, so state and hashes are unchanged.
  - input: `ffbFrameFromTelemetry` sends `ColumnDamping`. `LogitechWebHidSink` re-sends the damper only when it moves by more than about 5 %.
  - presets: the hatchback, sports car, crossover, pickup and open-wheeler reach four times their parking damping by 20 m/s.

## 0.9.0

### Minor Changes

- bb3a2f7: - Force feedback: `LogitechWebHidSink` now sends the definition's `steering.columnFriction` and `steering.columnDamping` to the wheel's own friction and damper effects over HID++ (they were downloaded at zero and never updated, which left the wheel free around the centre). Both scale with `gain` and a new `columnScale` option (default 1), are capped at `maxOutput` by the effect saturation, are sent only when they change, and stay on when the runaway guard or the watchdog cuts the constant force. A new `damperRate` option (default 10 rad/s, [VERIFY] on hardware) sets the hand-wheel rate of full damper output. `columnEffects()` exposes the mapping. The classic protocol does not send them yet.

## 0.8.0

### Minor Changes

- 66ca12a: Devices compose, and gears follow the car:

  - `GearSelector` holds one requested gear for every device. In `"automatic"` mode it only moves between reverse (−1) and drive (0), so a keyboard can no longer count up to gear 10 that the automatic ignores and then need ten presses to reach reverse; in `"manual"` mode (the default) it counts −1 to `maxGear`. `KeyboardInput`, `GamepadInput` and `WheelInput` take it as `gears` (and keep a `gear` property); `KeyboardMapping` gains an optional `reverse` key list.
  - `InputMixer` reads several devices each frame and passes on the one the player touched last, with the shared gear.
  - `GamepadInput` shifts: bumpers shift up and down and the top face button toggles reverse (all configurable, `-1` for none). `poll()` reads the first pad with the standard mapping (`pick` to choose otherwise) instead of whatever pad comes first, which was the wheel when one was plugged in, and leaves it in `lastPad` for a rumble sink.
  - `WheelInput.match` leaves standard-mapping gamepads out (`matchStandardPads` to include them), so the generic wheel profile's `046d` no longer matches a Logitech gamepad. The G PRO profile no longer matches every Logitech device: its pattern `046d.*(PRO|Pro)` matched the "Product:" in Chromium's ids, so a G29 got the G PRO profile.
  - `AxisFinder.result(threshold, exclude)` leaves out assigned axes and reports the raw range seen; `AxisFinder.binding(found, centred, rest)` makes a calibrated binding from it. The `(?i)` prefix of profile patterns is documented, and a stale doc comment on `GamepadInput` is gone.

- c7e6be9: `LogitechWebHidSink` picks its protocol from the wheel's product id. The new default `protocol: "auto"` looks the device up in `LOGITECH_WHEELS` (ids from the Linux drivers; `logitechWheel(productId)` exposes the lookup) when it attaches, so a G29 now gets the classic protocol instead of HID++, and an unknown wheel still falls back to HID++. `peakTorque` is now derived from the attached wheel, or from the protocol actually in use, instead of being fixed by the constructor, so forcing `sink.protocol` before `attach()` no longer leaves the torque scale four times off.

  Breaking: `attach()` and `connect()` now reject, closing the device again, when the force path cannot be set up (the HID++ force-feedback feature does not answer, or the wheel refuses the constant-force effect). Before, the sink reported `connected` and silently sent nothing. The new `ready` getter says whether forces are being sent, and `wheel` names the recognised model.

### Patch Changes

- deb3519: Send HID++ 2.0 force-feedback commands as long (0x11) or very long (0x12) reports instead of short (0x10) ones, which the G PRO refuses with "NotAllowedError: Failed to write the report". `connect()` now picks the wheel interface that declares HID++ output reports (new `pickHidppDevice` and `outputReportIds` helpers), and the diagnostics log lists the output reports of the opened interface.
- 875ff5b: Every package now ships a README (install, a minimal example, links to the guide), so the npm pages are no longer empty; the core's covers bundling a Node server.

  Breaking (types only): `World.read` and `WorkerWorld.read` take a `ChannelName`, the union of every telemetry channel name, so a typo such as `"Speeed"` fails to compile instead of throwing at runtime; `readAll` returns `Record<ChannelName, number>`. `CHANNEL_NAMES` lists them at runtime. Per-wheel names compose from `WHEEL_ORDER` (`` `SlipRatio_${WHEEL_ORDER[i]}` ``); a name held in a plain `string` needs a `ChannelName` type, or use `sp.channel(name)` and `telemetryView` to probe.

## 0.7.0

### Minor Changes

- b36e9e2: input: safer force-feedback defaults. The Logitech sink caps every level at `maxOutput` (default 0.4 of the device's peak, about 4.4 N·m on a G PRO; `maxTorque` now reports the capped torque and `peakTorque` the device's), `FfbScaler` defaults to a gain of 0.5 and a rate limit of 5 full scales per second, and a runaway guard latches the output at zero when the hand wheel moves away from the centre faster than 10 rad/s under force, until `scaler.rearm()`. Pass the hand-wheel angle as `ffbFrameFromTelemetry`'s new third argument to enable the guard. The sink also zeroes the force when the page is hidden or closed and when updates stop for 0.25 s. The HID++ constant force's sign is flipped to match a G PRO on hardware, and the test pulse is gentler and bypasses the scaler.

### Patch Changes

- 281cb14: input: the Logitech HID++ force-feedback sink now follows the byte layout of the Linux driver's G920 / G923 path. Every effect command leads with its slot byte, which was missing, so each field landed one byte early and the wheel ignored the forces. Connecting now replaces the firmware's centring spring with a zero-strength one; a reset alone left it on and held the wheel stiffly to the centre. Effect states use play 0x02 and stop 0x01, the global gain no longer sets boost, condition effects go out in very long (0x12) reports, replies are matched to their request, and HID++ error codes and send failures appear in the diagnostics log.

## 0.6.0

## 0.5.0

### Minor Changes

- c9afbb2: Milestone 5: steering geometry, assists, wheels and force feedback.

  - physics: steering geometry (ADR-0012). `steering` gains `mechanicalTrail`, `scrubRadius`, `steeringArm`, `powerAssist`, `columnFriction`, `columnDamping` and `jackingRate`. The hand-wheel torque is now the kingpin torque of both steered wheels (aligning moment, mechanical trail on the lateral force, scrub radius on the longitudinal force) through the ratio and the assist, in the sign of the steer input; `RackForce` is new. Jacking moves the front contacts along their rays with steer so a kart's solid axle unloads its inner rear wheel. Vehicle motion is unchanged for `jackingRate: 0`; the presets get trail, scrub and assist values and the kart a jacking rate, so its results move.
  - physics: an automatic now lifts the throttle while its clutch is open for a shift, so the engine falls toward the next gear's speed instead of dumping its inertia into the wheels on re-engagement. 0–100 km/h times move by a tenth; scripted-drive hashes and recorded laps change.
  - Driving assists (ADR-0013), off by default and stateless inside the core: `assists.abs`, `assists.tractionControl`, `assists.stabilityControl` and `assists.steeringAssist`, with telemetry `AbsActivity`, `TcActivity`, `EscYawError`, `EscBrakeTorque`, `SteerAssistScale` and `ThrottleEffective`. The sandbox's speed-sensitive steering moved into the core. The validate tool reports the 100–0 km/h stop with the ABS beside the locked-wheel stop.
  - `@skidpad/input`: axis calibration (`AxisCalibrator`, `calibrateCentred`, `calibratePedal`), wheel profiles stored as JSON (`WheelProfile`, `loadProfiles`, `saveProfiles`, built-in Logitech G PRO, G29/G923 and generic profiles), `WheelInput` over the Gamepad API with steering scaled by the car's lock and paddle shifting, `AxisFinder` for assigning controls by moving them, `TouchInput` on-screen controls, and force feedback: `FfbFrame`, `FfbSink`, `FfbScaler`, `ffbFrameFromTelemetry`, `GamepadRumbleSink`, and `LogitechWebHidSink` (HID++ 0x8123 for the G PRO / G923 / G920, classic seven-byte protocol for the G29 / G27 / G25) with a diagnostics log. Protocol constants are reconstructed from open-source drivers and marked [VERIFY] until tried on hardware. `clamp`, `Ramp` and friends moved to a `filters` module (re-exported).
  - Sandbox: a Wheel setup panel (devices, assign and calibrate controls, connect force feedback, gain, test pulse, log, assists toggles); touch driving on the canvas.

## 0.4.0

### Minor Changes

- 0fdace3: Milestone 4: the drivetrain (ADR-0011).

  - physics: the interim `drive` torque law is replaced by a drivetrain solved each substep as one constrained rotational system in the wheel speeds plus the engine speed: a power unit (`direct`, `combustion` with a torque curve, engine braking, idle governor and rev limiter, or `electric` with constant torque then constant power and lift-off regeneration), a clutch with an automatic law, a gearbox with reverse and a final drive, open, locked and clutch-pack limited-slip differentials, and a centre differential for all-wheel drive. Shafts have no speed state; their inertias are reflected onto the wheels and the clutch, differential locks and brakes are bounded constraints solved jointly, so the exact brake lock of milestone 3 is kept and a locked clutch or spool is stable at every substep rate. Every preset gets a drivetrain (hatchback: five-speed automatic on an open front differential; sports car: six-speed with a clutch-pack LSD; kart: single speed with a centrifugal-style clutch and a solid rear axle), so 0–100 km/h now includes the launch and the shifts. Golden results, scripted-drive hashes and the recorded laps change.
  - Definitions: `drive` is gone; `drivetrain: { powerUnit, transmission, front, rear, center }` takes its place with defaults (a `direct` power unit). `migrateDefinition()` and `World.addVehicle()` convert a legacy `drive` block; the format version stays 1.
  - Inputs gain `clutch` (0 engaged … 1 open) and `gear` (negative reverse, 0 neutral or drive, positive gear). Input stride 6, WASM ABI version 3. `@skidpad/input` maps Q / E (or the Shift keys) to one gear per press and C to the clutch.
  - Telemetry gains `EngineRpm`, `EngineTorque`, `Gear`, `ClutchSlip`, `ClutchTorque`, `DiffLockTorque_F`, `DiffLockTorque_R`, `CenterLockTorque` and `Clutch`; `DriveTorque_*` is now the half-shaft torque per wheel. Snapshot format version 2 adds the drivetrain state.
  - The understeer scenario reduces each point by the Ackermann angle of the path actually driven (ISO 4138) and holds speed with a PI controller, so part-throttle speed errors no longer bias the gradient; the single-track gradients move within a few hundredths of a degree per g of the previous values.
  - The sandbox HUD shows the engine's rpm and gear from telemetry and the engine note follows them; the benchmark baseline is refreshed for the added solve (about 0.5 µs per vehicle-substep on the four-wheel model).

## 0.3.0

### Patch Changes

- 023714b: Milestone 2: four wheels, suspension, Rapier host.

  - physics: the default vehicle model is now `simulation.model = "fourWheel"`: four wheels on independent raycast suspension (spring, bump and rebound damping, anti-roll bar, bump stop) over a six-degree-of-freedom chassis proxy with roll and pitch inertia, Ackermann steering and per-wheel camber. The planar single-track model stays as `"singleTrack"`. Golden validation results, the scripted-drive hashes and the determinism scenario hashes change.
  - physics: low-speed handling (ADR-0005) gains a damping term on the wheel-tire mode and a rolling-resistance moment that is smooth through zero, so a nudged parked car no longer rings. New tire parameter `lowSpeedDamping` (damping ratio, default 0.3).
  - Definitions gain `chassis.rollInertia`, `chassis.pitchInertia`, `axles[].suspension`, `steering.ackermann` and `simulation.model`, all with defaults; the format version stays 1.
  - Telemetry gains body pose channels (`PosZ`, `Roll`, `Pitch`, rates, `Quat*`) and per-wheel channels (`_FL`, `_FR`, `_RL`, `_RR`) for load, slips, forces, camber, suspension travel, rate and force, steer, contact, lock and spin angle. The `_F`/`_R` channels are now axle sums (forces) and means (speeds, slips).
  - External host contract (ADR-0002, ADR-0009): `World.setHostMode`, `writeHostBody`, `writeWheelContact`, `clearWheelContact`, `readHostImpulse`, `wheelRays`, `wheelPositionsView`. WASM ABI version 2.
  - New package `@skidpad/rapier` with `RapierVehicle` and `createChassisBody`, driving a Rapier 3D rigid body in a y-up or z-up scene, including moving platforms.
  - Presets carry suspension rates, roll and pitch inertia.

## 0.2.0

### Minor Changes

- 183e243: Initial public release of the foundation (milestone 0) and the tire lab with the single-track model (milestone 1).

  physics: feel and Magic Formula 5.2 tire models with combined slip, load sensitivity, relaxation-length transients and aligning moment; planar single-track vehicle with longitudinal load transfer, implicit wheel spin, constraint brakes and aerodynamic drag; ISO 4138 understeer-gradient and straight-line validation scenarios with golden results.
