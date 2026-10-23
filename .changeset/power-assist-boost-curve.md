---
"@skidpad/core": minor
"@skidpad/presets": minor
---

- physics: power assist boost curve (ADR-0029). `steering.powerAssistOnset` (N·m of manual hand-wheel torque, default 0) makes the assist stay out of the way on centre and come in as the load builds: `SteeringTorque = (1 − a)·Tm + a·Tm / √(1 + (Tm/T₀)²)`. The torque always rises with load. Zero keeps the constant fraction bit for bit. Only `SteeringTorque` changes; the hand-wheel torque does not feed the physics.
- presets: the assisted presets (hatchback, sports, crossover, pickup) set `powerAssistOnset: 1`, which roughly doubles their on-centre steering torque at 0.04 g.
