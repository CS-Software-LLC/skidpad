---
"@skidpad/core": minor
---

- physics: the Magic Formula tire uses the MF 6.x camber equations when the `.tir` file's `FITTYP` is 61 or 62 (or, with no `FITTYP`, its `PROPERTY_FILE_FORMAT` is `MF61`/`MF62`). Camber thrust comes from the camber stiffness `PKY6`, `PKY7` (scaled by `LKYC`) as in MF 6.x, `γ* = sin γ` replaces `λγ γ`, and the import now reads `PKY5`–`PKY7`, `PEY5`, `RBX3`, `RBY4`, `QBZ6`, `QDZ10`, `QDZ11`, `LKYC` and `LKZC`. In the aligning moment the trail acts on the side force at zero camber, and camber reaches `Mz` through the residual moment. A 6.x file previously ran with MF 5.2's camber and ignored `PKY6`/`PKY7`, so its camber thrust was not the one the file intends. MF 5.2 files (`PAC2002`, or no `FITTYP`) run bit for bit as before; the import warns about keys that belong to the other version. New parameter `fittyp` (default 52). See `docs/validation/magic-formula.md`.
