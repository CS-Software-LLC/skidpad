# Worker mode

`@skidpad/worker` runs a world in a Web Worker so the simulation does not
compete with rendering on the main thread
([ADR-0022](https://github.com/CS-Software-LLC/skidpad/blob/main/docs/adr/0022-worker-mode.md)).

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

When frames are slow, count the host steps owed and send them as one
`world.step(dt, count)` rather than dropping steps, so the worker keeps
real time.

## Level of detail

`WorkerWorld.lod()` answers asynchronously, so a `LodController` cannot
read it directly. Pass the world's `lodTarget` instead: it keeps each
vehicle's level locally, sends changes to the worker without waiting
(they apply before the next step) and follows `restore`.

```ts
const lod = new LodController(world.lodTarget, { singleTrackBeyond: 80 });
lod.update((car) => distanceToCamera(car));
```

## External hosts stay on their own thread

A `WorkerWorld` only hosts vehicles on the built-in flat host. The worker
protocol does not carry the external-host calls (`setHostMode`,
`writeHostBody`, `writeWheelContact`, `readHostImpulse`), and
`RapierVehicle` and `JoltVehicle` need a synchronous `World` next to the
physics scene, so a Rapier- or Jolt-hosted car must run on the thread that
owns that scene. Two layouts work:

- Keep the scene, the hosted cars and their `World` on the main thread, and
  put built-in-host traffic in a `WorkerWorld` (mirrored into the scene as
  kinematic bodies if the player should be able to hit it).
- Move everything off the main thread by writing your own worker that
  creates the physics scene, a plain `World` and the `RapierVehicle`s, and
  posts poses back; `serveWorld` does not do this for you.

## Bundling

`import "@skidpad/worker/entry"` is a side-effect-only import; the package
marks `dist/entry.js` as having side effects so production bundlers keep it.
If your bundler still drops it, call `serveWorld(self)` in the worker
yourself.
