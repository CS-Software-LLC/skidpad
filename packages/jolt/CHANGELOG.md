# @skidpad/jolt

## 0.9.0

### Patch Changes

- Updated dependencies [e678655]
- Updated dependencies [ad29b23]
  - @skidpad/core@0.9.0

## 0.8.0

### Minor Changes

- 446d725: Definitions are typed for what they are:

  - Breaking (types only): `presets.*` and `preset()` are typed as `PresetDefinition`, a partial definition with a complete `name` and `chassis`, instead of a full `VehicleDefinition` they never were (no preset carries static toe or per-axle track widths, and `hatchbackFwd`, `kart` and `pickup4x4` carry no `assists`, so every assist is off on them). Reading `preset("kart").assists.abs` no longer type-checks and then throws. The package docs list which presets ship which assists.
  - `sp.completeDefinition(def)` returns a partial definition completed with the core's defaults exactly as `addVehicle` reads it.
  - `createChassisBody` in `@skidpad/rapier` and `@skidpad/jolt` takes a partial definition and reads the chassis sizes it needs, with an error pointing at `completeDefinition` when one is missing.
  - `@skidpad/rapier` types Rapier structurally, so `@dimforge/rapier3d-deterministic-compat` works without a cast and without installing the standard build; both are optional peer dependencies. `surfaceIdsByHandle(map)` builds the `surfaceId` callback from a collider-handle map, and the option's docs no longer suggest collider user data, which Rapier colliders do not have.

### Patch Changes

- 875ff5b: Every package now ships a README (install, a minimal example, links to the guide), so the npm pages are no longer empty; the core's covers bundling a Node server.

  Breaking (types only): `World.read` and `WorkerWorld.read` take a `ChannelName`, the union of every telemetry channel name, so a typo such as `"Speeed"` fails to compile instead of throwing at runtime; `readAll` returns `Record<ChannelName, number>`. `CHANNEL_NAMES` lists them at runtime. Per-wheel names compose from `WHEEL_ORDER` (`` `SlipRatio_${WHEEL_ORDER[i]}` ``); a name held in a plain `string` needs a `ChannelName` type, or use `sp.channel(name)` and `telemetryView` to probe.

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
