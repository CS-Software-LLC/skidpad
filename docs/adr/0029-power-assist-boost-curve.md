# ADR-0029: Power assist boost curve

- Status: Proposed
- Date: 2026-10-23
- Supersedes / superseded by: refines the constant assist of ADR-0012

## Context

ADR-0012 reduces the hand-wheel torque by a constant fraction,
`SteeringTorque = −(1 − powerAssist) · Σ T_kp / ratio`, and names a boost
curve over torque as the later refinement. The presets use fractions of 0.4
to 0.7, so up to 70 % of the torque is gone at every load, including the
small aligning torque near centre that tells the driver where straight
ahead is. On a force-feedback wheel that reads as a vague, floaty centre.

A real assist does not work that way. A hydraulic rotary valve is held
closed by a torsion bar and only opens once the driver twists the bar, and
an electric assist's boost map gives little or no help at small driver
torque and more as the torque grows. Either way the driver feels close to
the manual torque on centre and a reduced, slowly rising torque under load
(Gillespie, _Fundamentals of Vehicle Dynamics_, ch. 8, power steering
[VERIFY chapter]).

## Decision

`steering.powerAssistOnset` (N·m of manual hand-wheel torque, default 0)
shapes the assist. With manual torque `Tm = −Σ T_kp / ratio` and
`a = powerAssist`,

```text
SteeringTorque = (1 − a)·Tm + a·Tm / √(1 + (Tm / powerAssistOnset)²)
```

The shape is chosen for its properties, not taken from a published valve
curve [DERIVED]:

- slope 1 at `Tm = 0`: no assist on centre;
- slope tending to `1 − a` at large torque, so `powerAssist` keeps its
  meaning as the share the assist takes away under load, plus a constant
  `a × powerAssistOnset` the valve needs to stay open;
- slope `(1 − a) + a·(1 + x²)^(−3/2) > 0` everywhere, so the hand torque
  always rises with the load and a force-feedback wheel never goes lighter
  as it turns in (a curve whose slope went negative would also make the
  driver-and-wheel loop unstable);
- odd in `Tm`, and only `sqrt`, which is correctly rounded and therefore
  deterministic across platforms.

Zero onset gives the constant fraction through the old expression, bit for
bit. The passenger presets set an onset of 1 N·m; the kart and the
open-wheeler have no assist and are unchanged.

## Consequences

- `SteeringTorque` on the assisted presets is heavier near centre and
  slightly heavier under load (by at most `a × powerAssistOnset`). No other
  channel changes: the hand-wheel torque feeds only telemetry and the
  force-feedback device, not the physics.
- Speed-dependent assist (lighter at parking speeds) is not modelled. It
  would scale `a` with speed and can come later.
