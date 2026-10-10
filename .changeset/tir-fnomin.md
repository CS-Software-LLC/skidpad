---
"@skidpad/core": patch
---

- physics: `.tir` import reads the nominal load from `FNOMIN`, the key PAC2002 and MF-Tyre files use in `[VERTICAL]`; `FZ0` is still accepted. Before, a real `.tir` kept the default 4000 N nominal load with only a warning, which shifts every load-dependent coefficient. Definitions that do not import a `.tir` are unaffected.
