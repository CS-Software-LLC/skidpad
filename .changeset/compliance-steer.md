---
"@skidpad/core": minor
---

- physics: compliance steer (ADR-0027). `steering.alignTorqueComplianceDeg` turns the steered wheels by degrees per kN·m of the axle's kingpin torque, as the steering system winds up with the hand wheel held; `axles[].lateralComplianceSteerDeg` turns each wheel by degrees per kN of its own lateral force, positive understeer on either axle. Both default to 0, act through the previous substep's forces, and are carried by the four-wheel and single-track models. `WheelSteer_*` includes the compliance angle; new channels `ComplianceSteer_FL` … `ComplianceSteer_RR` report it alone. Definitions without the fields run bit for bit as before (the presets' scripted drives match the previous core exactly); the golden state hashes change only because the state now holds the lagged kingpin torque.
- Breaking: the snapshot format is version 6 (the previous kingpin torque joins the state, and the single-track model's previous axle lateral forces), so snapshots and replay keyframes saved by earlier versions do not restore.
