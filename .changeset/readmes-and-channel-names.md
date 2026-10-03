---
"@skidpad/core": minor
"@skidpad/presets": patch
"@skidpad/input": patch
"@skidpad/replay": patch
"@skidpad/telemetry": patch
"@skidpad/rapier": patch
"@skidpad/jolt": patch
"@skidpad/worker": minor
---

Every package now ships a README (install, a minimal example, links to the guide), so the npm pages are no longer empty; the core's covers bundling a Node server.

Breaking (types only): `World.read` and `WorkerWorld.read` take a `ChannelName`, the union of every telemetry channel name, so a typo such as `"Speeed"` fails to compile instead of throwing at runtime; `readAll` returns `Record<ChannelName, number>`. `CHANNEL_NAMES` lists them at runtime. Per-wheel names compose from `WHEEL_ORDER` (`` `SlipRatio_${WHEEL_ORDER[i]}` ``); a name held in a plain `string` needs a `ChannelName` type, or use `sp.channel(name)` and `telemetryView` to probe.
