---
"@skidpad/worker": minor
"@skidpad/core": patch
---

`WorkerWorld.lodTarget` is a synchronous `LodTarget`, so a `LodController` can drive a worker world: it keeps each vehicle's level locally, sends changes without waiting, and follows `restore`. `WorkerWorld.lod()` and `restore()` keep the local levels up to date. The `LodController` doc example now matches its signature (`pin()` the player's car, `update(distance)`), and the worker guide explains why Rapier- and Jolt-hosted cars cannot run in a `WorkerWorld`.
