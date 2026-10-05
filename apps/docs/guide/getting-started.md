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
- Read `PosX`, `PosY`, `PosZ` and the `Quat*` channels to place the body,
  and per wheel `WheelSteer_*`, `SuspTravel_*` and `SpinAngle_*` to place
  the wheels. The core uses ISO axes (x forward, y left, z up); map them to
  your renderer's convention once, in one place. The sandbox maps core
  `(x, y, z)` to three.js `(x, z, −y)`.
- Feed inputs through `@skidpad/input` so keyboard, gamepad, and wheel
  all produce the same normalised frame.
- For sound, `EngineRpm`, `ThrottleEffective` and `Gear` drive the engine
  note, whose fundamental is `EngineRpm / 60 × sound.firingsPerRev` Hz with
  the definition's `sound` block. `ShiftTimer` rises when a gear engages
  and counts down through the shift (torque is cut while it is above
  `shiftHold`), and `RevLimiter` says how far into the limiter's cut the
  engine is (0 to 1). Per wheel `PeakSlip_*` (combined slip relative to the tire's
  peak: above 1 the tire is sliding), `WheelContact_*` and `SurfaceId_*`
  drive squeal and surface noise. `TireFmax_*` is each tire's friction
  limit. `sp.telemetryLayout` lists every channel with its unit, and
  `WHEEL_ORDER` the wheel suffixes.

The built-in host integrates the chassis on flat ground. To drive on real
geometry, let a Rapier body be the car: see
[Driving a Rapier body](/guide/rapier).

## Where to go next

- [Vehicle definitions](/guide/definitions): the data format.
- [Driving a Rapier body](/guide/rapier): the host adapter.
- [Determinism contract](/guide/determinism-contract): what is and is not
  guaranteed.
- [Concepts](/concepts/slip): the physics, with interactive explainers.
