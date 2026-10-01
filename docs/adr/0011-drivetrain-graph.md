# ADR-0011: Drivetrain as a constrained rotational system solved implicitly

- Status: Accepted
- Date: 2026-10-01
- Supersedes / superseded by: replaces the interim `drive` block of
  milestones 1 to 3; builds on ADR-0005 and ADR-0010 (implicit wheel spin)

## Context

Until now the drive was a torque-versus-wheel-speed law split equally over
the driven wheels: no engine speed, no gears, no clutch, and an open
differential by construction. Milestone 4 needs an engine or motor with its
own inertia and speed, a clutch that slips and locks, a gearbox with a final
drive, open, locked and limited-slip differentials, a centre differential for
all-wheel drive, and electric motors, on both vehicle models.

Constraints, in order: stable at every substep rate from 250 Hz to 2 kHz with
a first-gear engine inertia reflected to the wheels that is tens of times a
wheel's own; deterministic (no allocation inside a step, fixed iteration
counts, `skidpad_math` only); brakes keep the exact-lock guarantee of
milestone 3 (no chatter); the tire stays the boundary condition of the
drivetrain, as ADR-0005 set out; snapshots stay a flat list of `f64`.

## Decision

**One rotational system per vehicle, in generalised coordinates.** The
coordinates are the wheel speeds (four on the four-wheel model, two axle
speeds on the single-track model) plus the engine or motor speed. The
gearbox, final drive and differentials have no speed state of their own:
their shafts are kinematic functions of the wheel speeds. The carrier speed
is `ω_c = Σ a_i ω_i` with `a_i = ½` on the wheels of a single driven axle, and
`a_i = f/2` front, `(1 − f)/2` rear for all-wheel drive with front torque
fraction `f` (an epicyclic centre differential; virtual work gives the same
split for torques). The gearbox input turns at `R ω_c` with
`R = gear ratio × final drive`. The inertias upstream of the differentials
(gearbox output and propshaft at carrier speed, gearbox input and clutch disc
at `R` times that) are reflected onto the wheels through these weights, so
the mass matrix is `M_ij = δ_ij I_i + I_up a_i a_j` with `I_i` the wheel's
effective inertia including the implicit tire stiffness term of ADR-0010.
The engine is its own diagonal entry.

**Everything with a limit is a bounded velocity constraint**, solved by
projected Gauss-Seidel on the impulses with the exact mass matrix (five
unknowns at most, inverted directly each substep):

| Constraint        | Relative speed driven to zero | Impulse bound per substep                        |
| ----------------- | ----------------------------- | ------------------------------------------------ |
| Clutch            | `R ω_c − ω_e`                 | `± C · dt`, `C` the clutch capacity (∞ electric) |
| Centre diff lock  | `ω_c,front − ω_c,rear`        | open: absent; locked: ∞; LSD: see below          |
| Axle LSD or spool | `ω_left − ω_right`            | open: absent; locked: ∞; LSD: see below          |
| Brake, per wheel  | `ω_i`                         | `± brake torque · dt`                            |

A clutch-pack limited-slip differential with torque bias ratio `b` and
preload `T_p` may transfer at most
`T_p + |T_carrier| · (b − 1) / (2 (b + 1))` from the faster to the slower
output (the open split is `T_c/2` each; at the bias limit the outputs carry
`b T_c/(b+1)` and `T_c/(b+1)`), with separate ratios for drive and coast
(Milliken & Milliken, _Race Car Vehicle Dynamics_, ch. 20 **[VERIFY]**).
The carrier torque is the clutch impulse of the current iteration times the
ratio, so the bound is re-evaluated as the solve converges. Twenty
iterations, fixed, with the brake constraints last in each sweep: a brake
within its capacity therefore leaves its wheel at exactly zero speed, which
keeps the no-chatter lock of milestone 3. Tire torques, the engine torque and
the direct-drive torque are explicit generalised forces applied before the
constraints; the wheel–tire mode stays implicit through the effective
inertia.

**Power units.**

- `direct`: the former `drive` law, a carrier torque
  `T_max · throttle · (1 − |ω_c| / ω_max)`, no engine state. The default.
- `combustion`: a full-throttle torque curve over rpm, interpolated
  piecewise-linearly; closed-throttle engine braking linear in speed between
  an idle and a redline value, blended by throttle and treated implicitly;
  an idle governor (proportional, capped) that keeps the engine turning,
  which stands in for a starter so the engine never stalls; a smooth rev
  limiter over the last 2 % below redline; crank inertia.
