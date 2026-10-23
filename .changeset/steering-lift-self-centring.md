---
"@skidpad/core": minor
"@skidpad/presets": minor
---

- physics: self-centring from the steering axis lift (ADR-0030). `steering.kingpinInclinationDeg` and `steering.casterDeg` (default 0) tilt the kingpin axis; each steered wheel adds `Fz · dh/dδ` to its kingpin torque, from the exact height of the turned wheel's lowest point. This gives the return to centre a parked or slow car has. It enters `SteeringTorque`, `RackForce` and the kingpin torque behind compliance steer. Zero angles run bit for bit as before. The presets' scripted-drive hashes change because the state holds the kingpin torque; their motion does not (none of them uses compliance steer).
- presets: the hatchback, crossover, pickup and sports car get typical inclination and caster angles.
