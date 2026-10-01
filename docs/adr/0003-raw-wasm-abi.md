# ADR-0003: Plain C-style WASM ABI instead of wasm-bindgen glue

- Status: Accepted
- Date: 2026-10-01

## Context

The spec lists `wasm-bindgen` plus `wasm-opt` as the WASM build tooling. The
public surface of `skidpad-wasm` is deliberately tiny: create a world, add vehicles
from a definition, step N vehicles in one call, read state and telemetry through
typed-array views into linear memory, snapshot and hash. There are no
per-wheel, per-channel, or per-frame object round-trips to bind.

## Decision

`crates/skidpad-wasm` exports plain `extern "C"` functions with integer and float
arguments and uses linear memory for every buffer. `@skidpad/core`
instantiates the module with `WebAssembly.instantiate` directly and owns the
typed-array views, refreshing them whenever `memory.buffer` changes identity
(memory growth). Strings cross the boundary as UTF-8 byte ranges.

`wasm-opt` is applied by the build script when a binary is available on the
PATH or through the `binaryen` npm package; it is optional and never changes
semantics (the build passes `--no-fma` semantics by never enabling relaxed
SIMD or fast-math).

## Alternatives considered

- **wasm-bindgen.** Generates JS glue for rich types, closures, and DOM access.
  None of that is needed, the glue adds size and per-call overhead, and the CLI
  version must exactly match the crate version, which complicates contributor
  setup. Can be revisited if a richer binding surface is ever needed; nothing in
  the core would change.
- **wasm-pack.** Same trade-off, plus an opinionated package layout we would
  undo.

## Consequences

- No JS glue: the loader is about a hundred lines and fully under our control,
  which matters for the no-allocation-in-the-hot-path rule.
- Error reporting crosses the boundary as a status code plus a
  last-error string accessor, not as thrown JS exceptions. The TypeScript layer
  converts codes into typed errors.
- Memory management is explicit (`cp_alloc` / `cp_free`) and wrapped in
  TypeScript so users never see pointers.
- A release build of the core is committed under `prebuilt/` with a manifest
  recording the hash of the Rust sources it came from. The dev preflight
  installs it when `cargo` is absent, which keeps the "no Rust toolchain for
  TypeScript contributors" promise before the first npm release. CI fails when
  `crates/` changes without a refreshed prebuilt. Once releases exist this can
  move to a download from the release artifacts.
