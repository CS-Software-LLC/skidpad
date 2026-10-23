---
"@skidpad/core": patch
---

- physics: the Magic Formula reads `PKY4` from `.tir` files (MF 6.x), the curvature of the cornering stiffness against load. It defaults to 2, the fixed value of MF 5.2, so existing tires run bit for bit as before.
