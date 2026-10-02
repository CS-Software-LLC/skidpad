# Sandbox visuals

Run `pnpm dev:sandbox` from the repository root. Each preset has an original,
unbranded model with dimensions driven by its vehicle definition:

| Preset         | Artwork                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------- |
| `hatchbackFwd` | Orange hatchback, tapered cabin, mirrors, lights, five-spoke alloys                           |
| `sportsRwd`    | Blue sports coupe, low roof, bonnet stripes, vents, splitter, twin exhausts                   |
| `kart`         | Yellow kart, red tube frame, exposed engine and rear axle, bucket seat, small slicks          |
| `pickup4x4`    | Sand-colored pickup, open ribbed bed, wheel tubs, side steps, tow hitch, treaded tires        |
| `crossoverEv`  | Pale electric crossover, dark roof, roof rails, light bars, aerodynamic wheels                |
| `openWheeler`  | White/teal single-seater, open cockpit, roll hoop, wings, suspension links, wider rear slicks |

- **Visuals: detailed / primitives** switches the car artwork and roadside props
  without resetting or changing the simulation.
- **Camera: straight behind / offset chase / front quarter** provides two driving
  views and a model inspection view. All follow the car. Straight behind is the
  default and retains the original framing: 8 m back, 2.6 m above the CG, looking
  3 m ahead, with no lateral offset. Front-quarter distance scales with wheelbase
  to frame the small kart and large pickup.
- Cones, distance boards, and concrete barriers are decorative. The distance
  boards measure to the first bump at x = 36 m. The existing bumps, ramp, and
  kerb have collisions only under the Rapier host; their paint follows the same
  geometry and fades with them under the built-in host.

## Artwork and integration

`src/Hatchback.tsx`, `src/models/`, and `src/ProvingGround.tsx` contain the editable
model source. These are original procedural meshes, covered by the repository's
**MIT OR Apache-2.0** license, with no external assets, texture downloads, or
additional dependencies. Models are generated directly in Three.js so their
wheel arches and chassis proportions can follow live tuning. Board textures
are generated locally and disposed when unmounted.

The bodies use metres with +X forward and +Y up. Their origin is the ground
projection of the CG at static ride height. `Scene.tsx` offsets each by
`-cgHeight` inside the simulated body group. Axle positions, per-axle track
widths, and tire radii come from the vehicle definition. Visual tire widths and
wheel styles are defined in `src/models/types.ts`; these are artwork choices,
not additional tire-contact parameters. Extreme custom definitions can exceed
the intended vehicle proportions; primitive view remains available.

Each wheel has a suspension/steering group and a nested spin group. The entire
tire, rim, and spokes rotate together using the interpolated simulation snapshot.
The kart and single-seater steering wheels also animate. The single-seater's
illustrative suspension links follow the wheel hubs' vertical travel; they do
not represent a solved suspension linkage. The car updates its snapshot at frame
priority -1 so these details consume the same frame's pose before rendering.
Visual changes do not alter mass, inertia, contact queries, or collision shapes.

## Local verification

```sh
pnpm --filter @skidpad/sandbox typecheck
pnpm --filter @skidpad/sandbox build
```

In the browser, check every preset in all three camera views, steering and wheel
spin, primitive view, and wheel travel over the Rapier bumps and ramp. Change
wheelbase and per-axle track width through Tuning to inspect geometry alignment.