- `electric`: constant torque to the base speed, constant power beyond it,
  fading to zero at the maximum speed; lift-off regeneration fading out
  below walking pace; rigid coupling (the clutch bound is infinite); one
  ratio; reverse by turning the motor backwards.

**Transmission.** Forward ratios, a reverse ratio, a final drive, a shift
time during which the clutch is open (torque interruption), and a clutch
re-engagement time. `automatic` shifts on the gearbox input speed at
fractions of redline with a hold after each shift; `manual` follows the
`gear` input. In automatic mode a gear request of zero means drive, so a
definition with no gear input drives forward as before; a negative request
is reverse. The clutch capacity is the pedal's remainder times an automatic
law that bites between idle and a set speed above it, so a car launches
under throttle, creeps little at idle, and idles with the brakes held; a
manual definition may turn the automatic law off.

**Inputs** gain `clutch` (0 engaged … 1 open) and `gear` (requested gear:
negative reverse, zero neutral or drive, positive gear number). The input
stride is six. **Telemetry** gains `EngineRpm`, `EngineTorque`, `Gear`,
`ClutchSlip`, `ClutchTorque`, `DiffLockTorque_F`, `DiffLockTorque_R` and
`CenterLockTorque`; `DriveTorque_*` becomes the half-shaft torque, recovered
from each wheel's solved acceleration. **Snapshots** add the engine speed,
the gear, the shift timer and the clutch engagement; `snapshot::VERSION`
becomes 2 and the WASM ABI version 3.

## Alternatives considered

- **A general node-and-edge graph with its own speed per shaft.** The
  roadmap's name for this work, and the right shape once drivetrains branch
  further (per-wheel motors, a transfer case with its own gearing). Rejected
  for now: every supported topology reduces to the wheel speeds plus one
  power unit, and the reduction removes the stiff rigid-ratio constraints
  that a graph solver would otherwise have to iterate on. The definition is
  written so a graph can replace the solver without changing it.
- **Sequential impulses without the exact mass matrix** (treating each
  coupling independently, as game engines do). Cheap, but with a first-gear
  engine inertia reflected at thirty times a wheel's, the clutch constraint
  converges slowly and the car surges on launch. The exact inverse is a
  5 × 5 solve: free.
- **A direct active-set solve** of the bounded system. Exact, but the
  iteration count depends on the data and the code is several times larger.
  Projected Gauss-Seidel with a fixed count is deterministic by construction
  and the residual after twenty sweeps is below telemetry resolution in
  every test.
- **A torque-converter automatic.** Would add a state and a characteristic
  curve for a feel difference the tire tests do not see. The automatic clutch
  law gives the launch behaviour; a converter can come as a power-unit
  option later.
- **Stalling the engine.** Realistic, punishing with a keyboard, and it needs
  a starter input. The idle governor holds the engine instead; documented.

## Consequences

- Every preset gets a drivetrain: the hatchback a combustion engine with a
  five-speed automatic on an open front differential, the sports car a
  six-speed with a clutch-pack limited-slip differential, the kart a
  single-speed with a centrifugal-style automatic clutch and a solid rear
  axle (a locked differential). Validation results move (0–100 km/h now
  includes shifts) and the golden file, the scripted-drive hashes and the
  recorded laps are regenerated; this is a `physics:` change.
- The interim `drive` block is gone from the format. The TypeScript layer
  migrates a legacy `drive` into `drivetrain: { kind: "direct", … }`; the
  format version stays 1 because every definition without a `drivetrain`
  reads as before.
- Guarded by: unit tests on the solver (locked clutch equals one lumped
  inertia, slipping clutch transmits its capacity, bias ratio at the LSD
  limit, open centre split, exact brake lock under a driven wheel), the
  existing parked, brake-lock, timestep-sweep and determinism tests on every
  preset, new launch and shift tests, and the validate tool.

## Amendment (2026-10-01): measured engine braking

The closed-throttle drag was a line from `engineBrakingIdle` to
`engineBrakingRedline`. Motoring maps rise faster than a line at high revs:
fitting the Project Chrono BMW E90's map with one left the line 8 N·m too
strong at 4 000 rpm and its coast-down 6 % short
(`docs/validation/chrono-bmw-e90.md`). A combustion power unit now takes an
optional `engineBrakingCurve` of `[rpm, N·m]` points, drag positive,
interpolated and held flat beyond its ends like `torqueCurve`. When it has
points it replaces the line, and its local slope feeds the implicit damping
term as the line's slope did. A curve through the line's two end points
reproduces the line.
