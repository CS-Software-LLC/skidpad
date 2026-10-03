# @skidpad/rapier

Drives a [Rapier 3D](https://rapier.rs) rigid body with the
[`@skidpad/core`](https://www.npmjs.com/package/@skidpad/core) four-wheel
model, so a car drives on real geometry. Works with
`@dimforge/rapier3d-compat` and with the cross-platform deterministic
`@dimforge/rapier3d-deterministic-compat`; install either.

```ts
import RAPIER from "@dimforge/rapier3d-compat";
import { createChassisBody, RapierVehicle, surfaceIdsByHandle } from "@skidpad/rapier";

await RAPIER.init();
const scene = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const car = world.addVehicle(def);
const body = createChassisBody(RAPIER, scene, def);
const host = new RapierVehicle(RAPIER, world, car, body, scene, {
  surfaceId: surfaceIdsByHandle(surfaceByColliderHandle),
});
scene.step(); // once, so the first wheel rays can hit
// each frame
host.step(1 / 60);
scene.step();
```

Guide: [driving a Rapier body](https://cs-software-llc.github.io/skidpad/docs/guide/rapier).

License: MIT OR Apache-2.0.
