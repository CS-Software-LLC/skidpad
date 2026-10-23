# Plan: unsprung mass

A task brief for Claude Code. It says what to build and why, the decisions
already made, and what "done" means for each step. It deliberately does not
give the code.

## Goal

Give the four-wheel model a wheel-hop mode: each wheel with its own mass,
riding on the tire's vertical spring, so tire load rises and falls over
bumps and kerbs and a wheel can leave the ground. ADR-0009 left this out to
keep every substep rate stable; ADR-0028 adds it as an option that stays
stable.

## Steps

1. **Core option, off by default (done in the first PR).** ADR-0028,
   `suspension.unsprungMass` on independent axles, tire `verticalStiffness`
   and `verticalDamping`, the `.tir` `[VERTICAL]` keys, the two-mass corner
   in `vehicle/four_wheel.rs`, the `TireDeflection_*` channels, snapshots,
   TypeScript types, validation and schema, and the exact-answer tests in
   `tests/unsprung_tests.rs` with results in `docs/validation/analytic.md`.
   Presets, goldens and determinism hashes do not move.
2. **Presets on (done in the second PR, with a core fix for light bodies in
   roll; see `docs/validation/unsprung-presets.md`).** Give the hatchback, sports car, crossover and
   open-wheeler typical unsprung masses and tire rates on both axles, and
   the kart and pickup on their independent front axles. Regenerate the
   goldens, the README tables and the determinism hashes. Write up what
   moved and why, including telemetry traces on the sandbox circuit with
   and without the option, since the hop mode adds real ripple to
   `TireLoad_*` and `LatAccel` on rough surfaces.
3. **Solid axles (third PR).** A beam axle with unsprung mass is one body
   with heave and roll, carrying both wheels, not two independent hubs.
   Needs its own ADR section, an exact-answer test (beam heave and beam roll
   against their two-degree-of-freedom answers), then the kart and pickup
   rears, and a rerun of the NHTSA Jeep Cherokee comparison, whose axles are
   both solid.

## Decisions already made

- Opt-in per axle; zero keeps the massless strut bit for bit.
- The wheel is stepped with linearly implicit (backward) Euler; coupling to
  the body stays explicit. Stable beats accurate (ADR-0028 has the numbers).
- Ride height and static loads do not change when the option is switched on
  (preloaded spring and tire).
- External hosts keep the whole car's mass and gravity; the host contract
  does not change.
- Snapshot version stays 6; a vehicle with unsprung mass appends 8 values.

## Constraints

- Any PR touching `crates/` runs `pnpm prebuilt:update` and commits
  `prebuilt/`.
- Tolerances for new exact-answer tests are written down before the first
  run; misses are reported, not hidden.
- Presets are generic vehicle classes. Unsprung masses and tire rates come
  from typical published ranges, not from a specific car.

## Done means

Each step: `cargo test --workspace`, clippy and rustfmt clean, `pnpm test`,
`pnpm validate` (goldens regenerated only in step 2 and later, with the
reason in the changeset), Node and browser determinism hashes agree, and
the write-up updated.
