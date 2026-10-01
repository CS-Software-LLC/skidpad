# ADR-0021: Replays as inputs plus keyframes, ghosts as pose tracks

- Status: Accepted
- Date: 2026-10-01
- Supersedes / superseded by: none

## Context

Milestone 7 asks for replays and ghosts. A replay lets a player watch a
race again from any camera and scrub through it; a ghost is a translucent
car showing a previous lap to race against. Both need to be small enough to
save and share, and the replay must look exactly like the original run.
The core is deterministic across engines (ADR-0001, ADR-0006) and has
versioned snapshots and state hashes, so the original run can be reproduced
by feeding the same inputs to the same core.

## Decision

A new package, `@skidpad/replay`, with two independent formats.

**Replays re-simulate.** `ReplayRecorder` wraps `world.step`: after each
step it records the step length and, per recorded vehicle, the six input
values the vehicle ran with (read back from the input record, so a
path-following driver's inputs are included, ADR-0020) and its level of
detail with its substep-rate override (ADR-0019). Every `keyframeEvery`
steps (default 600) and at the start it stores each vehicle's snapshot and
state hash. `ReplayPlayer` restores the first keyframe into a world holding
the same vehicles, then for each step writes the recorded inputs and level
and steps. At each keyframe it compares state hashes; on a mismatch it
restores the keyframe and counts a desync. Seeking restores the last
keyframe at or before the target and re-simulates the rest.

The keyframes make the format robust to what the recorder cannot see: a
reset, a restore, a definition or surface change in the recording world
leaves the playback at most one keyframe interval off, and the desync count
says so. A replay played on the core that recorded it reports zero.

**Ghosts are pose tracks.** `GhostRecorder` samples a vehicle's position,
yaw, pitch, roll, road-wheel steer and speed from its telemetry after each
step (or every n-th), as `Float32` frames with the time. `GhostPlayer`
interpolates the pose at any time (angles across the ±π wrap), with an
O(1) cursor for playback moving forward. A ghost needs no simulation, so
it costs nothing per frame beyond drawing and it survives core updates that
change the physics and would desync a replay.

Both encode to a binary container: a magic (`SKRP`, `SKGH`), a format
version, a JSON header describing the blocks, and 8-byte aligned
little-endian blocks. A replay stores 8 bytes per step plus 57 per vehicle
per step (inputs, level, rate) before compression; inputs that change
slowly compress several times with gzip.

## Alternatives considered

- **Recording poses for replays too.** Simple and core-independent, but a
  replay then shows only what was recorded: no wheel spin, suspension or
  telemetry, and a replay camera cannot ask for anything else. Ghosts take
  this route because they need nothing more.
- **Inputs only, no keyframes.** Smallest, but seeking means simulating
  from the start, and one unrecorded reset ruins the rest of the replay
  silently.
- **Snapshots every step.** 300 bytes per car per step against 57, for
  nothing a re-simulation does not already give.
- **Recording every world call (resets, definitions, surfaces) as events.**
  Complete, but every new world method would need a matching event, and
  applications call the world directly. Keyframes catch the same changes
  with no coupling.
- **Quantising inputs.** Would shrink a replay but change the simulation:
  the recorded inputs must be the exact values the core ran with.

## Consequences

- A replay is tied to its core version (stored in the header): a newer
  core with different physics plays it back with desyncs at every
  keyframe. Ghosts are not.
- The recording world's surface table, ground slopes, surface ids and host
  mode are the application's to reproduce; an externally hosted vehicle
  cannot be replayed by re-simulation (its contacts come from the host), but
  can be ghosted.
- Guarded by `packages/replay/test/replay.test.ts`: a three-car run with
  two path-following drivers and level changes replays with identical
  state hashes at every one of 1200 steps; seeks land on identical hashes;
  the binary format round-trips; a mismatched world desyncs and recovers.
