---
"@skidpad/presets": minor
"@skidpad/rapier": minor
"@skidpad/jolt": minor
"@skidpad/core": minor
---

Definitions are typed for what they are:

- Breaking (types only): `presets.*` and `preset()` are typed as `PresetDefinition`, a partial definition with a complete `name` and `chassis`, instead of a full `VehicleDefinition` they never were (no preset carries static toe or per-axle track widths, and `hatchbackFwd`, `kart` and `pickup4x4` carry no `assists`, so every assist is off on them). Reading `preset("kart").assists.abs` no longer type-checks and then throws. The package docs list which presets ship which assists.
- `sp.completeDefinition(def)` returns a partial definition completed with the core's defaults exactly as `addVehicle` reads it.
- `createChassisBody` in `@skidpad/rapier` and `@skidpad/jolt` takes a partial definition and reads the chassis sizes it needs, with an error pointing at `completeDefinition` when one is missing.
- `@skidpad/rapier` types Rapier structurally, so `@dimforge/rapier3d-deterministic-compat` works without a cast and without installing the standard build; both are optional peer dependencies. `surfaceIdsByHandle(map)` builds the `surfaceId` callback from a collider-handle map, and the option's docs no longer suggest collider user data, which Rapier colliders do not have.
