# ADR-0026: Suspension geometry that changes with travel

- Status: Proposed
- Date: 2026-10-03
- Supersedes / superseded by: none; amends ADR-0016 (roll centres),
  ADR-0017 (static toe) and ADR-0018 (anti-dive and anti-squat)

## Context

ADR-0016, ADR-0017 and ADR-0018 gave the raycast suspension a roll-centre
height, a static toe and anti-pitch fractions, all fixed at ride height.
The comparison with Project Chrono's multibody BMW E90
(`docs/validation/chrono-bmw-e90.md`) traced most of what stayed outside
tolerance to geometry that Chrono lets move and Skidpad held fixed:
the braking pitch (3.3 against 4.4°/g), the pitch in a turn (none against
0.34° at 0.7 g), a front share of lateral load transfer that stayed at
55 % where Chrono's falls from 60 % to 51 %, and toe that falls as the body
rolls. Camber was the static value plus the body's lean, with no gain from
the linkage.

The roadmap had left travel-dependent geometry for after 1.0, with
multibody suspension. Commercial vehicle-dynamics tools carry it without a
multibody solver, as lookup tables of what a kinematics-and-compliance rig
measures. That is a definition-format addition, so it belongs before the
format is frozen at version 1.

## Decision

1. **Representation.** A curve is a piecewise-linear table of
   `[travel, value]` pairs: travel in metres from the static ride position,
   positive in bump (the model's existing sign), strictly increasing, 2 to
   16 points. Outside the table the value holds at the end point. The
   evaluator (`crates/skidpad-core/src/kinematics.rs`) uses comparisons,
   add, multiply and divide only, so it is deterministic.
2. **Offsets from the static values.** `staticToeDeg`, `staticCamberDeg`,
   `rollCenterHeight`, `antiBrake` and `antiDrive` stay the ride-height
   values; a curve adds to its field. Every curve must pass within 1e-9 of
   zero at zero travel, so the static field is the one source of truth and
   the tuning editor's existing controls keep working.
3. **Where they live.** An optional `suspension.kinematics` block with
   five optional curves, `toeDeg`, `camberDeg`, `rollCenterHeight`,
   `antiBrake` and `antiDrive`, in the units of the field each offsets.
   They describe the left wheel; the right mirrors them through the `side`
   sign, as static toe and camber do.
4. **No curve, no change.** Without the block, or with an empty one, every
   branch of the four-wheel model is the code that ran before, and the
   physics is unchanged bit for bit: every preset's telemetry, every golden
   validation value and the benchmark. Zero toe, camber and anti curves are
   also bit-for-bit no-ops. The state hashes do change, because the
   snapshot gains state (decision 5), so the six golden scripted-drive
   hashes were regenerated with no other golden value moving, as ADR-0018
   did. `crates/skidpad-core/tests/kinematics_tests.rs` checks all of this
   for the default car and the six presets.
5. **Format version.** The definition `formatVersion` stays 1: the block
   is optional and additive, as ADR-0017's and ADR-0018's fields were, so
   no migration step is needed. The snapshot format goes to version 5. Each
   wheel's lateral force from the previous substep is now state (decision
   7), so the body state grows from 18 to 22 values.
6. **Single-track model and solid axles.** The single-track model ignores
   the block, as it ignores static toe and camber. On a `solid` axle the
   beam sets the wheel angles (ADR-0016), so validation rejects `toeDeg`
   and `camberDeg` there, and the model ignores them if a caller skips
   validation. The other three curves are accepted.
7. **A roll centre that moves, and jacking.** With a `rollCenterHeight`
   curve the axle switches from the per-axle couple of ADR-0016 to a
   per-wheel form. Each wheel's link carries a vertical force equal to its
   own body-frame lateral force from the previous substep times the slope
   from its contact patch to the roll centre, with the height evaluated at
   that wheel's travel: `−2 · side · F_y,i · h_rc(z_i) / t`. With equal
   forces and heights this is ADR-0016's transfer; when they differ, the
   forces no longer cancel, and the net is the jacking force that lifts or
   lowers the body. It takes the same one-substep lag ADR-0016 accepts.
   Only an axle with a roll-centre curve uses the per-wheel form, so
   decision 4 holds, but even a zero curve switches the form, so a zero
   roll-centre curve is not a no-op.
8. **Anti-pitch.** With an `antiBrake` or `antiDrive` curve, the fraction
   is evaluated at each wheel's own travel. The axle's longitudinal force
   still splits evenly between its wheels, and the force's sign still picks
   the braking or the drive geometry.
