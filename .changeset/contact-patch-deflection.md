---
"@skidpad/core": minor
---

Standstill: contact-patch deflection instead of a floored relaxation (ADR-0010, amends ADR-0005).

- physics: the tire transient is now the contact-patch deflection driven by the slip velocity and decaying at the true rolling speed, integrated linearly implicitly. At speed it is the same relaxation as before up to discretisation; at standstill the tire is a spring, so parked cars hold on slopes instead of creeping at millimetres per second (every preset holds 10/20/30 % grades on the service brake, 10/20 % on the handbrake and a 20 % cross slope, at 250 to 2000 Hz). The deflection is capped at the force peak, so a car pushed past its grip slides at the falloff force; low-speed damping is a damping ratio on the corner mass that fades out by `lowSpeedDampingFade`. The implicit wheel-spin integration is re-derived for the new state. Straight-line figures move by well under 1 %, understeer gradients by less than 0.01 deg/g; scripted-drive hashes change.
- New validation scenario `parkedOnSlope` and `World.setGroundSlope(vehicle, grade, cross)`: road grade and cross slope as a gravity component on the built-in host (ignored by an external host, which has its own gravity). The validate tool and the docs table report the standstill cases per preset.
- `lowSpeedDamping` changes meaning (damping ratio of the contact-patch spring on the corner mass) and default (0.3 → 0.7); new `lowSpeedDampingFade` (m/s, default 2). `lowSpeedFloor` keeps its role for the kinematic slip only. `TireOutput` gains `fxSlide`/`fySlide` in Rust; the WASM tire-sweep record is unchanged.
- physics: the feel tire's direction-of-travel sign for the theoretical slips is taken smoothly over ±`lowSpeedFloor` instead of switching at zero speed, which removed a sustained 3 Hz micro-oscillation (4e-5 m/s) of a car parked across a slope. Nothing changes at or above the speed floor.
