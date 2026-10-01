# @skidpad/core

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
