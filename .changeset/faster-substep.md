---
"@skidpad/core": patch
---

- core: about 30 % less time per step in every benchmark case, with bit-identical results. A vehicle now works out its tires' load-independent constants (the curve shape factors, the stiffness shape at the nominal load, the peak-slip tangents) and its steering axis once per definition instead of on every substep, and shares one load-dependent stiffness between the tire evaluation, the low-speed damping and the wheel-spin integration. Determinism hashes and validation results are unchanged.