9. **Toe and the order within a substep.** Travel already depends on steer
   through the steer jacking of ADR-0012, so the toe curve must not feed
   back into it. Jacking keeps reading the steering angle only. The contact
   pass computes travel, and the tire pass adds the toe curve where it
   builds the wheel axes. `toe()` is used in one place, before travel is
   known, for the static toe that the contact pass puts into each wheel's
   angle. Ackermann works on the steering angle alone and never read toe.
   The rack force reads the tire outputs, which already see the dynamic
   toe. `WheelSteer_*` reports the full road-wheel angle, so none of these
   needs the dynamic toe earlier. New channels `Toe_FL` … `Toe_RR` report
   each wheel's toe, and `JackingForce_F` and `JackingForce_R` the net
   vertical link force per axle.
10. **Camber.** The camber curve adds where `w.camber` is computed, signed
    by side like the static camber. Body lean stays as it was, so the curve
    is the linkage's change relative to the body.
11. **Out of scope:** compliance steer, toe and camber that depend on the
    steering angle, roll steer on solid axles, unsprung mass, a roll centre
    that moves sideways, and any change to the tire models.

## Alternatives considered

- **Splines or polynomials.** Smoother, but cubic evaluation needs more
  care to stay deterministic and monotone, and K&C sheets come as tables.
  Sixteen linear points cover a stroke at 1 cm spacing.
- **Absolute values instead of offsets.** It would duplicate the static
  value in the curve and leave two sources of truth that the editor's
  sliders could pull apart.
- **Multibody suspension.** It is the full answer, at the cost of unsprung
  bodies and constraint solving that ADR-0009 kept out for stability. The
  curves carry most of the benefit at the cost of a table lookup.
- **A limit on curve slope.** The timestep sweep, the parked-on-slope
  checks and the locked-brake check pass on a car with steep curves (toe
  ±1° over 10 cm, camber ±2.5°, roll centre ±0.15 m, anti ±0.3) at the
  existing thresholds, so no slope limit was needed.
- **Keeping the per-axle couple with a moving height.** It cannot jack,
  which is half of what finding 4 of the Chrono report needed.
- **Compliance steer, and toe against steering angle.** Left as follow-ups.
  The Chrono comparison found its car's toe follows force more than travel
  (below), so compliance steer is the next candidate.

## Consequences

Definitions without the block behave exactly as before. The six presets
carry no curves: they have no hardpoints, and no data sheet could cite
values for them, so the golden results other than the state hashes, the
determinism laps and the README tables are unchanged. Adding curves to the
presets, with sources, is a follow-up, as is a curve editor in the sandbox.
The sandbox already loads, shows and round-trips a definition with curves.

Costs, measured:

- **WASM size.** The definition's JSON handling for the new block and its
  validation messages cost about 6.3 KB gzipped (5.1 KB and 1.2 KB), and
  the model 0.4 KB. The core went from 199.0 KB to 205.6 KB against a
  200 KB budget that had 1 KB left. The budget is raised to 224 KB, in
  `scripts/build-wasm.mjs` and the README.
- **Performance.** Without curves the one-car and twenty-car benchmarks
  show no difference beyond run-to-run noise (about ±10 %). With all five
  curves on both axles, twenty cars run 0 to 6 % slower, about 2 to 3 µs
  per car-step.

The Chrono comparison derives the E90's roll-centre and anti curves from
its hardpoints and its camber curve from a kinematics sweep of Chrono's
parked car. With them, the braking pitch (4.33 against 4.37°/g) and the
pitch in the turn come inside tolerance. The front share of load transfer
falls with lateral acceleration, from 56.5 % to 51.7 % against Chrono's
60.6 % to 51.6 %, and the rear-left load trace comes inside. The roll per g
now grows with lateral acceleration faster than Chrono's, which moves the
ramp and step-steer roll traces outside. Chrono's toe does not follow its
own toe-against-travel kinematics while it drives; it moves with force. So
the comparison car keeps a fixed toe, and the understeer gradient does not
improve.

Guarded by `crates/skidpad-core/tests/kinematics_tests.rs`
(compatibility, each curve at a known travel, jacking, snapshots), the
steep-curve cases in `timestep_sweep_tests.rs`, `parked_tests.rs` and
`brake_lock_tests.rs`, the random-curve proptest in `proptest_tests.rs`,
`crates/skidpad-core/tests/fixtures/kinematics_validation.json` (shared by
the Rust and TypeScript validators), `packages/core/test/kinematics.test.ts`
and `tools/chrono-compare/src/chrono.test.ts`.
