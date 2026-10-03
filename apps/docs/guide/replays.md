# Replays and ghosts

`@skidpad/replay` records a run two ways
([ADR-0021](https://github.com/CS-Software-LLC/skidpad/blob/main/docs/adr/0021-replays-and-ghosts.md)):

- a **replay** re-simulates: it stores the inputs every car ran with and a
  full snapshot every few seconds, and plays back bit for bit on the same
  core, from any camera, with every telemetry channel;
- a **ghost** stores a pose track and plays back with no simulation at all,
  for racing against a previous lap.

## Recording and playing a replay

```ts
import { ReplayRecorder, ReplayPlayer, createReplayWorld, encodeReplay } from "@skidpad/replay";

const rec = new ReplayRecorder(world, sp, { definitions, keyframeEvery: 600 });
// each frame, instead of world.step(dt):
rec.step(dt);

const replay = rec.finish();
const bytes = await gzip(encodeReplay(replay)); // save or send

// later
const playback = createReplayWorld(sp, replay); // from the stored definitions
const player = new ReplayPlayer(playback, replay);
player.advance(); // one recorded step
player.seek(60 * 30); // jump to 30 s: restores the last keyframe and re-simulates
```

The recorder reads each car's inputs after the step, so what a
[path-following driver](/guide/scale#the-path-following-driver) applied is
recorded too; play back into a world without drivers. Level-of-detail
changes are recorded with the steps; pass the recorder to a
`LodController` (it forwards `setLod`) so their substep rates are recorded
as well.

The surface under each wheel is recorded every step too, so a game that
moves cars between surfaces on the built-in host (`setSurface`,
`setWheelSurface`) replays exactly. What a replay cannot see, such as a
reset, a restore or a ground-slope change in the recording world, is caught
at the next keyframe: the player compares state hashes there, restores the
keyframe on a mismatch and counts it in `player.desyncs`. A replay played
back on the core that recorded it reports zero.

Replays need the playback world set up like the recording one: the same
definitions, surface table and ground slopes. A car on an external host
(Rapier, Jolt) cannot be re-simulated without its host scene; record a
ghost for it instead.

### Game logic during playback

When the game itself changes the world as it runs (it tilts the ground,
resets a car that left the track), re-apply that logic in the player's
`beforeStep`, which runs after the recorded inputs and surfaces are written
and before each step. If the game keeps state of its own (lap timing, a
race clock), capture it at every keyframe with the recorder's
`keyframeState` and restore it in the player's `onRestore`, which runs
whenever the player restores a keyframe: at the start, on a seek and on a
re-sync. Seeking then restores the game along with the cars.

```ts
const rec = new ReplayRecorder(world, sp, { keyframeState: () => race.save() });
const player = new ReplayPlayer(playback, replay, {
  beforeStep: (step, world) => race.applyRules(world),
  onRestore: (step, state) => race.load(state),
});
```

The player also sets the world's step counter at every keyframe it
restores, so `worldHash()` after a seek matches the recording world
(`followStepCount: false` turns that off).

### Which core can play it

`replay.coreVersion` is the npm version of `@skidpad/core` that recorded
it, and `replay.simulationVersion` the core's `sp.simulationVersion`. A core
with the same `simulationVersion` reproduces the replay bit for bit; check it
before trusting a replay recorded elsewhere (a leaderboard server, say).

### Size

A replay stores the inputs as they are, 48 bytes per car per step, and the
data that rarely changes (step lengths, levels of detail, wheel surfaces) as
runs, plus a snapshot per car at every keyframe. `gzip` (on the platform's
`CompressionStream`) typically shrinks a replay four to five times;
`gunzip` undoes it.

## Ghosts

```ts
import { GhostRecorder, GhostPlayer, ghostQuaternion } from "@skidpad/replay";

const rec = new GhostRecorder(world, car, sp);
// after each step
rec.sample(dt);
// on the step that crosses the line
const lap = rec.finish();
rec.restart(); // the crossing pose becomes time zero of the next lap

const ghost = new GhostPlayer(lap);
const pose = ghost.poseAt(timeIntoLap); // x, y, z, yaw, pitch, roll, steer, speed
const [qx, qy, qz, qw] = ghostQuaternion(pose); // body to world, ISO frame
```

A frame's time is the time at the end of the step it follows. After
`restart()` the first frame is the pose at that moment, at time zero, so
ghost time `t` is exactly `t / dt` steps into the lap. Angles compose yaw
about z, then pitch, then roll (z-y-x), as the core's channels do;
`ghostQuaternion` does that for you. `sliceGhost(ghost, from, to)` cuts a
lap out of a longer ghost by time (rounding the bounds to the 32-bit frame
times, so boundary frames are kept), `sliceGhostFrames` by frame index.

A ghost costs an interpolation per frame and survives core updates that
would desync a replay. `encodeGhost` and `decodeGhost` save and load one.
Its poses are 32-bit floats and barely compress.
