---
"@skidpad/worker": patch
---

Fix `import "@skidpad/worker/entry"` doing nothing in production builds. The package declared `"sideEffects": false`, so bundlers dropped the side-effect-only import of the entry and the worker chunk came out empty, leaving `WorkerWorld.create` waiting forever. The entry is now listed as the package's one module with side effects, and a test bundles the documented usage with esbuild.
