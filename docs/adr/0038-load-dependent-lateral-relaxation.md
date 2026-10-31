# ADR-0038: Load-dependent lateral relaxation length

- Status: Proposed
- Date: 2026-10-31
- Supersedes / superseded by: none; amends ADR-0008 (feel tire) and
  ADR-0010 (contact-patch deflection)

## Context

The lateral relaxation length, the distance a tire rolls before its side
force builds, was one number per tire at every load: 0.3 to 0.45 m on the
road presets, and `SKIDPAD_RELAXATION_LENGTH_LAT` (0.35 m by default) on a
Magic Formula tire. Real tires lag more when loaded. Treating the contact
patch's lateral deflection as a spring of roughly constant carcass
stiffness `CFy`, the relaxation length is `σα = Cα / CFy`, so it rises and
saturates with load as the cornering stiffness does. The MF 5.2 transient
equations give it that shape with two coefficients, `PTY1` and `PTY2`,
which `.tir` files carry (the Chrono Sedan's has them) and which the
importer used to ignore.

## Decision

**Feel tire: `lateralRelaxationFollowsLoad`**, default false. When set,
`σy(Fz) = relaxationLengthLat · Cα(Fz) / Cα(Fz0)`, so `relaxationLengthLat`
is the length at the nominal load. The feel tire's cornering stiffness
already follows `sin(2·atan(Fz / stiffnessPeakLoad))`, the same shape as
the Magic Formula's relaxation length. The ratio comes from the stiffness
the substep works out anyway, so it costs one division.

**Magic Formula tire: `PTY1` and `PTY2`**, default 0. With both positive,
`σα = PTY1 · sin(2·atan(Fz / (PTY2 · Fz0'))) · R0` replaces
`SKIDPAD_RELAXATION_LENGTH_LAT`. The camber factor `1 − PKY3·|γ|` of the
published form is left out (it is a few percent on road tires), and so is
the `λσα` scaling factor. `PTX1` to `PTX3` (longitudinal) stay unread.

**Where the load enters.** Both vehicle models step the transient slip of
ADR-0010 with the relaxation length at the wheel's load that substep,
through `TireAtLoad`. The state is still the transient slip, so a change
of length rescales the stored deflection with it. The low-speed damping's
contact-patch rate `C / σ` uses the same length; with the length following
the load that rate is the constant carcass stiffness, as it should be. A
wheel off the ground has no length, which the transient already floors.

**The four road presets turn it on**, with their quoted lengths unchanged
as the values at the nominal load. The kart and open-wheeler stay fixed.

## Consequences

- At 80 km/h step steer, yaw-rate overshoot falls from 4.1 to 3.5 % on the
  hatchback and from 2.4 to 1.9 % on the pickup; response times, steady
  gains, understeer gradients and lane-change pass speeds do not change
  beyond the golden tolerances. The lightly loaded inner and rear tires
  relax over shorter distances, which damps the yaw mode a little.
- The pickup's understeer gradient at a 30 Hz host now differs from
  60–240 Hz by up to 0.005 deg/g (was under 0.001), from its solid rear
  axle; the sweep's limit is 0.05.
- The Chrono comparisons pin the length to 0.02 m because Chrono's tires
  are steady-state, so `sedan.ts` sets `pty1` to 0 now that the Sedan
  file's `PTY1`/`PTY2` would otherwise be read.
- With both options off, every definition runs bit for bit as before.

## Alternatives considered

- **Model the carcass stiffness directly** (a `lateralCarcassStiffness` in
  N/m, `σ = Cα / CFy`). Equivalent at the nominal load, but a new number to
  tune instead of the familiar length.
- **Make every feel tire follow the load.** Would move every golden and
  every saved definition; opt-in matches ADR-0028's pattern.
