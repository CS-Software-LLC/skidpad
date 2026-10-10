---
"@skidpad/core": patch
"@skidpad/validate": patch
---

physics: an automatic no longer lifts the throttle through a downshift. It lifted whenever the clutch was open for a shift, which brings the engine down for an upshift. On a downshift the engine fell away from the lower gear's speed, and the re-engaging clutch dragged it up with the driven wheels: a drive-torque reversal that spun the NHTSA Jeep Cherokee comparison car when it kicked down near the cornering limit. While the clutch is open the automatic now keeps the driver's throttle until the engine reaches the new gear's speed (ADR-0025, amendment). Full-throttle and constant-throttle runs are bit-identical. The hatchback and pickup understeer gradients move by less than 0.001 deg/g, and their timestep sweeps and scripted drive hashes change; the goldens are regenerated.
