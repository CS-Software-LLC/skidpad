---
"@skidpad/core": minor
---

- core: an FMVSS 126 sine-with-dwell validation scenario (`runScenario({ scenario: "sineWithDwell" })`): the slowly increasing steer for `A`, then 0.7 Hz sines with a 500 ms dwell from 1.5A up to 6.5A or 270°, both ways, judged on the regulation's yaw-rate ratios and lateral displacement. The validation runner runs it on the road presets as shipped and with stability control on (`docs/validation/sine-with-dwell.md`). No simulated behaviour changes.
