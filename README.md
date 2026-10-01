# Contact Patch

**Deterministic, sim-grade vehicle physics for the web.** A Rust core compiled
to WebAssembly, TypeScript everywhere else, built in public from the published
literature.

[![CI](https://github.com/csummers88/oss-vehicle-physics/actions/workflows/ci.yml/badge.svg)](https://github.com/csummers88/oss-vehicle-physics/actions/workflows/ci.yml)
[![License: MIT OR Apache-2.0](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue.svg)](#license)

> Working name. npm scope `@contactpatch/*`, crate prefix `cp-`. Availability on
> npm, crates.io, and GitHub gets checked before the public launch.

## Why another vehicle physics package

Existing web options (Rapier's raycast vehicle, cannon-es, Jolt's wheeled
vehicle, assorted demos) each cover part of the problem. Contact Patch aims to
win on specific, measurable axes, together:

1. **Sim-grade fidelity.** Slip-based tires with combined slip, load
   sensitivity, transient response, and aligning torque. A coupled drivetrain
   solved implicitly. Validated against published data and standard
   manoeuvres, with results published.
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

Milestones 0 and 1 are done. The core runs a planar single-track model with
two tire models, and every number below comes from the validation runner that
CI executes on each commit.

| Vehicle (preset)    | Understeer gradient, simulated | Linear theory with trail | 0–100 km/h | 100–0 km/h, no ABS        |
| ------------------- | ------------------------------ | ------------------------ | ---------- | ------------------------- |
| Light FWD hatchback | 0.90 deg/g                     | 0.93 deg/g               | 9.0 s      | 46.6 m                    |
| RWD sports car      | 0.10 deg/g                     | 0.10 deg/g               | 4.9 s      | 39.4 m                    |
| Kart                | 0.32 deg/g                     | 0.36 deg/g               | 10.3 s     | 60.2 m (rear brakes only) |

Benchmarks on the CI runner (Node 22, x64), 60 Hz host step:

| Case                      | ms per step |
| ------------------------- | ----------- |
| 1 car, 1 kHz internal     | 0.04        |
| 20 cars, 1 kHz internal   | 0.43        |
| 200 cars, 240 Hz internal | 1.07        |

Targets: under 0.2 ms for one car and under 3 ms for twenty on M1-class
hardware; under 2 ms for two hundred traffic cars; core WASM under 200 KB
gzipped (currently 123 KB).

The determinism check runs a 50 s scripted drive of three vehicles in
Chromium, Firefox, WebKit, and Node and asserts identical state hashes.

## Quick start

```sh
pnpm add @contactpatch/core @contactpatch/presets
```

```ts
import { init } from "@contactpatch/core";
import { preset } from "@contactpatch/presets";

const cp = await init();
const world = cp.createWorld(1);
const car = world.addVehicle(preset("sportsRwd"));
world.setInput(car, { throttle: 1, steer: 0.2 });
world.step(1 / 60);
console.log(world.read(car, "Speed"), world.stateHash(car));
```

See `examples/headless-node` and the docs' getting-started guide for the
Three.js / React Three Fiber pattern.

## Repository layout

```
crates/cp-math      deterministic software math (ADR-0006)
crates/cp-core      the simulation: tires, vehicle, world, snapshots, validation
crates/cp-wasm      plain C-style WASM ABI (ADR-0003)
packages/core       @contactpatch/core: loader, World, Tire, definitions, schema, migrations
packages/presets    reference vehicles with data sheets
packages/telemetry  ring-buffer recorder, CSV and JSON export
packages/input      keyboard ramps, gamepad and wheel mapping
apps/sandbox        Vite + React Three Fiber playground
apps/docs           VitePress docs with interactive explainers
apps/bench          benchmark page and Node runner
tools/validate      headless validation CLI with golden results
tests/determinism   cross-browser determinism harness (Playwright)
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

`pnpm dev:*` runs a preflight that builds anything missing, so after a fresh
clone the two commands above are enough. `pnpm preflight` reports what is missing
without building.

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

- **"Failed to resolve entry for package @contactpatch/core"** or a blank
  sandbox: the packages are not built. Run `pnpm bootstrap`.
- **"cargo not found"** in the preflight output: fine unless you are
  changing `crates/`; the prebuilt core is used. To build the core yourself,
  install Rust from https://rustup.rs and open a new terminal.
- **"the prebuilt core may be stale"**: the Rust sources changed after the
  last `pnpm prebuilt:update`. Harmless for app work; ask someone with Rust
  to refresh `prebuilt/`.
- **The docs explorer says "failed to load"**: the WASM or the compat
  build is missing. Run `pnpm bootstrap`, then restart `pnpm dev:docs`.
- **Changes to a package are not showing in the sandbox**: the apps read
  `packages/*/dist`. Run `pnpm build` or `pnpm dev:packages`.
- **A dependency build script was skipped** (pnpm prints a notice about
  esbuild): harmless; the repo allows the ones it needs.

Contributors who only know TypeScript can work on everything outside
`crates/`. See [CONTRIBUTING.md](CONTRIBUTING.md).

### Sandbox

`pnpm dev:sandbox` opens a scene with a car on a grid and a 40 m skidpad.
WASD or arrows drive, Space is the handbrake, gamepads work. The overlay shows
speed, lateral g, slip angles, steering torque, step cost, and the live state
hash; the graph scrolls telemetry; buttons export CSV and record a WebM clip.
The site deploys to GitHub Pages on every merge to `main`, and CI uploads a
preview build of the sandbox, docs, and bench page for every pull request.

## Roadmap

| Milestone | Scope                                                                                                                                                       | Status |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| M0        | Monorepo, CI with cross-browser determinism, licences and community files, deterministic math, sandbox, docs, bench skeleton                                | done   |
| M1        | Feel and Magic Formula tires with `.tir` import, combined slip, load sensitivity, aligning moment, single-track model, tire explorer, understeer validation | done   |
| M2        | Four wheels, suspension, Rapier adapter, chassis proxy, R3F track, telemetry overlay, benchmark baseline                                                    | next   |
| M3        | Standstill and slope stability, locked brakes, timestep sweep, snapshot and hash on the full model, cross-browser test on a real drive                      |        |
| M4        | Drivetrain graph with implicit solver: engine, clutch, gearboxes, differentials, AWD, electric                                                              |        |
| M5        | Steering geometry and rack force, input package with calibration, assists, WebHID force feedback                                                            |        |
| M6        | Surfaces, aero, solid axles, tuning editor, full validation runner, reference vehicles                                                                      |        |
| M7        | LOD, batched stepping, worker mode, replays and ghosts, AI helper, Jolt, Babylon                                                                            |        |
| M8        | API freeze, docs complete, performance targets met, format version 1, release 1.0                                                                           |        |

Not before 1.0: multibody suspension, tire thermals and wear, damage,
motorcycles and trailers, netcode, a full racing AI, native bindings,
proprietary FFB protocols.

## Principles

Tires and drivetrain are the simulation. Stable beats accurate (and gets an
ADR). Deterministic by construction. SI units inside. Plain data in, plain
data out. Everything observable. Clean room with cited sources: see
[docs/clean-room.md](docs/clean-room.md) and [data/PROVENANCE.md](data/PROVENANCE.md).

Decisions live in [docs/adr](docs/adr/README.md).

## License

Dual licensed under MIT or Apache-2.0, at your option. See
[LICENSE-MIT](LICENSE-MIT) and [LICENSE-APACHE](LICENSE-APACHE).
