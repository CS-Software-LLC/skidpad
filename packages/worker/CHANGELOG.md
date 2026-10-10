# @skidpad/worker

## 0.8.0

### Minor Changes

- a69723f: Close a batch of API gaps found building a game on the packages:

  - `world.setWheelSurface(vehicle, wheel, id)` sets the built-in ground's surface under one wheel, so two wheels on the grass no longer means the whole car is on the grass. The single-track model runs each axle on the mean of its wheels' surfaces. Also on `WorkerWorld`.
  - `world.resetVehicle(vehicle, x, y, [dx, dy])` accepts a heading direction as well as a yaw angle; the core converts it with its own deterministic `atan2`. Also on `WorkerWorld`.
  - `wheelPositionsView` is filled in by `addVehicle`, `resetVehicle`, `restore`, `setLod`, `setDefinition` and `setHostMode`, instead of reading zero until the first step and staying stale after a restore. `restore` now also rewrites the vehicle's telemetry, so its pose channels follow the restore immediately.
  - `world.snapshotWorld()` / `restoreWorld(bytes)` snapshot every vehicle plus the step counter, and `world.setStepCount(n)` sets the counter, so `worldHash()` after a seek matches straight playback.
  - Breaking: `Skidpad.version` is now the npm version of `@skidpad/core` (it reported the Rust crate's `0.1.0`). The crate version moved to `crateVersion`, and the new `simulationVersion` is a hash of the sources the WASM was built from: equal values simulate identically. Every package now exports `./package.json`.
  - `@skidpad/core/compat` exports the same API as the main entry (it lacked `LodController`, `chooseLod`, `validateSurfaces`, `migrateLegacyDrive` and `InitOptions`); only `defaultWasmUrl` stays main-entry only. Its `init()` accepts `{ wasm }`.
  - The main entry documents how to bundle a Node server (keep `@skidpad/core` external, use `/compat`, or pass `init({ wasm })`), and `VehicleInput.gear` documents how gear requests map onto an automatic.

  physics: an automatic transmission without a reverse ratio (the kart preset) now treats a reverse request (`gear < 0`) as neutral; it used to drive forwards. No validation result moves.

- 875ff5b: Every package now ships a README (install, a minimal example, links to the guide), so the npm pages are no longer empty; the core's covers bundling a Node server.

  Breaking (types only): `World.read` and `WorkerWorld.read` take a `ChannelName`, the union of every telemetry channel name, so a typo such as `"Speeed"` fails to compile instead of throwing at runtime; `readAll` returns `Record<ChannelName, number>`. `CHANNEL_NAMES` lists them at runtime. Per-wheel names compose from `WHEEL_ORDER` (`` `SlipRatio_${WHEEL_ORDER[i]}` ``); a name held in a plain `string` needs a `ChannelName` type, or use `sp.channel(name)` and `telemetryView` to probe.

- d61b245: `WorkerWorld.lodTarget` is a synchronous `LodTarget`, so a `LodController` can drive a worker world: it keeps each vehicle's level locally, sends changes without waiting, and follows `restore`. `WorkerWorld.lod()` and `restore()` keep the local levels up to date. The `LodController` doc example now matches its signature (`pin()` the player's car, `update(distance)`), and the worker guide explains why Rapier- and Jolt-hosted cars cannot run in a `WorkerWorld`.

### Patch Changes

- 87b7e22: Fix `import "@skidpad/worker/entry"` doing nothing in production builds. The package declared `"sideEffects": false`, so bundlers dropped the side-effect-only import of the entry and the worker chunk came out empty, leaving `WorkerWorld.create` waiting forever. The entry is now listed as the package's one module with side effects, and a test bundles the documented usage with esbuild.
- Updated dependencies [a69723f]
- Updated dependencies [4365732]
- Updated dependencies [df5031b]
- Updated dependencies [5f88288]
- Updated dependencies [446d725]
- Updated dependencies [875ff5b]
- Updated dependencies [78cd842]
- Updated dependencies [f48a141]
- Updated dependencies [a69723f]
- Updated dependencies [d61b245]
  - @skidpad/core@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [af4ad45]
  - @skidpad/core@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [9e42f48]
  - @skidpad/core@0.6.0

## 0.5.0

### Minor Changes

- 7cec8a8: Milestone 7, scale. Core: per-vehicle level of detail (`setLod`: full,
  single-track, frozen, with a substep-rate override) that carries a car's
  motion across a model switch, `stepMany` for batched stepping, and a
  path-following driver inside the step (`setAi`, `aiStatus`, `clearAi`) with
  a curvature and braking speed profile; `LodController` picks levels by
  distance with hysteresis. A snapshot of the other model restores by
  switching to it. WASM ABI version 5. New packages: `@skidpad/replay`
  (deterministic replays as inputs plus keyframes, seekable, and pose-track
  ghosts, with binary formats), `@skidpad/worker` (a world in a Web Worker or
  Node worker thread), and `@skidpad/jolt` (Jolt Physics host adapter). A
  Babylon.js example on Jolt.

### Patch Changes

- 375b78b: Every `@skidpad/*` package now releases at one shared version. The packages
  that build on `@skidpad/core` depend on it with a caret range (`^0.5.0`)
  instead of an exact version, so an app's own `@skidpad/core` is shared rather
  than installed twice.
- Updated dependencies [e578005]
- Updated dependencies [c9afbb2]
- Updated dependencies [8502c19]
- Updated dependencies [7cec8a8]
- Updated dependencies [43ef906]
  - @skidpad/core@0.5.0
