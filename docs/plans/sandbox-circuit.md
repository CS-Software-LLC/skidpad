# Plan: a circuit in the sandbox

A task brief for Claude Code. Read it whole before starting. It says what to
build and why, which files are involved, the decisions already made, and what
"done" means. It deliberately does not give the code.

## Goal

Add a second map to the sandbox: an original road circuit of about 2.5 km
with real elevation, kerbs, grass and gravel runoff that change grip under
each wheel, barriers the car can hit, lap and sector timing, and a ghost of
the best lap. Every preset can be driven on it, with every input device the
sandbox already supports. The existing proving ground (loop ribbon, skidpad,
bumps, ramp, kerb) stays as it is, selectable from the same menu.

## Why

The sandbox is where Skidpad gets driven; the proving ground is flat, short
and has nothing to aim at. A circuit with crests, compressions, banking and
braking zones exercises what the core models and the proving ground never
asks for: pitch and heave over crests, load transfer under trail braking,
the suspension over kerbs, surfaces changing under one wheel at a time, and
the tires at the limit for a whole lap. Lap times and a ghost make
differences between presets, setups and assists visible and repeatable,
which makes the sandbox a tuning tool rather than a toy.

## Read first

- `apps/sandbox/src/sim.ts`: the simulation loop, the two hosts, how the
  Rapier world is built (`buildScene`), how the chassis body and
  `RapierVehicle` are created (`rebuildRapierBody`), and how colliders map
  to surface ids (the ground takes the selected surface, the kerb obstacle
  `kerb`).
- `apps/sandbox/src/track.ts`, `Scene.tsx`, `ProvingGround.tsx`: the
  current map, its coordinate convention (three.js, y up; the core's ISO
  frame maps as (x, y, z) → (x, z, −y)), the follow-the-car shadow light,
  the fog, and the camera views.
- `apps/sandbox/src/App.tsx`: the menus (preset, surface, host), the HUD
  that reads telemetry at 10 Hz, and the recording buttons.
- `packages/rapier/src/index.ts`: `RapierVehicle`'s raycast contact, the
  `surfaceId(collider)` callback and `surfaceIdsByHandle`; per-wheel
  surfaces come from whichever collider each wheel's ray hits.
- `packages/presets/src/index.ts`: the surface table (`asphaltDry`,
  `kerb`, `grass`, `gravel`, `sand` and the rest) and `surfaceId()`.
- `packages/replay/src/ghost.ts` and `codec.ts`: `GhostRecorder` (note
  `restart()` for lining a ghost up with a lap clock), `GhostPlayer`,
  `ghostQuaternion`, `encodeGhost`/`decodeGhost`, `gzip`.
- `docs/adr/0009-raycast-suspension-and-host-contract.md`,
  `0014-surface-table.md`, `0021-replays-and-ghosts.md`,
  `0024-finite-suspension-rays.md`.
- `FRICTION.md`, entries on ghosts (F-17, F-18, F-20): what tripped up the
  last lap-timing and ghost implementation built on these packages.

## Decisions already made

- **Original layout, not a replica** of any real circuit: no names, logos
  or traced geometry.
- **Elevation is real geometry.** The circuit exists only under the Rapier
  host. Choosing it switches the host to Rapier; choosing the built-in host
  while on the circuit switches back to the proving ground. The menu says so.
- **One pure, renderer-free track module** is the single source of truth.
  It takes the circuit description (below) and produces plain typed arrays:
  vertices and indices per surface kind, barrier placements, gate lines, the
  sampled centreline with its distance along the lap, and spawn poses. The
  renderer builds `BufferGeometry` from it, `sim.ts` builds Rapier trimesh
  colliders from it. No three.js or Rapier imports in that module, so it is
  testable under Node and cannot drift between what is drawn and what is
  driven on.
- **The circuit description is data:** a closed list of control points,
  each with position, elevation, track width, banking angle, and optional
  per-side runoff kind and width (grass, gravel, kerb or none) and barrier
  kind. A smooth closed spline through them (centripetal Catmull-Rom, as the
  proving ground uses) gives the centreline; elevation, width and banking
  are interpolated the same way, so grades and banking change smoothly.
- **Surfaces are separate colliders.** Asphalt, kerbs, grass and gravel are
  each their own trimesh (or set of trimeshes), registered with
  `surfaceIdsByHandle` against the preset surface table. The circuit
  ignores the sandbox's surface menu except that the menu's choice replaces
  the asphalt (so "wet asphalt" makes a wet circuit); runoff keeps its own
  surfaces. Gravel traps use `gravel`; consider `sand` only if gravel does
  not slow cars enough to be a deterrent.
- **Seams are watertight.** Neighbouring ribbons (asphalt to kerb to grass)
  share the same edge vertices, so a wheel ray never falls through a crack
  or catches a step. Kerbs are raised a few centimetres with a sloped inner
  face, low enough that the kart and the open-wheeler can ride them.
- **Terrain beyond the runoff** is one heightfield (or trimesh) whose height
  follows the nearest track edge and eases to a base level far from the
  track, so a car that clears a barrier gap lands on ground, not into the
  void. It takes the `grass` surface.
- **Barriers are Rapier colliders**, placed along the outer edge of the
  runoff on the sides the description marks: concrete wall and tyre-stack
  segments as fixed cuboids following the edge, with no gaps a car can wedge
  in. They rely on the chassis collider `createChassisBody` already makes; no
  new contact code in the core.
- **Lap timing is deterministic.** It counts simulation steps, not
  wall-clock time, and interpolates the crossing within the step from the
  car's position before and after. Three gates: start/finish and two sector
  lines, each a segment across the track with a forward direction. A lap
  counts only if the gates are crossed in order, forwards. It is marked
  invalid (still timed, shown struck through) if all four wheels are off
  asphalt and kerb at once, read from the per-wheel `SurfaceId_*` telemetry
  channels, or after a reset.
