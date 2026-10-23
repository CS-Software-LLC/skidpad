---
"@skidpad/core": minor
---

- physics: unsprung mass (ADR-0028). `axles[].suspension.unsprungMass` (kg per wheel, part of `chassis.mass`) gives each wheel of an independent axle its own vertical motion on the tire's vertical spring: the two-mass quarter car, with wheel hop and tire-load fluctuation over rough ground. Tires gain `verticalStiffness` and `verticalDamping`, and the `.tir` import reads `VERTICAL_STIFFNESS` and `VERTICAL_DAMPING`. Ride height and static loads are unchanged by the option, external hosts need no change, and the default of 0 runs bit for bit as before (presets, goldens and determinism hashes unchanged). Solid axles reject it for now.
- New telemetry channels `TireDeflection_FL` … `TireDeflection_RR`.
- Snapshots of a vehicle with unsprung mass carry 8 more values; the format version stays 6 and every existing snapshot still restores.
