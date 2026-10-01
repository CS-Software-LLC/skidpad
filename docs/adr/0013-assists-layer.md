# ADR-0013: Driving assists as a stateless stage inside the core

- Status: Accepted
- Date: 2026-10-01
- Supersedes / superseded by: none; builds on ADR-0011 (brake constraints)
  and ADR-0012

## Context

"Arcade to sim from one model" means the assists sit on top of the same
physics, and a replay must reproduce them: anything that changes the forces
has to run inside the deterministic core, not in the application. Until
now the only assist was the sandbox's speed-sensitive steering limit, in
JavaScript, which replays could not see. Milestone 5 adds anti-lock braking,
traction control, stability control and the steering limit as a core stage,
all off by default so every existing result is unchanged.

Constraints: deterministic and allocation-free; no new snapshot state if it
can be avoided (the determinism contract is simpler without controller
memory); stable at every substep rate; defaults off; each assist observable
in telemetry.

## Decision

**A stateless stage between the input and the wheel solve.** Each substep,
after the tire forces are known and before the drivetrain and brake
constraints are solved, the assists stage reads the current slips, the yaw
rate and the speed, and modifies the brake capacities, the throttle and the
steer angle for this substep only. No controller state is carried; the tire
transient and the body dynamics are the filter.

- **Anti-lock braking** (`assists.abs`): a wheel's brake capacity is scaled
  by `clamp((κ_release − |κ|) / (κ_release − κ_target), floor, 1)` when it
  brakes (`κ < 0`), with `κ_target` the slip ratio where the tire peaks
  (default 0.12), `κ_release` where the brake is at its floor (default 0.3)
  and a floor of 0.15 so the wheel is never freed completely. Below
  `minSpeed` (2 m/s) the assist stands down and the wheel may lock, as
  production systems do. It is an ideal, continuous ABS: no cycling.
- **Traction control** (`assists.tractionControl`): the throttle to the
  power unit is scaled by the same shape on the largest driven-wheel drive
  slip (`κ > 0`), with its own target (0.10) and release (0.25) and no
  floor; standing still with the brakes on is left alone.
- **Stability control** (`assists.stabilityControl`): the reference yaw rate
  is the neutral-steer `V · tan δ / L` clamped to `μ g / V` (with `μ` the
  front tire's peak friction), and the error `r − r_ref` beyond a dead band
  (0.05 rad/s) brakes one wheel with `gain · |error|` N·m: the outer front
  when the car yaws faster than the reference (oversteer), the inner rear
  when slower (understeer), and scales the throttle down by the same
  fraction. The brake torque goes through the ordinary bounded brake
  constraint, so a locked wheel stays exactly locked (ADR-0011).
- **Steering assist** (`assists.steeringAssist`): the road-wheel angle is
  limited to `L · a_lim / V²` (default `a_lim` 9 m/s²), the lateral
  acceleration a steady turn at the current speed would need, so a digital
  input gets full lock at walking pace and a few degrees at speed. This is
  the sandbox's limit moved into the core; the sandbox's own copy goes.

**Telemetry**: `AbsActivity` and `TcActivity` (1 − the applied scale, 0 when
idle), `EscYawError` (rad/s, after the dead band), `EscBrakeTorque` (N·m
applied), `SteerAssistScale` (1 when not limiting), `ThrottleEffective`
(what reached the power unit).

**Validation**: the straight-line scenario reports the braking distance
with the ABS enabled beside the locked-wheel distance, so the gap to
published (ABS) road-test figures is visible per preset.

## Alternatives considered

- **Assists in the application layer** (the input package). Cheap, and
  wrong for replays and hashes, which is why the sandbox's steering limit
  had a comment promising this move.
- **Cycling ABS with hysteresis state.** More like production hardware, but
  the cycle rate would depend on the substep rate and the state would need a
  place in the snapshot. The continuous law gives the same stopping
  distance within a percent and keeps the snapshot layout.
- **A full ESC with a vehicle model observer.** Needs side-slip estimation
  and tuning per vehicle. The neutral-steer reference with a dead band is
  what a first-generation system did and is tunable with one gain.

## Consequences

- Defaults off: golden results, hashes and laps do not change until a
  definition enables an assist. The presets stay sim-grade; the sandbox
  exposes toggles.
- Replays carry the assists, because the inputs that reach the physics are
  computed inside the core from the recorded raw inputs.
- Guarded by tests: ABS shortens the 100–0 km/h stop and keeps the wheels
  rolling above the stand-down speed; traction control holds launch slip
  near the target; stability control brings a provoked step-steer yaw-rate
  overshoot down; the steering limit matches the former sandbox law.
