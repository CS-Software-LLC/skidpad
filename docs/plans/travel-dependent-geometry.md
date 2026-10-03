# Plan: suspension geometry that changes with travel

A task brief for Claude Code. Read it whole before starting. It says what to
build and why, which files are involved, the decisions already made, and what
"done" means. It deliberately does not give the code.

## Goal

Let a vehicle definition say how toe, camber, roll-centre height and the
anti-pitch fractions change as each wheel moves through its travel, as
optional lookup curves. The four-wheel model evaluates them every substep.
This is the kinematics half of what a kinematics-and-compliance (K&C) rig
measures on a real car, and it is how commercial vehicle-dynamics tools carry
suspension geometry without a multibody solver.

## Why

`docs/validation/chrono-bmw-e90.md` compares Skidpad with Project Chrono's
multibody BMW E90. Most of what is still outside tolerance comes from
geometry that Skidpad holds fixed at ride height and Chrono lets move:

- Finding 2: toe is fixed at its straight-running value. Chrono's falls from
  1.43° to about 0.9° (front) as the body rolls, so Skidpad's loaded outer
  tire gets too much toe benefit. Understeer gradient is 0.01 deg/g against
  Chrono's 0.20.
- Finding 3: anti-dive is fixed at ride height. Chrono's front side-view
  instant centre is 10.9 m away, so its angle changes noticeably over a few
  centimetres of dive. Braking pitch is 3.3 deg/g against 4.4.
- Finding 4: roll centres are fixed and the links never push the body up or
  down (jacking). Chrono's front share of lateral load transfer falls from
  60 % to 51 % between 0.25 g and 0.9 g, and its nose dips up to 0.5° in the
  turn. Skidpad stays at 55 % with no pitch. This also leaves the rear-left
  load trace outside tolerance.
- Camber is today the static value plus the body's lean
  (`crates/skidpad-core/src/vehicle/four_wheel.rs`, where `w.camber` is set).
  There is no camber gain from the linkage.

The README roadmap leaves "travel-dependent geometry" until after 1.0 because
it groups it with multibody suspension. Curves get most of the benefit at a
fraction of the cost. Because they are a definition-format addition, they
should land before the format is frozen at version 1.

## Read first

- `README.md`: the Principles section ("stable beats accurate", determinism,
  clean room) and the Roadmap.
- `CONTRIBUTING.md`: ADRs, golden results, changesets.
- `docs/clean-room.md` and `data/PROVENANCE.md`.
- ADRs 0009 (raycast suspension), 0012 (steering geometry and jacking from
  steer), 0016 (solid axles and roll centres), 0017 (static toe), 0018
  (anti-dive and anti-squat). This work extends the last three. Copy their
  structure and tone for the new ADR.
- `docs/validation/chrono-bmw-e90.md`: findings 2–4 and the recommendations.
- `crates/skidpad-core/src/definition.rs`: `AxleDef` and `SuspensionDef`,
  including how fields are defaulted and validated.
- `crates/skidpad-core/src/vehicle/four_wheel.rs`: `toe()`, the contact and
  travel pass, the wheel-load pass (roll-centre geometric load, anti-pitch
  load), and the tire pass (wheel axes, camber).
- `crates/skidpad-core/src/snapshot.rs` and `telemetry.rs`.
- `packages/core/src/definition/` (`types.ts`, `validate.ts`, `migrate.ts`)
  and `packages/core/schema/vehicle-definition.schema.json`.
