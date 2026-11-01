# ADR-0039: Parking twist

- Status: Proposed
- Date: 2026-11-01
- Supersedes / superseded by: none; adds to ADR-0012 (steering torque) and
  ADR-0010 (contact-patch deflection)

## Context

Parked, the only steering torque was the kingpin lift, about 1 N·m at the
hand wheel on the road presets. A real tire turned on the spot resists
much more: its contact patch first twists elastically, then slides once
the moment reaches what friction over the patch can hold, which is why a
parked car without power steering is hard to turn. The aligning moment of
the tire models depends on slip, which is zero at standstill, so none of
this showed. It was the second item of the force-feedback polish list.

## Decision

**A torsional state per steered wheel.** Each steered wheel carries a
patch twist `θ`, the wheel's yaw about the contact normal since the patch
last stuck. Every substep it takes the wheel's turn (its change in
road-wheel angle plus the body's yaw over the substep) and then:

- **Rolling unwinds it** over one patch length `2a`, implicitly:
  `θ ← (θ + Δψ) / (1 + |vx|·dt / 2a)`, so a fast roll cannot overshoot.
- **A spring up to the slide.** The moment on the wheel is `−k·θ` with
  `k = torsionalStiffness · Fz / 1000`, until it reaches the moment that
  slides a round patch of radius `a` under uniform pressure,
  `⅔·μ·Fz·a` (the textbook bore torque of a circular contact), with `μ·Fz`
  the tire's lateral force peak at that load and surface. Past it the
  patch slips and `θ` stays at the limit, so turning back unloads it
  elastically at once.
- **It fades out with rolling speed** like the low-speed damping (the same
  smoothstep to zero at `lowSpeedDampingFade`, 2 m/s by default). A
  rolling tire's turn-slip moment is not modelled, and fading keeps every
  run above walking pace bit for bit the same as with the option off.

The moment adds to the wheel's aligning moment (`out.mz`), so it reaches
the kingpin torque, the hand wheel, the `Mz` channels and the aligning
share of the steering breakdown (ADR-0031). There are no new channels.

**Not on the body.** The moment is left out of the chassis torque. A real
parked car does feel it, but its static rolling resistance and brakes
hold it; the core has neither as a stiction, and with the moment on the
body the parked hatchback crept 4 cm/s and unwound its own patches.

**Two tire settings, off by default.** `contactRadius` (m) and
`torsionalStiffness` (N·m/rad per kN of load) on both tire models, the
Magic Formula's as `SKIDPAD_CONTACT_RADIUS` and
`SKIDPAD_TORSIONAL_STIFFNESS`. Both must be positive, on a steered axle,
for the twist to run. Four-wheel model only; the single-track model
ignores them.

**Snapshot.** With the twist on, the snapshot appends each wheel's twist
and road-wheel angle and whether those angles are primed (after a reset
the wheels were never steered, so the first substep's angle is not
counted as a turn). Without it the layout is unchanged and the ABI stays
at 6, as with unsprung mass (ADR-0028).

**No preset turns it on yet.** The sandbox's Tuning panel has a "Parking
twist" switch that sets both on the steered tires: the patch radius from
the static wheel load at a typical 200 kPa, `a = √(Fz / (π·p))` (7.6 cm on
the hatchback's front), and 1000 N·m/rad per kN, which slides the patch
after about 3° of road-wheel turn. Both are rough starting points to
tune by feel, not measured values.

## Consequences

- With the switch on, the presets' parked hand-wheel torque at half lock
  rises from 0 to 1.8 N·m to 6 to 17 N·m (hatchback 1.3 → 10.3 N·m with its
  assist). That is more than a G PRO's 4.4 N·m, so parked the rim sits at
  the output limit.
- Released, a parked wheel no longer springs back to centre on its kingpin
  inclination: the slid patch holds it, as on a real car. Every preset's
  parked wheel still settles in the hands-off check.
- Lifting the wheel off the ground (no load) releases the patch at once.

## Tests

`crates/skidpad-core/tests/parking_twist_tests.rs`: the step on its own
(elastic, slide either way, elastic unloading, rolling unwind against the
closed form), a small parked turn against `−k·Fz·Δδ` within 2 %, a big
parked turn at `⅔·μ·Fz·a` within 0.1 %, held for 3 s without the car
moving, a sine-steer run at 15 m/s and the on-centre weave bit for bit
unchanged, snapshot restore mid-turn, a reset with the wheel turned, and
validation. `apps/sandbox/src/tuning.test.ts` covers the switch.
