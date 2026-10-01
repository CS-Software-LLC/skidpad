# ADR-0001: Rust core compiled to WebAssembly, TypeScript everywhere else

- Status: Accepted
- Date: 2026-10-01

## Context

The project's headline promise is cross-browser, cross-architecture bit-exact
determinism, together with sim-grade fidelity at a 1 kHz internal rate and
scaling to hundreds of low-detail vehicles. The core has to be fast, free of
hidden platform behaviour, and reachable from any JavaScript bundler without
users needing a Rust toolchain.

## Decision

The entire simulation lives in a Rust crate (`crates/cp-core`) compiled to
WebAssembly through a thin binding crate (`crates/cp-wasm`). Everything users
touch directly is TypeScript: the public API, host adapters, renderer helpers,
input, telemetry, the editor, the sandbox, and the docs.

Reasons:

- **Determinism.** The ECMAScript specification allows `Math.sin`, `Math.exp`,
  `Math.pow` and friends to be implementation-approximated, so JavaScript
  results differ across engines. Basic WebAssembly float arithmetic is fully
  specified by IEEE-754 and is deterministic (NaN payloads aside, which the core
  never depends on). A software implementation of the transcendental functions
  (ADR-0006) compiled to WASM therefore produces identical bits on every
  browser and CPU. Relaxed SIMD is non-deterministic by design and is forbidden
  in the core.
- **Performance.** No garbage collector, predictable memory layout in linear
  memory, and an optional SIMD128 build later for batched multi-vehicle
  stepping.
- **Reach.** The same crate can back native targets after 1.0 (Bevy directly,
  Unity and Godot through a C ABI) without a rewrite. This is an option, not a
  goal.
- **Ecosystem fit.** Rapier, the first-class host, is itself Rust compiled to
  WASM and ships a deterministic build, so the recommended host matches the
  core's guarantees.

## Alternatives considered

- **TypeScript core with a hand-written deterministic math module.** Rejected.
  Garbage-collector pauses at high substep rates, weaker performance for many
  vehicles, and no path to native targets. Determinism would also rest on every
  engine agreeing on the semantics of every JIT optimisation, which is weaker
  than the WASM spec guarantee.
- **AssemblyScript.** Closer to TypeScript for contributors, but a smaller
  ecosystem, no property-testing story comparable to `proptest`, and no native
  target path.

## Consequences

- Contributors who only know TypeScript can work on everything except
  `crates/`. The build script compiles the WASM and copies it into
  `packages/core`, and CI publishes the compiled artifact, so a Rust toolchain
  is only needed when the core changes.
- The JS/WASM boundary must be batched (ADR-0003) or it becomes the bottleneck.
- Clippy's `disallowed-methods` list in `clippy.toml` mechanically enforces the
  "no platform math" rule.
