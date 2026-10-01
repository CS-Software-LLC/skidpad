# Babylon.js + Jolt example

A Babylon.js scene on Jolt Physics with Skidpad cars (milestone 7):

- **Your car** is a Jolt rigid body driven by the Skidpad four-wheel model
  through `@skidpad/jolt`. WASD or the arrows drive, Space is the handbrake,
  Q and E shift; drag to orbit, release to fall back to the chase camera.
- **Traffic**: 24 cars driven by the core's path-following driver
  (`World.setAi`) lap the track on the built-in host. A `LodController`
  moves them between the full four-wheel model (white), the single-track
  model (blue) and frozen (grey) by distance from the camera.
- **Ghost**: cross the start line twice and your best lap comes back as a
  translucent car (`@skidpad/replay`).

```sh
pnpm bootstrap                                   # once: core and packages
pnpm --filter @skidpad/example-babylon dev       # http://localhost:5173
```

Notes:

- Babylon is switched to a right-handed scene (`scene.useRightHandedSystem
= true`), the y-up convention the Jolt adapter expects; the adapter's
  `Frame` converts poses from the core's ISO frame for the traffic, which
  runs on the built-in host's flat ground at the same height as the Jolt
  ground.
- The traffic has no Jolt bodies, so your car drives through it. Giving each
  traffic car a kinematic Jolt body that follows its pose is the next step
  for a game.
- `jolt-physics` is imported in its `wasm-compat` build (WASM inlined), so no
  asset configuration is needed; the bundle is large for the same reason.
