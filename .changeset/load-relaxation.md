---
"@skidpad/core": minor
"@skidpad/presets": minor
---

- core: the lateral relaxation length can follow the tire's load (ADR-0038): the feel tire's `lateralRelaxationFollowsLoad` scales `relaxationLengthLat` with the cornering stiffness, and a Magic Formula tire with `PTY1` and `PTY2` (now read from `.tir` files) uses the MF 5.2 form. Both are off by default; definitions without them run as before.
- physics: presets: the hatchback, crossover, pickup and sports car turn `lateralRelaxationFollowsLoad` on. Step-steer yaw overshoot falls a little (hatchback 4.1 → 3.5 %, pickup 2.4 → 1.9 %); response times, gradients and lane-change pass speeds are unchanged.
