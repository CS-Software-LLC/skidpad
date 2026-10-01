# Replays and ghosts

`@skidpad/replay` records a run two ways
([ADR-0021](https://github.com/csummers88/skidpad/blob/main/docs/adr/0021-replays-and-ghosts.md)):

- a **replay** re-simulates: it stores the inputs every car ran with and a
  full snapshot every few seconds, and plays back bit for bit on the same
  core, from any camera, with every telemetry channel;
- a **ghost** stores a pose track and plays back with no simulation at all,
  for racing against a previous lap.

## Recording and playing a replay

```ts
import { ReplayRecorder, ReplayPlayer, createReplayWorld, encodeReplay } from "@skidpad/replay";

const rec = new ReplayRecorder(world, sp.version, { definitions, keyframeEvery: 600 });
// each frame, instead of world.step(dt):
rec.step(dt);

const replay = rec.finish();
const bytes = encodeReplay(replay); // save or send; gzip it, inputs compress well

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

What a replay cannot see, such as a reset, a restore or a surface change in
the recording world, is caught at the next keyframe: the player compares
state hashes there, restores the keyframe on a mismatch and counts it in
`player.desyncs`. A replay played back on the core that recorded it reports
zero.

Replays need the playback world set up like the recording one: the same
definitions, surface table, ground slopes and surface ids. A car on an
external host (Rapier, Jolt) cannot be re-simulated without its host scene;
record a ghost for it instead.

## Ghosts

```ts
import { GhostRecorder, GhostPlayer, sliceGhost } from "@skidpad/replay";

const rec = new GhostRecorder(world, car, sp);
// after each step
rec.sample(dt);

const lap = sliceGhost(rec.finish(), lapStart, lapEnd);
const ghost = new GhostPlayer(lap);
const pose = ghost.poseAt(timeIntoLap); // x, y, z, yaw, pitch, roll, steer, speed
```

A ghost costs an interpolation per frame and survives core updates that
would desync a replay. `encodeGhost` and `decodeGhost` save and load one.
