# Worker mode

`@skidpad/worker` runs a world in a Web Worker so the simulation does not
compete with rendering on the main thread
([ADR-0022](https://github.com/csummers88/skidpad/blob/main/docs/adr/0022-worker-mode.md)).

```ts
// sim.worker.ts
import "@skidpad/worker/entry";
```

```ts
// main.ts
import { WorkerWorld } from "@skidpad/worker";

const worker = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
const world = await WorkerWorld.create(worker, { capacity: 50 });
const car = await world.addVehicle(preset("sportsRwd"));

function frame() {
  world.setInput(car, input.update(1 / 60)); // synchronous, local
  if (world.stepsInFlight === 0) void world.step(1 / 60);
  draw(world.read(car, "PosX"), world.read(car, "PosY")); // last answer
  requestAnimationFrame(frame);
}
```

Inputs are written locally and travel with each step request; the worker
answers each step with the whole telemetry buffer, so reads are synchronous.
Everything else (`addVehicle`, `setLod`, `setAi`, `snapshot`, …) returns a
promise. Steps run in the order they are asked for, with the inputs as they
were when asked, so a worker world gives the same state hashes as a
main-thread one.

Two ways to drive it:

- **Lock-step**: `await world.step(dt)` each frame. Simple; the frame waits
  for the simulation.
- **Pipelined**: keep one step in flight and draw the last answer, as
  above. The picture is one step behind and the main thread never waits.

It needs no `SharedArrayBuffer`, so no cross-origin isolation headers. In
Node and Electron, `nodeEndpoint(worker)` adapts `worker_threads`.

External hosts (Rapier, Jolt) are not carried over: their bodies live on
the thread that steps them. Run them in the worker with the world, or keep
the world on the main thread.
