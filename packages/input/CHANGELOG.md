# @skidpad/input

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
