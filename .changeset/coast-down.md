---
"@skidpad/core": minor
---

- core: a coast-down validation scenario (`runScenario({ scenario: "coastDown" })`): from 80 mph in neutral to 15 mph on flat ground, fitted as `F = A + B·v + C·v²` in SI and EPA units. The validation runner compares the presets' road load with EPA's 2025 coast-down targets for real cars of each class (`docs/validation/epa-coast-down.md`). No simulated behaviour changes.
