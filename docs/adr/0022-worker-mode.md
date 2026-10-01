# ADR-0022: Worker mode by message passing, inputs out and telemetry back

- Status: Accepted
- Date: 2026-10-01
- Supersedes / superseded by: none

## Context

A browser game's main thread renders, handles input and runs the
application; a field of cars at a kilohertz substep rate can take
milliseconds a frame that the main thread cannot spare. WebAssembly runs
in a Web Worker unchanged, so the simulation can move off the main thread,
but the application still needs to set inputs every frame and read poses
for rendering every frame, and must not be forced into
`SharedArrayBuffer`, which needs cross-origin isolation headers many hosts
cannot set.

## Decision

A new package, `@skidpad/worker`. Inside the worker, `serveWorld(endpoint)`
(or the one-line `@skidpad/worker/entry`) loads the core and answers a small
request protocol; on the main thread, `WorkerWorld.create(worker)` returns
a proxy with the world's API.

- **Inputs are local and synchronous.** `setInput` writes a local copy of
  the input buffer, which is copied into each step request.
- **A step answers with the whole telemetry buffer** (and the inputs the
  vehicles ran with, so a path-following driver's are visible), transferred
  rather than copied. Reads (`read`, `telemetryView`, `readAll`) are
  synchronous against the last answer.
- **Everything else is a request** (`addVehicle`, `setLod`, `setAi`,
  `snapshot`, …), answered in order with a promise; core errors come back as
  `SkidpadError`s with the core's status code.
- **Requests run strictly in order** with the inputs as they were when
  asked, so a worker world produces the same state hashes as a main-thread
  world given the same calls. The application chooses lock-step (await
  each step) or a pipeline (keep one step in flight and render the last
  answer, one frame behind, never stalling).
- `nodeEndpoint` adapts Node's `worker_threads` for servers and Electron.

The external host contract (ADR-0002) is not carried over: a host's rigid
bodies live on the thread that steps them, so a Rapier or Jolt scene would
move into the worker with the world, which this package does not do yet.

## Alternatives considered

- **SharedArrayBuffer for inputs and telemetry.** No copies and no
  message per step, but it requires cross-origin isolation (COOP/COEP
  headers), which breaks many embeds and hosts (GitHub Pages among them).
  It can be added later as an option behind the same API.
- **A generic RPC layer (Comlink).** Every call becomes asynchronous,
  including per-frame `setInput` and telemetry reads, and it adds a
  dependency for little the hand-written protocol lacks.
- **Running the worker on its own clock** (a fixed-rate loop in the worker
  posting state). Decouples from the frame rate, but the application then
  cannot control which inputs land in which step, which a replay or a
  lock-step multiplayer needs. The caller-driven step keeps that control.

## Consequences

- The main thread pays a copy of the input buffer and a transfer of the
  telemetry buffer per step: for 200 cars about 160 KB, well under a
  millisecond.
- Pipelined use renders one frame behind the simulation.
- Guarded by `packages/worker/test/worker.test.ts`: a three-car world with a
  driver and a level change over a message channel matches a main-thread
  world's hashes and telemetry exactly, pipelined steps resolve in order,
  and a real worker thread agrees with the main thread.
