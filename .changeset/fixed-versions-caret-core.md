---
"@skidpad/presets": patch
"@skidpad/rapier": patch
"@skidpad/jolt": patch
"@skidpad/replay": patch
"@skidpad/worker": patch
---

Every `@skidpad/*` package now releases at one shared version. The packages
that build on `@skidpad/core` depend on it with a caret range (`^0.5.0`)
instead of an exact version, so an app's own `@skidpad/core` is shared rather
than installed twice.
