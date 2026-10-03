---
"@skidpad/core": minor
"@skidpad/worker": minor
---

Close a batch of API gaps found building a game on the packages:

- `world.setWheelSurface(vehicle, wheel, id)` sets the built-in ground's surface under one wheel, so two wheels on the grass no longer means the whole car is on the grass. The single-track model runs each axle on the mean of its wheels' surfaces. Also on `WorkerWorld`.
- `world.resetVehicle(vehicle, x, y, [dx, dy])` accepts a heading direction as well as a yaw angle; the core converts it with its own deterministic `atan2`. Also on `WorkerWorld`.
- `wheelPositionsView` is filled in by `addVehicle`, `resetVehicle`, `restore`, `setLod`, `setDefinition` and `setHostMode`, instead of reading zero until the first step and staying stale after a restore. `restore` now also rewrites the vehicle's telemetry, so its pose channels follow the restore immediately.
- `world.snapshotWorld()` / `restoreWorld(bytes)` snapshot every vehicle plus the step counter, and `world.setStepCount(n)` sets the counter, so `worldHash()` after a seek matches straight playback.
- Breaking: `Skidpad.version` is now the npm version of `@skidpad/core` (it reported the Rust crate's `0.1.0`). The crate version moved to `crateVersion`, and the new `simulationVersion` is a hash of the sources the WASM was built from: equal values simulate identically. Every package now exports `./package.json`.
- `@skidpad/core/compat` exports the same API as the main entry (it lacked `LodController`, `chooseLod`, `validateSurfaces`, `migrateLegacyDrive` and `InitOptions`); only `defaultWasmUrl` stays main-entry only. Its `init()` accepts `{ wasm }`.
- The main entry documents how to bundle a Node server (keep `@skidpad/core` external, use `/compat`, or pass `init({ wasm })`), and `VehicleInput.gear` documents how gear requests map onto an automatic.

physics: an automatic transmission without a reverse ratio (the kart preset) now treats a reverse request (`gear < 0`) as neutral; it used to drive forwards. No validation result moves.
