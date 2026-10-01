# Contributing to Contact Patch

Thanks for looking. This project is built in public, and contributions of every
size are welcome: bug reports, physics corrections, docs, presets, and code.

## Ground rules

- **Clean room.** Do not port code, structure, or parameter sets from commercial
  vehicle physics packages, and do not decompile closed-source products. Physics
  comes from published literature; cite it in a code comment. See
  `docs/clean-room.md`.
- **Determinism.** The simulation crates never call platform math functions,
  never iterate hash maps, never read time or randomness, and never allocate
  inside a step. `cargo clippy` enforces most of this; reviewers enforce the rest.
- **Stability beats accuracy.** If a change trades one for the other, write an
  ADR in `docs/adr/` and link it from the PR.
- **Every parameter is observable.** A new definition parameter needs a schema
  entry with units and a default, a telemetry channel if it changes state, an
  editor control, and a line in the tuning guide.
- **Physics-visible changes update golden results.** If a change moves any
  validation result, regenerate `tools/validate/golden/` in the same PR and
  describe the change in a changeset line starting with `physics:`.

## Getting set up

You need Rust (see `rust-toolchain.toml`; the `wasm32-unknown-unknown` target
is installed automatically) and Node 20+ with pnpm (`corepack enable`).

```sh
pnpm install
pnpm build:wasm        # compiles crates/cp-wasm and copies the .wasm into packages/core
pnpm build             # TypeScript packages and tools
pnpm test:rust         # cargo test --workspace
pnpm test              # vitest across packages and tools
pnpm dev:sandbox       # Vite playground
```

Contributors who only know TypeScript can work on every package, app, and tool.
Only `crates/` requires Rust.

## Pull requests

- One topic per PR. Keep refactors separate from behaviour changes.
- Add a changeset (`pnpm changeset`) for anything user-visible.
- CI runs Rust tests, TypeScript tests, lint, typecheck, the WASM build, the
  cross-browser determinism check, the validation scenarios, and the benchmark.
  All of it must pass.
- Fill in the PR template. If the change affects simulated behaviour, paste the
  validation diff.

## Good first issues

Issues labelled `good first issue` are scoped so that someone new to the
codebase can finish them in an evening. If you pick one up, say so in the issue.

## Licensing

By contributing you agree that your contribution is licensed under
MIT OR Apache-2.0, like the rest of the project.
