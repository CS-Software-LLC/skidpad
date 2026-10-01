---
"@skidpad/core": minor
"@skidpad/replay": minor
"@skidpad/worker": minor
"@skidpad/jolt": minor
---

Milestone 7, scale. Core: per-vehicle level of detail (`setLod`: full,
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
