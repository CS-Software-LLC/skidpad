# Getting started

Skidpad is a TypeScript package backed by a WebAssembly core. You never
need a Rust toolchain to use it.

## Install

Install `@skidpad/core` and, for reference vehicles, `@skidpad/presets`.
If your bundler has trouble serving the separate `.wasm` file, import from
`@skidpad/core/compat` instead; it inlines the module.

## Drive a car in Node

1. Call `init()` once and keep the result.
2. Create a world with room for the vehicles you need.
3. Add a vehicle from a preset or your own definition. Partial definitions are
   fine; missing fields take the core defaults.
4. Each frame, write the input and call `step(dt)` with your host step.
5. Read telemetry by channel name.

The repository's `examples/headless-node` folder has the complete script; it
is under twenty lines.

## Drive a car in a Three.js or R3F scene

The sandbox in `apps/sandbox` is the reference integration. The pattern is:

- Keep a fixed 60 Hz accumulator in your frame loop and call `step(1/60)` for
  each accumulated step. The core substeps at 1 kHz internally.
- Read `PosX`, `PosY`, `Yaw`, `SteerAngle`, and the wheel speeds to place the
  meshes. The core uses ISO axes (x forward, y left, z up); map them to your
  renderer's convention once, in one place.
- Feed inputs through `@skidpad/input` so keyboard, gamepad, and wheel
  all produce the same normalised frame.

Until the Rapier adapter lands in milestone 2, the built-in minimal host
integrates the chassis on flat ground; your scene renders what the core
reports.

## Where to go next

- [Vehicle definitions](/guide/definitions): the data format.
- [Determinism contract](/guide/determinism-contract): what is and is not
  guaranteed.
- [Concepts](/concepts/slip): the physics, with interactive explainers.
