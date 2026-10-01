# Architecture Decision Records

One record per non-obvious choice, numbered in order of acceptance. ADRs are
written in public and double as devlog material. Copy `0000-template.md` to
start a new one. Status is one of Proposed, Accepted, Superseded (by NNNN), or
Rejected.

| #                                                      | Title                                                                   | Status                    |
| ------------------------------------------------------ | ----------------------------------------------------------------------- | ------------------------- |
| [0001](0001-rust-core-wasm-typescript.md)              | Rust core compiled to WebAssembly, TypeScript everywhere else           | Accepted                  |
| [0002](0002-chassis-proxy.md)                          | Substep-rate chassis proxy with end-of-step impulse application         | Accepted                  |
| [0003](0003-raw-wasm-abi.md)                           | Plain C-style WASM ABI instead of wasm-bindgen glue                     | Accepted                  |
| [0004](0004-docs-site.md)                              | VitePress for the documentation site                                    | Accepted                  |
| [0005](0005-tire-low-speed-handling.md)                | Low-speed and standstill tire handling                                  | Accepted, amended by 0010 |
| [0006](0006-f64-and-deterministic-math.md)             | f64 throughout and a vendored software math module                      | Accepted                  |
| [0007](0007-tire-sign-convention.md)                   | ISO sign convention for slip and tire forces                            | Accepted                  |
| [0008](0008-feel-tire-parameterisation.md)             | Feel tire model parameterisation                                        | Accepted                  |
| [0009](0009-raycast-suspension-and-host-contract.md)   | Raycast suspension on the chassis proxy, and the external host contract | Accepted                  |
| [0010](0010-contact-patch-deflection-at-standstill.md) | Contact-patch deflection at standstill                                  | Accepted                  |
| [0011](0011-drivetrain-graph.md)                       | Drivetrain as a constrained rotational system solved implicitly         | Accepted                  |
| [0012](0012-steering-geometry-and-rack-force.md)       | Steering geometry, rack force and jacking                               | Accepted                  |
| [0013](0013-assists-layer.md)                          | Driving assists as a stateless stage inside the core                    | Accepted                  |
| [0014](0014-surface-table.md)                          | Surface table, with the surface scaling the tire inside the core        | Accepted                  |
| [0015](0015-aero-lift-and-drag-height.md)              | Aero lift per axle and the drag line of action                          | Accepted                  |
| [0016](0016-solid-axles-and-roll-centres.md)           | Solid axles and roll-centre heights on the raycast suspension           | Accepted                  |
| [0017](0017-static-toe.md)                             | Static toe per axle                                                     | Accepted                  |
