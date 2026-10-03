# @skidpad/worker

Runs a [`@skidpad/core`](https://www.npmjs.com/package/@skidpad/core) world
in a Web Worker (or a Node worker thread) and drives it from the main
thread, with synchronous reads of the last answer.

```ts
// sim.worker.ts
import "@skidpad/worker/entry";

// main.ts
import { WorkerWorld } from "@skidpad/worker";
const worker = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
const world = await WorkerWorld.create(worker, { capacity: 50 });
const car = await world.addVehicle(def);
// each frame
world.setInput(car, { throttle: 1 });
if (world.stepsInFlight === 0) void world.step(1 / 60);
world.read(car, "PosX"); // last answer
```

A `LodController` drives it through `world.lodTarget`. Only built-in-host
vehicles run in a worker; Rapier- and Jolt-hosted cars stay on the thread
that owns their scene.

Guide: [worker mode](https://cs-software-llc.github.io/skidpad/docs/guide/worker).

License: MIT OR Apache-2.0.
