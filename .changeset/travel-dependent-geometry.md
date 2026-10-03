---
"@skidpad/core": minor
---

Suspension geometry that changes with travel (ADR-0026). An optional `suspension.kinematics` block carries piecewise-linear curves of toe, camber, roll-centre height, anti-brake and anti-drive against each wheel's travel (metres, positive in bump), as offsets from the static fields. Each curve has 2 to 16 points, is zero at zero travel, and is mirrored to the right wheel. Toe and camber curves are rejected on solid axles. The Rust and TypeScript validators give the same messages, and `evalTravelCurve` is exported. New telemetry: `Toe_FL` … `Toe_RR` and `JackingForce_F` / `JackingForce_R`. The core WASM budget rises from 200 KB to 224 KB gzipped.

- physics: an axle with a roll-centre curve takes each wheel's lateral force through its own link at its own roll-centre height, so unequal forces jack the body. Definitions without curves simulate bit for bit as before.
- physics: the hatchback, sports car, crossover, pickup (front) and open-wheeler presets carry illustrative roll-centre curves, and the road cars camber gain. The road cars understeer up to 5 % less; lane-change limits, braking distances and every stability result are unchanged. Golden results and the determinism laps of those presets are regenerated.
- physics: snapshot format version 5. Each wheel's previous lateral force is now part of the state, so every state hash changes. The golden scripted-drive hashes are regenerated, and no other validation result moves.
