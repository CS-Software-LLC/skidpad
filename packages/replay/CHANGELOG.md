# @skidpad/replay

## 0.8.0

### Minor Changes

- 8a29959: Replays follow game logic and stay small:

  - The recorder stores the surface under each wheel every step and the player re-applies it, so surface changes on the built-in host replay exactly instead of desyncing at the next keyframe.
  - `ReplayPlayer` takes `beforeStep(step, world)`, to re-apply host-side logic before each step, and `onRestore(step, state)`, called on every keyframe restore with the application state the recorder's new `keyframeState` option captured, so seeking restores the game with the cars. The player also sets the world's step counter at each restore so `worldHash()` matches the recording (`followStepCount: false` to opt out).
  - `new ReplayRecorder(world, sp)` stamps the replay with `simulationVersion` (a version string still works) and the recording's start step.
  - Replay format version 2 stores the inputs as before (48 bytes per car per step) and step lengths, levels of detail and surfaces as runs; the docs said 48 bytes per step while version 1 used 66. Version 1 replays still decode and play. New `gzip` and `gunzip` helpers wrap `CompressionStream`.
  - Ghosts: `GhostRecorder.restart()` starts a new lap with the current pose at time zero; `sliceGhost` rounds its bounds to the 32-bit frame times so boundary frames are no longer lost, and `sliceGhostFrames` slices by frame index; `ghostQuaternion(pose)` gives the core's quaternion, and the docs state the z-y-x angle order and when a frame's time is taken.

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

### Patch Changes

- Updated dependencies [af4ad45]
  - @skidpad/core@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [9e42f48]
  - @skidpad/core@0.6.0

## 0.5.0

### Minor Changes

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
