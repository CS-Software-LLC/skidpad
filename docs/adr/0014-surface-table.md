# ADR-0014: Surface table, with the surface scaling the tire inside the core

- Status: Accepted
- Date: 2026-10-01
- Supersedes / superseded by: none; builds on ADR-0009 (host contract) and
  ADR-0010 (low-speed handling)

## Context

Until now every wheel ran on the surface its tire was parameterised on. The
host contract of ADR-0009 already carried a `surface_id` per wheel contact,
reserved for this milestone, and the presets package declared a one-entry
surface table. Milestone 6 has to make a surface mean something: a wet patch,
a gravel trap, grass beside the track, ice.

Constraints: deterministic and allocation-free in the step, so a surface
cannot be an arbitrary callback into the application; replays must carry the
surface, so it has to act inside the core; no new per-vehicle state if it can
be avoided; a host must be able to tag colliders with ids the application has
not described yet without anything failing; both tire models must respond the
same way.

## Decision

**A fixed table on the world, looked up by contact id.** The world holds a
`SurfaceTable` of at most 16 entries; entry `i` is surface id `i`. An
external host writes the id with each wheel contact (the last slot of the
host-sync contact record); the built-in flat ground carries one id per
vehicle (`set_surface`). Ids beyond the table read as id 0, so an untagged or
over-tagged collider is the reference surface rather than an error. The table
is set from JSON through `sp_world_set_surfaces`, validated first and left
unchanged on error.

**Three numbers per surface.**

- `grip` multiplies the tire's peak and sliding friction, exactly where the
  Magic Formula puts a change of road: the `λμx`, `λμy` scaling factors
  (Pacejka, _Tire and Vehicle Dynamics_, §4.3.2). The feel model scales its
  `peakFriction` the same way. The slip stiffness is untouched, so a slippery
  surface peaks at a smaller slip, which is what a tire on ice does and what
  makes it feel treacherous rather than merely weak.
- `rollingResistance` multiplies the tire's rolling-resistance moment.
- `drag` is a ploughing resistance, N per N of load, for surfaces the tire
  sinks into (gravel, sand, snow). It acts on the chassis at the contact,
  against the contact-patch velocity in the plane, not on the wheel: the
  material resists the tire's motion, it does not brake the wheel's spin.
  Like the rolling resistance of ADR-0005 it goes smoothly through zero
  below the tire's low-speed floor, so a car parked on gravel sees a viscous
  force and never a sign-switching one.

The scales travel with the tire input (`TireInput::grip`,
`TireInput::rolling_resistance`), so the standalone tire API and the
explorers can show a surface too. Telemetry reports `SurfaceId_*` and
`SurfaceGrip_*` per wheel.

**A reference table in `@skidpad/presets`** with eleven surfaces, each with a
source: friction coefficients by surface from Wong, _Theory of Ground
Vehicles_, ch. 1 and Gillespie, _Fundamentals of Vehicle Dynamics_, ch. 10;
rolling resistance by surface from Wong; the ploughing figures from the order
of magnitude of motion resistance in Wong's terramechanics chapter. The
validation runner brakes every preset on wet asphalt, gravel, snow and ice.

## Alternatives considered

- **Surface as a per-vehicle definition field.** Wrong shape: the surface is
  under the wheel, not on the car, and changes wheel by wheel across a
  kerb.
- **Scaling the force after the tire model** (multiply `fx`, `fy` by grip).
  Simple, but it also scales the slip stiffness, so an icy tire would reach
  its tiny peak at the same slip as a dry one and feel like a weak dry tire.
  Scaling `μ` inside the curve keeps the stiffness and moves the peak.
- **Per-surface stiffness and relaxation scales.** Real, but second order and
  without a clean published parameterisation; they can be added as columns
  later without changing the table's shape.
- **A callback per contact** (the host computes the scales). Not
  deterministic across hosts and not replayable from the recorded inputs.

## Consequences

- The reference table (every id → scales of 1, drag 0) is bit-identical to
  the previous physics; the surface tests assert it.
- Replays and hashes include the surface, because the contact ids are part
  of the host-sync input and the table is world state set before the run.
- A vehicle with brakes on the rear axle only (the kart) swaps ends on ice
  under full braking; the straight-line scenario now reports a `spun` flag
  and measures the stop by speed over ground rather than forward speed.
- Guarded by tests: grip halves the peak of both tire models with the
  stiffness unchanged; the stop on ice takes four to six times the dry
  distance on both vehicle models and still locks once without chatter; the
  world looks contacts up by id from the host and reads unknown ids as the
  reference; rolling resistance and ploughing slow a coasting car; a car
  parked on gravel on a grade stays put; bad tables are rejected.
