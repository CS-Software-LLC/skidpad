---
"@skidpad/core": minor
"@skidpad/input": minor
---

- core: two telemetry channels for the parking twist (ADR-0039 amendment A): `SteerTwist`, its share of `SteeringTorque`, and `SteerTwistFriction`, the hand-wheel torque that slides the parked contact patches. Both are zero without the twist.
- input: `ffbFrameFromTelemetry` takes the parking twist out of the motor torque and sends it as wheel friction (`FfbFrame.twistFriction`), which the Logitech sink adds to the friction effect. As motor torque the twist was a stiff spring one host step late and set a parked wheel swinging.