- `tools/chrono-compare/`: `README.md`, `src/geometry.ts` (front- and
  side-view instant centres solved from Chrono's hardpoints),
  `src/vehicle.ts` (how the E90 definition is built), `src/chrono-e90.ts`.

## Decisions already made

Record these in the ADR. Change one only if the code shows it can't work,
and say why in the ADR.

1. **Representation.** Each curve is a piecewise-linear table of
   `[travel, value]` pairs. Travel is in metres and uses the model's existing
   sign: positive is bump (compression) from the static ride position.
   Points must be strictly increasing in travel, with at least 2 and at most
   16 points. Outside the table the value is held at the end point, with no
   extrapolation. Linear interpolation needs only add, multiply and divide,
   so it is deterministic. Put the evaluator next to the existing curve code
   or in a small new module, with unit tests.
2. **Curves are offsets from the static values.** The existing scalar fields
   (`staticToeDeg`, `staticCamberDeg`, `rollCenterHeight`, `antiBrake`,
   `antiDrive`) stay the value at ride height. A curve adds to it.
   Validation requires every curve to pass through zero at zero travel,
   within 1e-9, so there is one source of truth for the static value and the
   tuning editor's existing sliders keep working.
3. **Where they live.** Add an optional `kinematics` block to
   `SuspensionDef` with five optional curves: `toeDeg`, `camberDeg`,
   `rollCenterHeight`, `antiBrake` and `antiDrive`. The units match the
   scalar fields they offset. The curves describe the left wheel; the right
   wheel mirrors them, as static toe and camber already do through the
   `side` sign.
4. **No curve, no change, bit for bit.** A definition without a `kinematics`
   block, or with an empty one, must take exactly the current code path. All
   six presets, the golden results in `tools/validate/golden/`, the
   determinism lap hashes and the benchmark must stay unchanged until a
   preset opts in. This is the main safety property; test it explicitly.
5. **Format version.** The definition `formatVersion` stays 1. The field is
   optional and additive, which is how ADR-0017 and ADR-0018 added theirs, so
   no migration step is needed. Say so in the ADR. If new per-wheel state is
   added (see 7), bump the snapshot `VERSION` in `snapshot.rs` and follow how
   ADR-0018 handled its snapshot bump.
6. **Single-track model and solid axles.** The single-track model ignores
   the block, as it ignores static toe and camber. On a `solid` axle,
   validation rejects `toeDeg` and `camberDeg`, because the beam sets the
   wheel angles (ADR-0016), but accepts the other three.
7. **Roll centre that moves, plus jacking.** The current geometric load is
   per axle: axle lateral force × roll-centre height ÷ track, as equal and
   opposite loads on the two wheels. With a `rollCenterHeight` curve, change
   to a per-wheel form. Each wheel's link carries a vertical force equal to
   that wheel's own lateral force times the slope of the line from its
   contact patch to the roll centre, using the roll-centre height evaluated
   at that wheel's travel. When both wheels have the same lateral force and
   the same height, this reduces to today's load transfer. When they differ,
   the forces no longer cancel, and the net is the jacking force that lifts
   or drops the body. That is what moves Chrono's load-transfer share and
   pitch in the turn. It needs each wheel's lateral force from the previous
   substep, the same lag ADR-0016 already accepts for the axle force, so that
   becomes per-wheel state in the snapshot. Use the per-wheel form only when
   the axle has a roll-centre curve, so decision 4 holds.
8. **Anti-pitch.** With an `antiBrake` or `antiDrive` curve, evaluate the
   fraction per wheel at that wheel's own travel. The axle's longitudinal
   force is still split evenly between its wheels, as now. Keep the
   brake-or-drive choice by the sign of the force.
9. **Toe and the order within a substep.** Bump steer needs the wheel's
   travel, and travel already depends on steer through the steer-jacking
   term (ADR-0012). Don't create a loop. Jacking keeps using the steering
   angle only, as its comment already says for static toe. Compute travel
   in the contact pass, then apply the toe curve where the wheel axes are
   built in the tire pass. Check whether `toe()` is also used anywhere that
   runs before travel is known (Ackermann, telemetry, the steering-rack
   torque). If it is, decide whether that use needs the dynamic toe, and
   write the reason in the ADR.
10. **Camber.** Add the camber curve, signed by side like static camber,
    where `w.camber` is computed. Body lean stays as it is. The curve is the
    linkage's change relative to the body.
11. **Out of scope:** compliance steer (toe from force through the bushings),
    toe and camber that depend on steer angle, roll steer on solid axles,
    unsprung mass, and any change to the tire models. Write them in the ADR's
    "Alternatives considered" or as follow-ups.

## Work, in order

Each phase should build and pass tests on its own. Commit after each one.

### Phase 1: definition and validation

- Rust: the curve type, its evaluator, the optional `kinematics` block on
  `SuspensionDef` with serde camelCase, and validation. Validation checks
  point count, increasing travel, finite values, zero at zero travel, the
  solid-axle rule, and that every curve value plus its static value stays
  inside the bound the scalar field already has (toe ±10°, anti ±2,
  roll centre ±1 m).
- TypeScript: types, `validate.ts` mirroring the Rust rules and messages,
  and the JSON schema. The schema test in `packages/core/test/schema.test.ts`
  should cover a definition with curves and the rejection cases.
- Definitions cross into WASM as JSON (`crates/skidpad-wasm/src/lib.rs`),
  so no ABI change should be needed. Confirm that.

### Phase 2: the model

- Implement decisions 7 to 10 in `four_wheel.rs`. Keep the
  no-curve branches exactly as they are now.
- Telemetry: add channels for each wheel's dynamic toe and each axle's
  jacking force (the net vertical link force), following how
  `PitchLinkLoad_F` and `PitchLinkLoad_R` were added. Camber already has
  channels.
- Snapshot: carry any new state and bump the version (decision 5). Restoring
  a snapshot must reproduce the run exactly, as the existing snapshot tests
  require.

### Phase 3: tests

Add a test file under `crates/skidpad-core/tests/` (for example
`kinematics_tests.rs`), in the style of `toe_tests.rs` and
`pitch_geometry_tests.rs`. It should cover:

- **Bit-exact compatibility:** the default definition and every preset give
  identical state hashes with no block, an empty block, and (where it makes
  sense) curves that are zero everywhere.
- **Each curve does what it says:** heave the body by a known travel at rest
  and read back toe, camber, roll-centre height and the anti fractions from
  telemetry or the model's state.
- **Jacking:** in a steady turn with a rising roll-centre curve, the body
  rises or falls as expected, and the front share of load transfer changes
  in the expected direction.
- **Stability is unchanged:** run the timestep sweep, the parked-on-slope
  checks and the locked-brake check on a vehicle with steep but valid curves.
  They must meet the same thresholds as now. If they can't, the curve slope
  needs a validation limit, set out in the ADR.
- **Proptest:** extend `proptest_tests.rs` so random valid curves never
  produce NaN or unbounded forces.

### Phase 4: curves for the Chrono E90

Derive the E90's curves from the comparison tool instead of fitting them.
Two possible sources; use the first that works:

1. **From the hardpoints, in `tools/chrono-compare/src/geometry.ts`.** The
   linkage solver already places each suspension at a given spindle height
   for the static roll-centre and anti values. Sweep it from full droop to
   full bump to get roll-centre height and both anti fractions against
   travel. Camber against travel comes from the solved upright's angle.
   Toe against travel needs the tie-rod (front) and toe-link (rear)
   hardpoints. Add those to `chrono-e90.ts` from Chrono 9.0.1's source as
   numbers only, each citing its source file as the existing constants do,
   and add them to `data/PROVENANCE.md` if the table there needs it.
2. **From Chrono itself.** If the solver can't produce toe reliably, add a
   K&C-style sweep script next to `tools/chrono-compare/chrono/bmw_e90.py`
   that heaves and rolls the parked car and logs each wheel's toe, camber and
   travel into a new committed reference file. It needs the PyChrono
   environment described in the comparison README, which is about 8 GB, so
   check the container's free disk space first. If it doesn't fit, stop and
   ask instead of guessing values.

Either way, check the result against Chrono's logged road-wheel angles. The
reference CSVs have `delta0`–`delta3` per wheel along with roll. During the
ramp steer, toe derived from the curves at the body's roll should follow
Chrono's falling toe (finding 2: about 0.9° front and 0.52° rear at 0.8 g).

Then use the curves in the E90 definition in `src/vehicle.ts`, rerun
`pnpm --filter @skidpad/chrono-compare fit` (the anti-roll bars are fitted
against roll gradient and load-transfer share, which the curves change), then
`compare`, and update `GAPS`, the regression guard in `src/chrono.test.ts`,
and `docs/validation/chrono-bmw-e90.md`.

**Expected results.** Write these into the doc as the targets before you
look at the results, as the doc did originally. Understeer gradient moves
from 0.01 toward 0.20 deg/g. Braking pitch moves from 3.3 toward 4.4 deg/g.
Pitch in the turn moves off zero. The front share of load transfer falls
with lateral acceleration. Nothing currently passing moves out of tolerance.
If a metric gets worse, report it honestly in the doc rather than tuning it
away. Add a column to the "How the comparison got here" table.

### Phase 5: presets (a separate commit, and its own PR if large)

The presets have no hardpoints, so any curves there are representative
values, not measurements. Add them only where a preset's `dataSheet` can cite
a source for typical camber gain, bump steer and roll-centre movement for
that suspension type (Milliken & Milliken; Gillespie). Otherwise leave the
preset without curves. If any preset changes, regenerate
`tools/validate/golden/`, re-record the determinism laps as `data/PROVENANCE.md`
describes, update the README tables, and add a changeset line starting with
`physics:`.

### Phase 6: docs and tooling

- ADR-0025 in `docs/adr/`, listed in `docs/adr/README.md`, with Context,
  Decision, Alternatives considered and Consequences, covering every
  decision above. Mark it as amending ADRs 0016, 0017 and 0018, and update
  their status lines if that is the repo's convention.
- `apps/docs/concepts/suspension.md`, `apps/docs/guide/definitions.md` and
  `apps/docs/tuning/index.md`: what the curves are, the offset convention,
  the sign of travel, and how to read them from a K&C sheet.
- The sandbox tuning editor (`apps/sandbox/src/TuningPanel.tsx`,
  `tuning.ts`): at minimum, a definition with curves must load and round-trip
  without losing them. A curve editor is optional; if it's left out, note it
  as a follow-up.
- README: update the Chrono paragraph and the Roadmap's "Not before 1.0"
  line so they no longer say travel-dependent geometry waits for multibody
  suspension.
- A changeset for `@skidpad/core`, a minor bump while still 0.x.

## Constraints

- **WASM size:** the core is 199.4 KB gzipped against a 200 KB budget
  (README). Check the size after Phase 2. If it goes over, find the cost
  before asking for the budget to be raised, and raise it only through the
  ADR.
- **Performance:** the one-car and twenty-car benchmarks must not regress
  measurably for vehicles without curves. Report the cost with curves.
- **Determinism:** no new floating-point functions beyond add, multiply and
  divide in the hot path, or use `skidpad-math` if any are needed. The
  cross-browser determinism check must pass.
- **Clean room:** every number taken from Chrono cites its source file.
  Use no Chrono code.

## Done means

- A definition can carry the five curves, and Rust and TypeScript validate
  them identically.
- Without curves, everything is unchanged: golden results, determinism
  hashes, benchmarks and existing tests.
- With curves, the new tests pass, and the stability suite passes on a
  vehicle that uses them.
- The E90 comparison uses derived curves, and its doc reports the new
  numbers against targets set beforehand.
- ADR-0025, user docs, a changeset and README updates are in.
- Everything CI runs passes locally: `cargo fmt`, clippy, Rust tests,
  `pnpm` lint, typecheck and tests, the validation runner, the Chrono
  comparison tests, the determinism check in Node, and the WASM size check.
