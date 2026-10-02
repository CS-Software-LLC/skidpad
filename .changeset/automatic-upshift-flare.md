---
"@skidpad/core": patch
"@skidpad/validate": patch
---

physics: an automatic no longer flares the engine after an upshift. The throttle came straight back to full once the shift time ended, while the re-engaging clutch could barely carry any torque, so the engine revved back up toward the shift point before the clutch dragged it down to the new gear's speed (heard in the sandbox as a flat-foot shift). Until the engine has come down to the gearbox input speed, the engine now makes at most 70 % of what the clutch can carry. Accelerating from 0 to 100 km/h takes slightly longer on the combustion presets (sports 6.58 → 6.62 s, hatchback 9.52 → 9.82 s, pickup 7.26 → 7.44 s, open-wheeler 3.16 → 3.19 s), because the flywheel no longer dumps a rev flare into the wheels.
