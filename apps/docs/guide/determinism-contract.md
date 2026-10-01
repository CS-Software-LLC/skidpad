# Determinism contract

The core guarantees that the same sequence of inputs produces byte-identical
simulation state on every platform that runs the WebAssembly module: Chromium,
Firefox, WebKit, Node, on x86 and ARM.

## How

- The core is Rust compiled to WebAssembly. Basic WebAssembly float
  arithmetic is specified by IEEE-754 and is correctly rounded everywhere.
- Every transcendental function (`sin`, `atan2`, `exp`, `pow`, …) comes from a
  vendored software implementation, never from the platform
  ([ADR-0006](https://github.com/csummers88/skidpad/blob/main/docs/adr/0006-f64-and-deterministic-math.md)).
- No relaxed SIMD, no fused multiply-add, no hash-map iteration, no time or
  randomness inside the core. A clippy configuration enforces the math rules
  mechanically.
- CI runs a fixed scenario in all three browser engines and Node and asserts
  identical state hashes.

## What you get

- `world.stateHash(i)` and `world.worldHash()` for desync detection.
- `world.snapshot(i)` / `world.restore(i, bytes)`: versioned binary snapshots
  that restore exactly. Continuing from a snapshot matches an uninterrupted
  run.
- Recorded inputs replay identically on any machine.

## What is not covered

- Your host physics engine. For full-scene determinism use a deterministic
  host (for Rapier, its `-deterministic` build). The vehicle core alone is
  deterministic regardless of host.
- Anything you compute in JavaScript. `Math.sin` in your own code is still
  platform-approximated: while building the cross-browser harness we found
  `Math.sin` differing in the last bit between Chromium and Node for an
  ordinary argument, which changed the scenario hash from the first step.
  Scripted inputs for replays and tests should use basic arithmetic only;
  `triangleWave` and `smoothWave` in `@skidpad/core` exist for that.
- NaN payload bits. The core never depends on them.
