# Architecture Decision Records

One record per non-obvious choice, numbered in order of acceptance. ADRs are
written in public and double as devlog material. Copy `0000-template.md` to
start a new one. Status is one of Proposed, Accepted, Superseded (by NNNN), or
Rejected.

| #                                          | Title                                                           | Status   |
| ------------------------------------------ | --------------------------------------------------------------- | -------- |
| [0001](0001-rust-core-wasm-typescript.md)  | Rust core compiled to WebAssembly, TypeScript everywhere else   | Accepted |
| [0002](0002-chassis-proxy.md)              | Substep-rate chassis proxy with end-of-step impulse application | Accepted |
| [0003](0003-raw-wasm-abi.md)               | Plain C-style WASM ABI instead of wasm-bindgen glue             | Accepted |
| [0004](0004-docs-site.md)                  | VitePress for the documentation site                            | Accepted |
| [0005](0005-tire-low-speed-handling.md)    | Low-speed and standstill tire handling                          | Accepted |
| [0006](0006-f64-and-deterministic-math.md) | f64 throughout and a vendored software math module              | Accepted |
| [0007](0007-tire-sign-convention.md)       | ISO sign convention for slip and tire forces                    | Accepted |
| [0008](0008-feel-tire-parameterisation.md) | Feel tire model parameterisation                                | Accepted |
