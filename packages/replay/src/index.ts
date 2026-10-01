/**
 * @skidpad/replay — deterministic replays and lightweight ghosts.
 *
 * A **replay** records the inputs every vehicle ran with plus periodic
 * full-state keyframes, and plays back by re-simulating: bit-exact on the
 * same core, seekable, and small (48 bytes per car per step before
 * compression). A **ghost** records a pose track and plays back with no
 * simulation: cheap to draw, and it survives core updates.
 *
 * ```ts
 * import { ReplayRecorder, ReplayPlayer, GhostRecorder, GhostPlayer } from "@skidpad/replay";
 *
 * const rec = new ReplayRecorder(world, sp.version);
 * const ghost = new GhostRecorder(world, car, sp);
 * // each frame
 * rec.step(1 / 60);       // instead of world.step
 * ghost.sample(1 / 60);
 *
 * const replay = rec.finish();
 * const player = new ReplayPlayer(otherWorld, replay);
 * player.advance();       // one recorded step
 * player.seek(1800);      // jump to 30 s
 *
 * const lap = new GhostPlayer(ghost.finish());
 * const pose = lap.poseAt(12.5);
 * ```
 */
export * from "./replay.js";
export * from "./ghost.js";
export * from "./codec.js";
