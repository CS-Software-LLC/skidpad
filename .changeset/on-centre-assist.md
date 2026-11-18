---
"@skidpad/core": minor
"@skidpad/presets": minor
---

- core: `steering.powerAssistOnCentre` (0 … 1, default 0): the share of the power assist that already works on centre. With the boost curve the hand torque's slope on centre is `1 − powerAssist × powerAssistOnCentre` of the manual one instead of all of it; with `powerAssistFadeStart` set it comes in from rest to that speed, so a parked wheel is unchanged. ADR-0040.
- presets: the hatchback, sports car, crossover and pickup get an on-centre share (0.75 to 0.9) and more assist at speed (0.6 to 0.7), for 0.22 to 0.30 N·m per degree of hand wheel on centre at 100 km/h, from 0.4 to 0.7. This is what made a released direct-drive wheel swing at speed. Peak steering torque on a ramp steer at 80 km/h falls from 9 to 15 N·m to 6 to 9 N·m. The hatchback's `columnDampingAtSpeed` goes from 0.16 to 0.24.
- physics: no simulated behaviour changes; `SteeringTorque` and the weave scenario's torque metrics change on the four assisted presets (goldens updated).
