---
"@skidpad/replay": minor
---

Replays follow game logic and stay small:

- The recorder stores the surface under each wheel every step and the player re-applies it, so surface changes on the built-in host replay exactly instead of desyncing at the next keyframe.
- `ReplayPlayer` takes `beforeStep(step, world)`, to re-apply host-side logic before each step, and `onRestore(step, state)`, called on every keyframe restore with the application state the recorder's new `keyframeState` option captured, so seeking restores the game with the cars. The player also sets the world's step counter at each restore so `worldHash()` matches the recording (`followStepCount: false` to opt out).
- `new ReplayRecorder(world, sp)` stamps the replay with `simulationVersion` (a version string still works) and the recording's start step.
- Replay format version 2 stores the inputs as before (48 bytes per car per step) and step lengths, levels of detail and surfaces as runs; the docs said 48 bytes per step while version 1 used 66. Version 1 replays still decode and play. New `gzip` and `gunzip` helpers wrap `CompressionStream`.
- Ghosts: `GhostRecorder.restart()` starts a new lap with the current pose at time zero; `sliceGhost` rounds its bounds to the 32-bit frame times so boundary frames are no longer lost, and `sliceGhostFrames` slices by frame index; `ghostQuaternion(pose)` gives the core's quaternion, and the docs state the z-y-x angle order and when a frame's time is taken.
