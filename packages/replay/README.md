# @skidpad/replay

Deterministic replays and lightweight ghosts for
[`@skidpad/core`](https://www.npmjs.com/package/@skidpad/core). A replay
records inputs and keyframes and re-simulates bit for bit (seekable); a
ghost records a pose track and plays back with no simulation.

```ts
import {
  ReplayRecorder,
  ReplayPlayer,
  createReplayWorld,
  encodeReplay,
  gzip,
} from "@skidpad/replay";

const rec = new ReplayRecorder(world, sp, { definitions: [def] });
rec.step(1 / 60); // instead of world.step
const bytes = await gzip(encodeReplay(rec.finish()));

const player = new ReplayPlayer(createReplayWorld(sp, replay), replay, {
  beforeStep: (step, world) => game.applyRules(world), // host-side logic
  onRestore: (step, state) => game.load(state), // on seeks
});
player.seek(60 * 30);
```

Per-wheel surfaces are recorded and re-applied. A replay is about 48 bytes
per car per step plus keyframes before `gzip`.

Guide: [replays and ghosts](https://cs-software-llc.github.io/skidpad/docs/guide/replays).

License: MIT OR Apache-2.0.
