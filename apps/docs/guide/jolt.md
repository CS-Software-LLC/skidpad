# Driving a Jolt body

`@skidpad/jolt` is the [Jolt Physics](https://github.com/jrouwe/JoltPhysics.js)
counterpart of the [Rapier adapter](/guide/rapier): a Jolt rigid body is the
car, Jolt owns the scene, and Skidpad computes the tires, suspension and
drivetrain ([ADR-0023](https://github.com/csummers88/skidpad/blob/main/docs/adr/0023-jolt-host-adapter.md)).

```ts
import initJolt from "jolt-physics";
import { createChassisBody, JoltVehicle } from "@skidpad/jolt";

const Jolt = await initJolt();
const jolt = new Jolt.JoltInterface(settings); // your object and broad-phase layers
const def = preset("sportsRwd");
const car = world.addVehicle(def);
const body = createChassisBody(Jolt, jolt, def, { objectLayer: MOVING });
const host = new JoltVehicle(Jolt, jolt, world, car, body);

// each frame
host.beforeStep(); // body state in, wheel rays cast
world.step(dt);
host.afterStep(dt); // impulse out as a force and torque
jolt.Step(dt, 1);
```

The body gets the definition's mass and principal inertia and a box shape
that only collides. Jolt's default damping and sleeping are switched off, so
the only forces on the car are the core's, gravity and contacts. The wheel
rays query as the chassis body's object layer, so they hit whatever the
chassis would collide with, and skip the chassis itself.

Jolt is y-up by convention; the adapter converts to the core's ISO frame
(`up: "z"` for a z-up scene). In Babylon.js set
`scene.useRightHandedSystem = true` so Babylon's y-up frame matches.

`surfaceId(bodyId, bodyInterface)` maps the hit body to a surface id, for
example from its user data. The adapter allocates its Jolt objects once;
call `host.dispose()` to free them.

`examples/babylon` puts it together: a Babylon.js scene on Jolt with the
player's car on the adapter, traffic on the core's path-following driver
with level of detail, and a ghost of the best lap.
