# Sandbox visuals

Run `pnpm dev:sandbox` from the repository root. The default `hatchbackFwd`
preset has an original, unbranded hatchback with wheel arches, tapered cabin,
windows, lights, mirrors, trim, and five-spoke wheels. Other presets retain
primitive bodies until they have their own models.

- **Visuals: detailed / primitives** switches the car artwork and roadside props
  without resetting or changing the simulation.
- **Camera: straight behind / offset chase / front quarter** provides two driving
  views and a model inspection view. All follow the car. Straight behind is the
  default and restores the original framing: 8 m back, 2.6 m above the CG, looking
  3 m ahead, with no lateral offset.
- Cones, distance boards, and concrete barriers are decorative. The distance
  boards measure to the first bump at x = 36 m. The existing bumps, ramp, and
  kerb have collisions only under the Rapier host; their paint follows the same
  geometry and fades with them under the built-in host.

## Artwork and integration

`src/Hatchback.tsx` and `src/ProvingGround.tsx` contain the editable model source.
These are original procedural meshes, covered by the repository's
**MIT OR Apache-2.0** license, with no external assets, texture downloads, or
additional dependencies. This first model is generated directly in Three.js
rather than loaded from a fixed GLB so its wheel arches can follow live tuning.
Board textures are generated locally and disposed when unmounted.

The body uses metres with +X forward and +Y up. Its origin is the ground
projection of the CG at static ride height. `Scene.tsx` offsets it by `-cgHeight`
inside the simulated body group. Axle positions, track width, and tire radii
come from the vehicle definition. Tire width remains the renderer's existing
0.22 m convention. Extreme custom definitions can exceed the intended hatchback
proportions; primitive view is available for those cases.

Each wheel has a suspension/steering group and a nested spin group. The entire
tire, rim, and spokes rotate together using the interpolated simulation snapshot.
Visual changes do not alter mass, inertia, contact queries, or collision shapes.

## Local verification

```sh
pnpm --filter @skidpad/sandbox typecheck
pnpm --filter @skidpad/sandbox build
```

In the browser, check all three camera views, steering and wheel spin, primitive view,
preset changes, and wheel travel over the Rapier bumps and ramp. Also change
wheelbase and track width through Tuning to inspect geometry alignment.
