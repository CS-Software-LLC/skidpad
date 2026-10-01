# ADR-0006: f64 throughout and a vendored software math module

- Status: Accepted
- Date: 2026-10-01

## Context

The determinism contract requires identical bits on every browser and CPU.
WebAssembly's basic float operations (`add`, `sub`, `mul`, `div`, `sqrt`,
`min`, `max`, `abs`, `neg`, `copysign`, `trunc`, `nearest`, conversions) are
specified to be IEEE-754 correctly rounded, so they are deterministic.
Transcendental functions are not WASM instructions; whatever implements them
decides the result. Fused multiply-add is also not a basic WASM instruction
outside relaxed SIMD, and its availability varies by CPU on native targets.

## Decision

- The core uses `f64` everywhere. `f32` saves memory but loses precision in
  exactly the places that hurt stability (small slips, stiff forces summed over
  thousands of substeps).
- All transcendental and power functions come from `crates/skidpad-math`, which
  wraps the `libm` crate (a pure-Rust port of the MUSL C library's math
  functions). `libm` uses only basic arithmetic and bit manipulation, so its
  results are identical on every target. `sqrt` maps to the WASM `f64.sqrt`
  instruction, which is correctly rounded by specification.
- `clippy.toml` disallows every `f64`/`f32` method that could compile to a
  platform intrinsic (`sin`, `cos`, `exp`, `powf`, `mul_add`, …). The core
  crates run clippy with `-D warnings` in CI.
- No relaxed SIMD. SIMD128 (non-relaxed) is allowed in a future batched build
  because its lane operations are the same correctly-rounded basic operations.
- A cross-browser self-test (`skidpad_math_selftest`) hashes the outputs of every
  math function over a fixed sweep of inputs; CI asserts the hash is identical
  in Chromium, Firefox, WebKit, and Node.

## Alternatives considered

- **Rely on Rust's `f64::sin` on wasm32.** It currently links to a software
  implementation too, but that is an implementation detail of the toolchain
  and not a guarantee. The explicit module makes the guarantee ours.
- **Purpose-written minimax polynomials.** Smaller and faster but a maintenance
  burden and a correctness risk. Can replace individual `libm` functions later
  behind the same `skidpad_math` API if profiling justifies it.

## Consequences

- Native builds (tests, future Bevy target) produce the same bits as the WASM
  build, which lets `cargo test` validate hashes that CI then checks in
  browsers.
- The core must never read NaN payloads or depend on the sign of a NaN; those
  are the one place the WASM spec allows non-determinism.
