# @skidpad/core

Deterministic, sim-grade vehicle physics for the web: a Rust core compiled to
WebAssembly, with a TypeScript API. Slip-based tires, a coupled drivetrain,
suspension, assists and a path-following driver, bit-identical in every
browser engine and in Node.

```sh
npm install @skidpad/core @skidpad/presets
```

```ts
import { init, WHEEL_ORDER } from "@skidpad/core";
import { preset } from "@skidpad/presets";

const sp = await init(); // loads the WASM; call once and share
const world = sp.createWorld(1);
const car = world.addVehicle(preset("hatchbackFwd"));
world.setInput(car, { throttle: 1, steer: 0.2 }); // gear: see VehicleInput.gear
world.step(1 / 60); // substeps at 1 kHz inside
world.read(car, "Speed"); // channel names are checked at compile time
world.read(car, `SlipRatio_${WHEEL_ORDER[0]}`);
```

- **Channels.** `sp.telemetryLayout` lists every channel with its unit;
  `CHANNEL_NAMES` and the `ChannelName` type are the same list. Per-wheel
  channels end in `_FL`, `_FR`, `_RL`, `_RR` (`WHEEL_ORDER`).
- **Frame.** ISO axes: x forward, y left, z up.
- **Versions.** `sp.version` is this package's version; `sp.simulationVersion`
  identifies the simulation itself (equal values replay bit for bit).
- **Bundling.** Vite and Node load the WASM with no configuration. A bundled
  Node server (esbuild, say) should keep `@skidpad/core` external, or import
  `@skidpad/core/compat` (the same API with the WASM inlined), or pass
  `init({ wasm })` the path of a copy of `@skidpad/core/wasm`.

Guide: [getting started](https://cs-software-llc.github.io/skidpad/docs/guide/getting-started),
[vehicle definitions](https://cs-software-llc.github.io/skidpad/docs/guide/definitions),
[determinism contract](https://cs-software-llc.github.io/skidpad/docs/guide/determinism-contract),
[many cars](https://cs-software-llc.github.io/skidpad/docs/guide/scale). Source and issues:
[CS-Software-LLC/skidpad](https://github.com/CS-Software-LLC/skidpad).

License: MIT OR Apache-2.0.
