---
"@skidpad/core": minor
"@skidpad/worker": minor
---

Runtime divergence guard. After every step the core checks each car; a NaN or infinite state value, or a speed or spin rate no car reaches, resets the car to rest at its last healthy pose (keeping its clock) and zeroes its impulse to an external body for that step. `world.health(car)` reports the recoveries, the step of the last one, the cause and the first bad telemetry channel; `world.clearHealth(car)` forgets them; the new `Diverged` telemetry channel carries the count. Healthy cars and their hashes are unchanged. NaN inputs now read as zero and a NaN step length is ignored. The sandbox shows a notice naming the last tuning edit when it happens.
