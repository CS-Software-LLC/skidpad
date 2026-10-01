---
"@skidpad/core": minor
"@skidpad/validate": minor
---

Milestone 3: stability and determinism as tested features.

- New validation scenario `timestepSweep`: the skidpad, a locked-wheel stop from 100 km/h and a parked hold on a 30 % grade at every combination of substep rate (250, 500, 1000, 2000 Hz) and host rate (30, 60, 120, 240 Hz), against a reference cell at the definition's rate and a 100 Hz host. Reports the gradient and braking-distance spreads and a `stable` verdict; every preset is within 0.001 deg/g and 1 %.
- The `straightLine` scenario measures the locked-brake behaviour: `lockTime`, `lockTransitions` and `lockReleases` (lock chatter), `lockedDecelRipple` (relative RMS of the sliding deceleration about a 0.2 s moving average), and after the stop, with the brake held for `restTime` (new config, default 2 s), `restSpeed`, `restDistance` and `settledSpeed`. `maxAccelTime: 0` now skips the acceleration phase.
- The skidpad controller of the `understeerGradient` scenario normalises its gains by the kinematic yaw-rate gain `V / L`, so it is stable for every vehicle at every host rate (the single-track kart defeated it at a 30 Hz host step). Not a physics change: the golden gradients move by less than 0.001 deg/g and the scripted-drive hashes are unchanged.
- The validate tool reports the lock and sweep results per preset and its golden file carries them.
- Determinism harness: three recorded laps of the sandbox track (one per preset, driven once by a closed-loop driver and stored as integer input traces) are replayed in Chromium, Firefox, WebKit and Node alongside the scripted drive.
- Snapshot and hash coverage on the four-wheel model: restore-and-continue in built-in and external host mode, hash sensitivity to every state value, mixed-model worlds.
