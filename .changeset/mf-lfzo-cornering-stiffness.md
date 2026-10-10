---
"@skidpad/core": patch
---

- physics: the Magic Formula cornering stiffness applies the nominal-load scale `LFZO` once, as Pacejka's eq. 4.E25 does (`F'z0 = λFz0·Fz0`), instead of twice. A `.tir` with `LFZO` other than 1 gave a cornering stiffness `LFZO` times too small: 19 % too small for Project Chrono's Sedan tire (`LFZO = 0.81`), which found it. No preset sets `LFZO`, so no validation result moves.
