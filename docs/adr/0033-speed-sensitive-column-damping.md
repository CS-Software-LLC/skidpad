# ADR-0033: Speed-sensitive column damping

- Status: Proposed
- Date: 2026-10-23
- Supersedes / superseded by: extends the column damping of ADR-0012

## Context

The hands-off harness (docs/validation/ffb-hands-off.md) shows a released
wheel swinging wider each cycle at speed on most presets. That stays true
with a 1 kHz loop and no filtering, so it is a free-control mode of the
car and rim with too little steering damping, made worse by the 60 Hz loop
and the slew limit's delay. More constant damping settles it, but makes
parking and slow turns heavy. Electric power steering adds active damping
that rises with speed for the same reason: return without overshoot on the
motorway, light in a car park.

## Decision

Two steering fields, both default 0:

- `columnDampingAtSpeed`: the column damping, N·m per rad/s, reached at
  `columnDampingSpeed` and held above it;
- `columnDampingSpeed`: that speed, m/s, 0 … 100. Zero keeps the damping
  constant at `columnDamping`, bit for bit as before.

Between rest and that speed the damping is linear in speed. The core
evaluates it (`VehicleDefinition::column_damping_at`) and reports it as the
`ColumnDamping` channel. `ffbFrameFromTelemetry` sends it to the device,
falling back to `columnDamping` when the channel is missing. The core does
not simulate the column, so the state and hashes are unchanged.

`LogitechWebHidSink` re-sends the damper only when its coefficient moves
by more than about 5 %, so a speed-varying value does not cost a report
every frame.

The hatchback, sports car, crossover, pickup and open-wheeler presets go
to four times their parking damping by 20 m/s [ILLUSTRATIVE], picked with
the harness. The kart is unchanged.

**Amendment A (2026-11-18): retuned to a measured G PRO.** `measureLoop()`
on a G PRO found a rim of about 0.016 kg·m² (the harness had assumed 0.03)
and 15 ms from asking for a torque to the page seeing its effect, and on
the wheel the sports car let go at 100 km/h swung back and forth without
stopping. The harness reproduces it with those numbers and the base's
0.13 N·m of friction (`G_PRO_LOOP`): at the sandbox's defaults the sports
car, crossover and open-wheeler kept swinging 23° to 115° between 60 and
140 km/h. The damping at speed is now 0.3 N·m per rad/s on the sports car
and crossover (from 0.2) and on the open-wheeler (from 0.12), and the kart
gets 0.6 by 10 m/s (it had none). The hatchback and pickup settled as they
were. With these every preset's rim is within 2° of rest a few seconds
after it is let go, and the test suite asserts it.

The sink also stopped clamping the damper's coefficient at `maxOutput`:
it is a slope, and the clamp flattened any damping above 0.52 N·m·s/rad at
the rim (a G PRO at 40 %) although the saturation already caps its force.

## Alternatives considered

- Raise `columnDamping` fourfold. It settles the cars at speed, but
  parking and slow turns get heavy and sluggish.
- Damping from the yaw rate or the hand-wheel rate (an EPS controller).
  Closer to real EPS logic, but more parameters before the damper's units
  on the device are even known.
- Fix it in the scaler (lower gain at speed, BeamNG's low-speed
  reduction in reverse). It hides torque the model computes.

## Consequences

- With today's slow slew limit the speed damping is not enough on its own.
  The harness test pairs it with `DIRECT_DRIVE_SCALER`, and both need
  trying on the G PRO before either becomes a default there.
- The rim inertia and the damper's units are [VERIFY], so the preset values
  are a starting point, not a tune.
- `column_damping_rises_with_speed_when_asked` checks the curve and the
  channel on both models. The harness checks that three road cars settle
  at 100 km/h with it and grow without it.
