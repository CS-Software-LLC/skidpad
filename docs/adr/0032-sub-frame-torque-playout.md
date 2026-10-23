# ADR-0032: Sub-frame steering torque for force-feedback playout

- Status: Proposed
- Date: 2026-10-23
- Supersedes / superseded by: extends ADR-0031

## Context

ADR-0031 gives the host the mean steering torque of each host step. A sink
that sends one value per 60 Hz step still holds every change for up to
16.7 ms and cannot pass anything above 30 Hz: kerbs and the limit come
through as ticking instead of texture. iRacing computes force feedback at
360 Hz and, since its API only delivers 60 Hz, packs six samples into each
update and has the wheel play them out one frame late; direct-drive bases
smooth the same staircase with reconstruction filters.

## Decision

Eight telemetry channels, `SteeringTorqueSlice0` … `SteeringTorqueSlice7`:
the host step cut into eight equal slices of time, each the mean of its
substeps' `SteeringTorque` (substep `j` of `n` falls in slice `⌊8j/n⌋`).
With fewer than eight substeps an empty slice repeats the one before it.
Outside a step all eight are the current value. Accumulated in
`World::step` like the mean, so no state or hash changes.

On the host side, `ffbFrameFromTelemetry` passes the slices as
`FfbFrame.samples`. `TorquePlayout` replays a step's slices over the next
step with linear interpolation, starting from the previous step's last
slice, so the output is continuous at one step of delay.
`LogitechWebHidSink` takes `playoutRate` (Hz, default 0, off): the host
step only feeds the runaway guard (`FfbScaler.watch`) and queues the
slices, and a timer shapes (`FfbScaler.shape`) and sends the interpolated
torque, skipping a tick while the last report is in flight. The rate the
G PRO accepts is [VERIFY]; the sandbox offers 250, 360 and 500 Hz.

Eight slices at 60 Hz carry content up to 240 Hz, above what a rim and
hand reproduce, at 64 bytes per step.

## Alternatives considered

- A per-substep buffer across the WASM boundary. Exact, but a new ABI
  call and a variable length, and the worker and replay paths carry
  telemetry records already.
- More slices. Sixteen would carry 480 Hz content at 60 Hz; the browser's
  timers and the HID round trip are the limit first.
- Extrapolating ahead instead of playing one step behind. No added delay,
  but it overshoots at every reversal, which is felt as a knock.

## Consequences

- One host step (16.7 ms) more delay on the playout path. The hands-off
  harness (docs/validation/ffb-hands-off.md) shows no change in stability
  from it; what decides that is the damping.
- Playout and the per-step path share the scaler, so gain, clipping,
  smoothing and the slew limit apply per playout tick.
- `the_torque_slices_are_the_step_in_eight_parts` checks the slices bit
  for bit against single-substep steps for 20, 8, 5 and 1 substeps.