- **Live delta by distance, not time.** The best lap stores elapsed time
  against distance along the centreline; the live delta compares the current
  lap at the same distance. Project the car onto the sampled centreline
  incrementally (search near the last index), never with a full scan.
- **The ghost is the best valid lap of the current preset.** Recorded with
  `GhostRecorder`, restarted at the start/finish crossing, kept only if the
  lap is valid and faster. Drawn as a translucent copy of that preset's own
  model. Best lap, sector times and ghost persist per preset in
  `localStorage` (encoded and gzipped; every access in try/catch, and the
  sandbox works without it). A button clears them.
- **Reset on the circuit** puts the car back on the centreline at the
  nearest point, facing along the lap, a little above the surface, and
  invalidates the current lap. A second key or button returns to the grid.
- **Grid spawn** is a few metres behind the start/finish line, so the first
  lap starts with a flying crossing from a short run-up; the first crossing
  starts the clock.

## The layout

Aim for about 2.5 km, 9–12 m wide, run clockwise, with a character that
rewards a good setup. A suggested sequence; adjust while driving it:

1. Start/finish straight, about 600 m, gently downhill, so every preset
   reaches its top gears.
2. Turn 1: a heavy-braking hairpin at the bottom of the hill, wide on entry
   for overtaking lines, gravel trap on the outside.
3. Uphill esses: three linked medium-speed direction changes climbing about
   15 m, testing transient response and weight transfer.
4. A blind crest on a fast left kink: the car goes light over it (keep the
   crest radius large enough that no preset leaves the ground at its top
   speed there).
5. A long, fast, banked sweeper (5–8° of banking), grass on the inside,
   tyre wall on the outside.
6. A downhill compression into a double-apex right: the suspension bottoms
   toward the bump stops, then the second apex tightens.
7. A slow chicane with tall kerbs, the place to cut and be penalised.
8. A medium-speed final corner onto the straight, with exit kerbs worth
   using: it decides the next lap.

Limits that keep it drivable by every preset: grades within ±8 %, banking
within 8°, vertical curvature on crests gentle enough that the open-wheeler
(lowest ride height, most aero) does not ground or launch, compressions that
do not bottom the kart, corner radii no smaller than the pickup's turning
circle allows at the hairpin, and runoff wide enough that leaving the track
at the end of the straight costs time, not the lap.

## Work, in order

### Phase 1: the track module and its tests

The pure module and a circuit description. Tests under Node (add vitest to
the sandbox, or put the module in a small private package the sandbox
depends on if that keeps the sandbox build clean):

- the centreline closes on itself with continuous position, tangent,
  elevation and banking at the seam;
- the surface ribbons share edge vertices exactly and every triangle faces
  up;
- the layout limits above hold (grade, banking, crest curvature, minimum
  radius, width);
- the gates cross the full asphalt width and point forwards;
- spawn poses sit on the surface;
- the centreline projection finds the right distance for points on and off
  the track, and keeps working when the car crosses the start/finish seam.

### Phase 2: the circuit in the Rapier world

Build the colliders from the module in `sim.ts` alongside the proving
ground's, choose between them by map, and map each collider to its surface.
Render the same data in a new scene component: asphalt, kerbs with
alternating colours, grass, gravel, terrain, barriers, a start/finish gantry,
sector boards and a few distance boards before the braking zones. Revisit the
fog distance and the camera far plane for a 2.5 km map; keep the shadow
light following the car.

### Phase 3: timing and HUD

The lap timer as its own pure, tested module: feed it the car's position
before and after each step and the per-wheel surfaces; it reports
crossings, sector and lap times, validity and the live delta. Tests with
synthetic trajectories: a clean lap, a lap crossing a gate backwards, a lap
cut through the chicane, a reset mid-lap, a crossing exactly on a step
boundary. Then the HUD: current, last and best lap, sector splits coloured
against the best, live delta, invalid marker.

### Phase 4: ghost and persistence

Record, keep the best valid lap per preset, play it back as a translucent
model, persist and clear. Switching preset loads that preset's best and
ghost.

### Phase 5: drive it

Drive every preset for several laps with keyboard and, where available,
gamepad and wheel. Fix what the layout gets wrong (a crest that launches the
open-wheeler, a kerb that spins the kart, a runoff that is too forgiving)
by changing the circuit description, not the physics. Note anything that
looks like a physics problem in `FRICTION.md` instead of fixing it here.

### Phase 6: docs

The sandbox section of the README and `apps/sandbox/README.md`: the map
menu, timing, ghost and reset keys. A short note in this plan of what was
changed from the suggested layout and why.

## Constraints

- Nothing in `crates/` or the published packages changes for this. If the
  circuit exposes a core or adapter problem, record it and stop; it is a
  separate change.
- The proving ground keeps working exactly as before, under both hosts.
- The sandbox stays at 60 Hz host steps with the core at 1 kHz; the circuit
  must not drop frames on a mid-range laptop (watch the trimesh triangle
  count and the barrier collider count).
- No external assets: geometry and textures are generated, as the proving
  ground's are.
- Lap timing uses only simulation state, so the same inputs give the same
  times.

## Done means

- The map menu offers the proving ground and the circuit; the circuit runs
  under Rapier and every preset can complete a lap on it.
- Kerbs, grass and gravel change the surface under the wheels that touch
  them, visible in the HUD's surface readout.
- Barriers stop the car; it cannot fall off the world.
- Lap and sector times, validity and the live delta work, and the ghost of
  the best valid lap replays and persists per preset.
- The track and timer modules' tests pass, the sandbox typechecks and
  builds, and lint and format are clean.
- README and sandbox README describe the circuit.
