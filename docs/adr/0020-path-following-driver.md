# ADR-0020: A path-following driver inside the core

- Status: Accepted
- Date: 2026-10-01
- Supersedes / superseded by: none

## Context

Traffic, opponents and ghost-free demos need cars that drive themselves
along a line. A driver is a small controller that turns the car's pose and
speed into steer, throttle and brake each host step. Written in TypeScript
it would cost a call across the WASM boundary per car per step and, worse,
would compute its inputs with the host's `Math.sin` and `Math.atan`, which
are not bit-identical across browsers, so a field of AI cars would not be
deterministic (ADR-0006). The lane-change validation (milestone 6) already
has a pure-pursuit driver in the core.

## Decision

The core gets `ai::AiDriver`, set per vehicle with `World::set_ai(path,
config)`: a polyline (open or closed), an optional lateral offset, and a
speed profile. Steering is pure pursuit (Coulter 1992) on a point one
look-ahead down the path, `κ = 2 · lateral / L²`, turned into a road-wheel
angle through the bicycle geometry plus the linear understeer gradient,
`δ = atan(L κ) + K_us v² κ`, as in the lane change. The speed profile is
the quasi-steady-state construction: each point is capped at
`√(a_lat / κ)` from the circle through it and its neighbours, then a
backward pass caps each by braking into every slower point ahead at
`brakeDecel`, and a forward pass by accelerating out of every slower point
behind at `driveAccel`; a closed path runs each pass twice to settle the
wrap. Between points the planned speed follows the same braking and
acceleration curves, so long segments brake late. The pedals are a PI
controller on the planned speed a short lead ahead. At the end of an open
path the driver brakes to a stop.

The driver runs inside `World::step`, after the external host record is
read and before the substeps, and writes its steer, throttle and brake into
the vehicle's input record. Telemetry and a replay recorder therefore see
exactly what it applied, and a replay plays back without the driver.
Handbrake, clutch and gear stay the application's.

Everything is computed when the path is set (which allocates); a step
searches a window of segments around the last match and interpolates, with
no allocation. The driver's running state (the matched segment, the pedal
integrator, the lap count) is not part of the vehicle snapshot: restoring
or resetting the vehicle resets the driver, which then searches the whole
path. That is deterministic, so a run with a restore is reproducible, but
it is not the same run as one without the restore.

The WASM ABI takes the path as a flat f64 buffer and the config as eleven
f64 values (NaN for a default) rather than JSON, which kept the core under
its 200 KB gzipped budget. The TypeScript layer validates the config field
by field first.

## Alternatives considered

- **A TypeScript driver.** Not deterministic across engines, and a
  boundary call per car per step; rejected for the reasons above.
- **Putting the driver state in the snapshot.** It would make a restored
  run identical to an uninterrupted one, at the cost of a snapshot format
  change for something that is not vehicle physics. Replays record the
  inputs the driver produced, which is what they need.
- **A racing AI** (racing line optimisation, overtaking, awareness of other
  cars). Out of scope before 1.0 (see the roadmap); the helper is the
  building block such an AI would steer through its path and offset.
- **Stanley or model-predictive steering.** Stanley needs the front-axle
  path error and behaves worse at low speed; MPC is far more code for a
  helper. Pure pursuit is already proven on the lane change.

## Consequences

- A field of AI cars is deterministic and costs no boundary calls; it
  composes with level of detail (the driver uses only the planar pose and
  forward speed both models have).
- The driver is only as good as its path: a path through corners tighter
  than the car can take at `lateralAccel` will run wide, and `lateralAccel`
  above the car's grip will understeer off the line.
- Guarded by `crates/skidpad-core/tests/ai_tests.rs`: within 0.6 m of a
  50 m circle at the planned speed, braking for an oval's corners while using
  its straights, stopping at the end of an open path, honouring the offset,
  through level changes, and reproducible with and without a restore.
