---
"@skidpad/presets": minor
"@skidpad/input": patch
---

- presets: more column damping at speed, so a released wheel settles on a direct-drive base: `columnDampingAtSpeed` 0.3 on the sports car and crossover (from 0.2) and the open-wheeler (from 0.12), and the kart gets 0.6 by 10 m/s (it had none). Tuned in the hands-off harness with the rim inertia and delay measured on a G PRO.
- physics: no simulated behaviour changes; the weave test's driver torque includes the column damping, so its torque at 0 g rises by 0.01 to 0.02 N·m on those presets.
- input: `columnEffects` no longer clamps the damper's coefficient at `maxOutput` (its force is still capped there by the saturation), which had flattened any damping above `maxOutput / damperRate`.
