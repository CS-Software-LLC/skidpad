# ADR-0002: Substep-rate chassis proxy with end-of-step impulse application

- Status: Accepted
- Date: 2026-10-01

## Context

Tire forces are stiff: a few millimetres of slip change the force by a large
fraction of the vertical load. Computing tire forces at a 1 kHz substep rate but
applying them to the host rigid body only once per 60 Hz host step lags the
tire-chassis coupling by up to a full host step. That lag is the classic source
of low-speed oscillation, stiff-tire instability, and "the car vibrates when
parked".

## Decision

The core keeps a lightweight proxy of the chassis velocity state: linear and
angular velocity plus mass, centre of mass, and inertia tensor, sampled from the
host at the start of each host step. During each substep, tire, suspension, and
aerodynamic forces integrate that proxy, so the wheels see a chassis that
responds at the substep rate. At the end of the host step the core reports the
accumulated net linear and angular impulse, and the adapter applies it to the
host body before the host integrates. Collisions, joints, and everything that is
not the vehicle's own forces stay with the host.

The proxy assumes contact geometry (contact points, normals, surface IDs) is
constant within a host step. The adapter queries contacts once per host step.

In milestone 1 the built-in minimal host uses the same structure: the bicycle
model's chassis _is_ the proxy and the "host" integrates pose from the proxy's
velocities.

Amended by ADR-0009 (milestone 2): the proxy also integrates its own copy of
the pose within the host step, because suspension forces depend on where the
wheel rays hit; and adapters hand the accumulated impulse to the host as a
force over the next host step rather than as a kick before it, which keeps the
host's own gravity integration and the proxy in agreement.

## Alternatives considered

- **Forces once per host step.** Simplest, and what most raycast vehicles do.
  Rejected because of the lag described above.
- **Run the whole host at substep rate.** Correct but makes the vehicle cost
  the entire scene's collision detection at 1 kHz. Rejected on performance.
- **Substep only the wheel spin and drivetrain, not the chassis.** Fixes stiff
  wheel-inertia problems but not the tire-chassis coupling. Rejected as
  insufficient; it is what the proxy approach reduces to when the proxy mass is
  infinite.

## Consequences

- The validation runner must show that the proxy and a forces-once-per-step
  baseline converge as the host rate rises, and that the proxy is stable at
  rates where the baseline is not. That scenario is part of the timestep sweep.
- Driving on moving platforms works because the contact query reports the
  contact body's velocity and the proxy subtracts it.
- Hosts that cannot apply an angular impulse separately need the adapter to
  convert it into an equivalent off-centre linear impulse. Rapier and Jolt both
  support angular impulses directly.
