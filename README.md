# Skidpad

**Deterministic, sim-grade vehicle physics for the web.** A Rust core compiled
to WebAssembly, TypeScript everywhere else, built in public from the published
literature.

[![CI](https://github.com/csummers88/skidpad/actions/workflows/ci.yml/badge.svg)](https://github.com/csummers88/skidpad/actions/workflows/ci.yml)
[![License: MIT OR Apache-2.0](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue.svg)](#license)

> The name comes from the skidpad, the constant-radius circle used to measure a
> car's grip and balance, and the manoeuvre this project's validation runner
> runs on every commit (ISO 4138).

## Why another vehicle physics package

Existing web options (Rapier's raycast vehicle, cannon-es, Jolt's wheeled
vehicle, assorted demos) each cover part of the problem. Skidpad aims to
win on specific, measurable axes, together:

1. **Sim-grade fidelity.** Slip-based tires with combined slip, load
   sensitivity, transient response, and aligning torque. A coupled drivetrain
   (engine or motor, clutch, gearbox, differentials) solved implicitly with
   the wheels. Validated against published data and standard manoeuvres,
   with results published.
2. **Stability.** No jitter at rest, no explosions across the supported
   timestep range, cars park on slopes, brakes lock without chatter. Tested
   like a feature.
3. **Cross-browser bit-exact determinism.** Same inputs, byte-identical state
   in Chrome, Firefox, and Safari, on x86 and ARM. Replays, ghosts, verifiable
   leaderboards, lockstep and rollback multiplayer follow from it.
4. **Performance at scale.** One player car at 1 kHz for a small fraction of a
   frame; dozens of AI cars at lower detail through the same API.
5. **Host- and renderer-agnostic.** Rapier first, Jolt next, a built-in
   minimal host for headless use. Three.js, R3F, and Babylon through thin
   adapters.
6. **Arcade to sim from one model.** Assists sit on top of the same physics.
7. **The best tooling.** Telemetry from day one, a live tuning editor, a
   headless validation runner, interactive docs, force-feedback signals.

## Status

Milestones 0 to 6 are done. The core runs a four-wheel model with
independent suspension on a six-degree-of-freedom chassis proxy, a Rapier
adapter hosts that chassis in a real scene, and the planar single-track model
stays as the level-of-detail model. Stability is a tested feature: parked
cars hold on slopes, brakes lock once and stay locked, the manoeuvres agree
across the supported timestep range, and snapshots restore the full model
exactly. Milestone 4 added the drivetrain: a combustion engine or electric
motor, a clutch, a gearbox with reverse, open, locked and limited-slip
differentials and a centre differential, solved implicitly with the wheels.
Milestone 5 added steering geometry (mechanical trail, scrub radius, power
assist, jacking) so the steering torque is a force-feedback signal, a
stateless assists layer (ABS, traction and stability control, speed-sensitive
steering) that replays reproduce, and in `@skidpad/input` calibrated wheel
profiles, touch controls and force-feedback sinks over WebHID, Logitech
first. Milestone 6 added a surface table (grip, rolling resistance and
ploughing drag per contact, looked up inside the tire models), aero lift per
axle with the drag on a line above the centre of mass, solid axles that keep
their wheels upright to the road, roll-centre heights that send part of the
lateral load transfer through the links, the step-steer and double-lane-change
manoeuvres, three more reference vehicles (a solid-axle pickup, an electric
crossover, a winged open-wheeler) and a live tuning editor in the sandbox.
Every number below comes from the validation runner that CI executes on each
commit.

| Vehicle (preset)       | Understeer gradient, four-wheel | Single-track | Linear theory with trail | 0–100 km/h | 100–0 km/h, no ABS        |
| ---------------------- | ------------------------------- | ------------ | ------------------------ | ---------- | ------------------------- |
| Light FWD hatchback    | 1.13 deg/g                      | 0.93 deg/g   | 0.93 deg/g               | 9.5 s      | 46.5 m (42.6 m with ABS)  |
| RWD sports car         | 0.27 deg/g                      | 0.12 deg/g   | 0.10 deg/g               | 5.5 s      | 39.6 m (36.2 m with ABS)  |
| Kart                   | -0.21 deg/g (solid axle push)   | 0.31 deg/g   | 0.36 deg/g               | 10.9 s     | 58.0 m (rear brakes only) |
| Pickup 4x4             | 0.98 deg/g                      | 0.72 deg/g   | 0.71 deg/g               | 7.3 s      | 52.1 m (47.1 m with ABS)  |
| Electric crossover AWD | 0.30 deg/g                      | 0.22 deg/g   | 0.21 deg/g               | 5.0 s      | 44.5 m (40.1 m with ABS)  |
| Open-wheeler           | 0.15 deg/g                      | 0.11 deg/g   | 0.10 deg/g               | 3.2 s      | 24.8 m (23.3 m with ABS)  |

The four-wheel gradient sits above the single-track one by the load
sensitivity cost of lateral load transfer, which the single-track model does
not have; the kart's solid rear axle on a locked differential pushes at low
speed, which the single-track model, with one wheel per axle, does not see.
The 0–100 km/h times run through each preset's drivetrain: launch on the
clutch, wheelspin, shifts.

Transient handling and surfaces, from the same runner: the ISO 7401 step
steer at 80 km/h (yaw-rate response time to 90 % and overshoot), the highest
entry speed at which the ISO 3888-1 double lane change keeps every wheel
between the cones, and the 100–0 km/h stop with locked wheels on the
reference surface table:

| Vehicle (preset)       | Step steer response | Lane change passes up to | Wet asphalt | Gravel | Snow  | Ice   |
| ---------------------- | ------------------- | ------------------------ | ----------- | ------ | ----- | ----- |
| Light FWD hatchback    | 0.21 s, 5 %         | 100 km/h                 | 70 m        | 73 m   | 126 m | 331 m |
| RWD sports car         | 0.25 s, 0 %         | 110 km/h                 | 59 m        | 62 m   | 110 m | 292 m |
| Kart                   | 0.15 s, 2 %         | 80 km/h                  | 79 m        | 79 m   | 113 m | spins |
| Pickup 4x4             | 0.21 s, 3 %         | 90 km/h                  | 78 m        | 80 m   | 137 m | 361 m |
| Electric crossover AWD | 0.25 s, 0 %         | 90 km/h                  | 67 m        | 70 m   | 122 m | 330 m |
| Open-wheeler           | 0.16 s, 0 %         | 100 km/h                 | 37 m        | 39 m   | 70 m  | 172 m |

The kart brakes on its rear axle only, so on ice it swaps ends; the runner
reports that rather than a distance.

Stability, from the same runner (all six presets, both models):

| Check                                                                         | Result                                                                      |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Parked on 10, 20, 30 % grades (brake), 10, 20 % (handbrake), 20 % cross slope | holds, creep below 1e-10 m/s                                                |
| 100–0 km/h without ABS                                                        | wheels lock once at 0.2–0.35 s, zero releases, deceleration ripple ≤ 0.01 % |
| Stop on the held brake                                                        | spring-back ≤ 0.27 m/s and ≤ 5 cm, at rest (< 1e-4 m/s) after 2 s           |
| Timestep sweep, 250–2000 Hz internal × 30–240 Hz host                         | understeer gradient within 0.001 deg/g, braking distance within 0.7 %       |

Benchmarks on a Node 22 x64 container, 60 Hz host step, release build:

| Case                                    | ms per step |
| --------------------------------------- | ----------- |
| 1 car, four-wheel, 1 kHz internal       | 0.06        |
| 20 cars, four-wheel, 1 kHz internal     | 1.09        |
| 50 cars, four-wheel, 500 Hz internal    | 1.26        |
| 200 cars, single-track, 240 Hz internal | 1.26        |

Targets: under 0.2 ms for one car and under 3 ms for twenty on M1-class
hardware; under 2 ms for two hundred traffic cars; core WASM under 200 KB
gzipped (currently 199.4 KB). `apps/bench/baseline` holds the committed
baseline the benchmark compares against.

An independent check drives Skidpad and Project Chrono's multibody BMW E90
through the same eight manoeuvres, with the Skidpad car built from Chrono's
published constants. Steady-state handling and the step-steer response
agree within a few percent once static toe, anti-dive and anti-squat, a
measured engine-braking curve and per-axle tracks are carried over
(ADR-0017, ADR-0018); the remaining gaps, mostly geometry that changes with
travel, are in [docs/validation/chrono-bmw-e90.md](docs/validation/chrono-bmw-e90.md).

The determinism check runs a 50 s scripted drive of three vehicles, then a
recorded lap of the sandbox track for each of the six presets (real driving
inputs, replayed open-loop), in Chromium, Firefox, WebKit, and Node, and
asserts identical state hashes.

## Quick start

```sh
pnpm add @skidpad/core @skidpad/presets
```

```ts
import { init } from "@skidpad/core";
import { preset } from "@skidpad/presets";

const sp = await init();
const world = sp.createWorld(1);
const car = world.addVehicle(preset("sportsRwd"));
world.setInput(car, { throttle: 1, steer: 0.2 });
world.step(1 / 60);
console.log(world.read(car, "Speed"), world.stateHash(car));
```

See `examples/headless-node` and the docs' getting-started guide for the
Three.js / React Three Fiber pattern. To let a Rapier rigid body be the car,
add `@skidpad/rapier`:

```ts
import { createChassisBody, RapierVehicle } from "@skidpad/rapier";

const body = createChassisBody(RAPIER, scene, def); // mass, inertia, chassis box
const host = new RapierVehicle(RAPIER, world, car, body, scene);
// each frame
host.beforeStep(); // pose and wheel rays into the core
world.step(1 / 60);
host.afterStep(1 / 60); // tire and suspension impulse onto the body
scene.step();
```

Jolt works the same way through `@skidpad/jolt` (`createChassisBody`,
`JoltVehicle`); `examples/babylon` runs it in Babylon.js.

For many cars, a vehicle can drop to the single-track model or freeze and
come back without a jump, the core can drive cars along a path by itself,
and a world can take many steps in one call:

```ts
world.setLod(trafficCar, "singleTrack", 240);
world.setAi(trafficCar, centreline, { maxSpeed: 25, lateralOffset: 2 });
world.stepMany(1 / 60, 600);
```

`@skidpad/replay` records replays (inputs plus keyframes, re-simulated bit
for bit and seekable) and ghosts (pose tracks), and `@skidpad/worker` runs a
world in a Web Worker. The docs' guides cover each.

## Repository layout

```
crates/skidpad-math      deterministic software math (ADR-0006)
crates/skidpad-core      the simulation: tires, surfaces, drivetrain, vehicle, world, snapshots, validation
crates/skidpad-wasm      plain C-style WASM ABI (ADR-0003)
packages/core       @skidpad/core: loader, World, Tire, definitions, schema, migrations
packages/presets    reference vehicles with data sheets, the surface table
packages/rapier     @skidpad/rapier: Rapier 3D host adapter
packages/jolt       @skidpad/jolt: Jolt Physics host adapter
packages/replay     @skidpad/replay: deterministic replays and ghosts
packages/worker     @skidpad/worker: run a world in a Web Worker
packages/telemetry  ring-buffer recorder, CSV and JSON export
packages/input      keyboard ramps, gamepad and wheel mapping
apps/sandbox        Vite + React Three Fiber playground
apps/docs           VitePress docs with interactive explainers
apps/bench          benchmark page and Node runner
tools/validate      headless validation CLI with golden results
tools/chrono-compare  behavioural comparison against Project Chrono's multibody BMW E90
tests/determinism   cross-browser determinism harness (Playwright), recorded laps
examples/headless-node  a world in plain Node
examples/babylon    Babylon.js on Jolt: AI traffic with level of detail, a lap ghost
docs/adr            architecture decision records
```

## Developing

Requirements: Node 20+ with pnpm (`corepack enable`). Rust is optional: the
repository ships a prebuilt core in `prebuilt/`, and the preflight uses it
when `cargo` is not installed. You only need Rust
([rustup](https://rustup.rs)) to change `crates/`; the pinned toolchain and
the `wasm32-unknown-unknown` target install themselves the first time cargo
runs in the repository.

```sh
pnpm install
pnpm bootstrap             # install the core (Rust build or prebuilt) and build the packages
pnpm dev:sandbox           # drive a car (http://localhost:5173)
pnpm dev:docs              # docs with the tire explorer
```

`pnpm dev:*` runs a preflight that builds anything missing or stale (sources
newer than their build, as after a `git pull`), so after a fresh clone or a
pull the two commands above are enough. `pnpm preflight` reports what is
missing or stale without building.

Everything else:

```sh
pnpm build                 # release WASM, TypeScript packages, tools
pnpm test:rust             # cargo test --workspace
pnpm test                  # vitest across packages, tools and tests
pnpm validate              # standard manoeuvres vs golden results
pnpm bench                 # Node benchmark
pnpm test:determinism      # Playwright: Chromium, Firefox, WebKit
pnpm dev:packages          # rebuild packages on change while an app is running
```

The apps import the _built_ packages, so after editing anything under
`packages/` run `pnpm build` or keep `pnpm dev:packages` running. After
editing `crates/` run `pnpm build:wasm`, and before opening the PR run
`pnpm prebuilt:update` and commit `prebuilt/`; CI fails when the prebuilt core
is out of sync with the Rust sources.

### Troubleshooting

- **"Failed to resolve entry for package @skidpad/core"** or a blank
  sandbox: the packages are not built. Run `pnpm bootstrap`.
- **"cargo not found"** in the preflight output: fine unless you are
  changing `crates/`; the prebuilt core is used. To build the core yourself,
  install Rust from https://rustup.rs and open a new terminal.
- **"the prebuilt core may be stale"**: the Rust sources changed after the
  last `pnpm prebuilt:update`. Harmless for app work; ask someone with Rust
  to refresh `prebuilt/`.
- **The docs explorer says "failed to load"**: the WASM or the compat
  build is missing. Run `pnpm bootstrap`, then restart `pnpm dev:docs`.
- **Changes to a package are not showing in the sandbox**, or the sandbox
  fails with something like `Cannot read properties of undefined (reading
'powerUnit')` after pulling: the apps read `packages/*/dist`, which was
  built from older sources. The preflight behind `pnpm dev:*` rebuilds any
  package whose sources are newer than its build (and reinstalls a stale
  core), so re-run the dev command, or run `pnpm build` or
  `pnpm dev:packages` yourself.
- **A dependency build script was skipped** (pnpm prints a notice about
  esbuild): harmless; the repo allows the ones it needs.

Contributors who only know TypeScript can work on everything outside
`crates/`. See [CONTRIBUTING.md](CONTRIBUTING.md).

### Sandbox

`pnpm dev:sandbox` opens a scene with a car on a looped track, a 40 m
skidpad, and a set of obstacles. WASD or arrows drive, Space is the
handbrake, Q and E shift (the presets are automatics; E from neutral is
drive, Q below first is reverse), C is the clutch; gamepads, steering wheels
and touch work, and the **Wheel setup** panel assigns and calibrates a
wheel's controls, connects force feedback over WebHID (Chromium) and
toggles the assists. The **Tuning** panel edits every definition parameter
live, with units and ranges from the JSON schema, and exports or loads the
definition as JSON. The surface selector puts the car on wet asphalt,
gravel, grass, snow or ice. The host selector switches between the built-in
flat-ground host and a Rapier scene where the speed bumps, the ramp and the
kerb are real. The overlay shows speed, lateral g, roll and pitch, slip
angles, steering torque, step cost, the live state hash, and per wheel the
load, suspension travel and slips; the graph scrolls telemetry; buttons
export CSV and record a WebM clip. A sound toggle adds a synthesised engine
note and tire squeal (Web Audio, no samples): the note follows the core's
engine speed and gear, and the squeal follows each wheel's combined slip
past its force peak. It is sound only and does not touch the simulation.
The site deploys to GitHub Pages on every merge to `main`, and CI uploads a
preview build of the sandbox, docs, and bench page for every pull request.

## Repository settings for CI

Two workflows need one-time settings that only the repository owner can
change:

- **Deploy site** publishes the sandbox, docs, and benchmark dashboard to
  GitHub Pages. The workflow tries to enable Pages itself; if that is refused,
  turn it on under Settings → Pages → Source: GitHub Actions.
- **Release** maintains a "chore: version packages" pull request from the
  pending changesets. Allow it under Settings → Actions → General → Workflow
  permissions → "Allow GitHub Actions to create and approve pull requests".
  It never publishes to npm until an `NPM_TOKEN` secret exists.

## Roadmap

| Milestone | Scope                                                                                                                                                                                                                                                                          | Status |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| M0        | Monorepo, CI with cross-browser determinism, licences and community files, deterministic math, sandbox, docs, bench skeleton                                                                                                                                                   | done   |
| M1        | Feel and Magic Formula tires with `.tir` import, combined slip, load sensitivity, aligning moment, single-track model, tire explorer, understeer validation                                                                                                                    | done   |
| M2        | Four wheels, suspension, Rapier adapter, chassis proxy, R3F track, telemetry overlay, benchmark baseline                                                                                                                                                                       | done   |
| M3        | Standstill and slope stability, locked brakes, timestep sweep, snapshot and hash on the full model, cross-browser test on a real drive                                                                                                                                         | done   |
| M4        | Drivetrain graph with implicit solver: engine, clutch, gearboxes, differentials, AWD, electric                                                                                                                                                                                 | done   |
| M5        | Steering geometry, rack force and jacking; assists (ABS, traction and stability control, speed-sensitive steering); input calibration, wheel profiles, touch; force feedback over WebHID                                                                                       | done   |
| M6        | Surfaces, aero, solid axles, tuning editor, full validation runner, reference vehicles                                                                                                                                                                                         | done   |
| M7        | LOD, batched stepping, worker mode, replays and ghosts, AI helper, Jolt, Babylon                                                                                                                                                                                               | done   |
| M8        | Dogfooding: publish 0.x to npm; build a small game outside this repo on the published packages; fix the API, packaging and docs friction it exposes; drive the sandbox on keyboard, gamepad and wheel and tune the feel; try the [VERIFY] force-feedback constants on hardware | next   |
| M9        | Hardening: clear errors for invalid and extreme definitions, NaN guards, long-run soak tests, performance at realistic car counts, docs gaps found in M8                                                                                                                       | later  |

### 1.0

1.0 has no date. It comes after the packages have been used for real, and
means an API freeze and format version 1. The bar:

- At least one project outside this repository built on the published
  packages.
- One minor release with no breaking API or format change.
- Definition, snapshot and replay formats settled at version 1, with
  migrations from 0.x.
- Every public API documented; performance targets met or revised.
- Force feedback verified on hardware, or the unverified devices listed as
  such.

Until then the packages stay 0.x and breaking changes go in changesets.

Not before 1.0: multibody suspension, tire thermals and wear, damage,
motorcycles and trailers, netcode, a full racing AI, native bindings.

### Force feedback platform

The core produces the steering torque; getting it to a wheel is the input
package's job, and the web has no standard channel for it. The Gamepad API
reads wheels and pedals everywhere but outputs only rumble. So the target
is **WebHID in Chromium-based browsers**, which can send a wheel its own
reports after a permission prompt. Each wheel speaks its own protocol, so
support is per device: the **Logitech G PRO** (direct drive) is first, over
Logitech's HID++ force-feedback feature as documented by open-source
drivers, with the G923 and G29 families expected to follow on the same
code path. Other makers' protocols belong in separate community packages,
not in the core. A torque-to-rumble fallback covers gamepads, and an
Electron example with `node-hid` is the route to a desktop build. Protocol
constants are marked **[VERIFY]** until tested on hardware.

## Principles

Tires and drivetrain are the simulation. Stable beats accurate (and gets an
ADR). Deterministic by construction. SI units inside. Plain data in, plain
data out. Everything observable. Clean room with cited sources: see
[docs/clean-room.md](docs/clean-room.md) and [data/PROVENANCE.md](data/PROVENANCE.md).

Decisions live in [docs/adr](docs/adr/README.md).

## License

Dual licensed under MIT or Apache-2.0, at your option. See
[LICENSE-MIT](LICENSE-MIT) and [LICENSE-APACHE](LICENSE-APACHE).
