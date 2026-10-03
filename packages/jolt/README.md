# @skidpad/jolt

Drives a [Jolt Physics](https://github.com/jrouwe/JoltPhysics.js) body with
the [`@skidpad/core`](https://www.npmjs.com/package/@skidpad/core)
four-wheel model.

```ts
import { createChassisBody, JoltVehicle } from "@skidpad/jolt";

const body = createChassisBody(Jolt, jolt, def, { objectLayer: MOVING });
const host = new JoltVehicle(Jolt, jolt, world, car, body);
// each frame
host.step(1 / 60); // beforeStep, world.step, afterStep
jolt.Step(1 / 60, 1);
```

Guide: [driving a Jolt body](https://cs-software-llc.github.io/skidpad/docs/guide/jolt).

License: MIT OR Apache-2.0.
