# @skidpad/presets

Reference vehicle definitions and the surface table for
[`@skidpad/core`](https://www.npmjs.com/package/@skidpad/core). Every preset
carries a data sheet with its sources.

```ts
import { preset, presetIds, surfaceTable, surfaceId } from "@skidpad/presets";

const def = preset("sportsRwd"); // a copy, free to edit
world.addVehicle(def);
world.setSurfaces(surfaceTable());
world.setSurface(car, surfaceId("gravel"));
```

Presets: `hatchbackFwd`, `sportsRwd`, `kart`, `pickup4x4`, `crossoverEv`,
`openWheeler`. They are partial definitions (`PresetDefinition`: name and
chassis complete, the rest left to the core's defaults);
`sp.completeDefinition(def)` gives the full definition the core runs.

Assists: `sportsRwd` and `openWheeler` ship ABS, traction and stability
control on, `crossoverEv` traction control on; `hatchbackFwd`, `kart` and
`pickup4x4` ship none, so every assist is off. Set `assists` on a copy to
change that.

Guide: [vehicle definitions](https://cs-software-llc.github.io/skidpad/docs/guide/definitions),
[surfaces](https://cs-software-llc.github.io/skidpad/docs/concepts/surfaces).

License: MIT OR Apache-2.0.
