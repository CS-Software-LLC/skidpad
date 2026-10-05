---
"@skidpad/core": minor
"@skidpad/presets": minor
---

Sound no longer has to be guessed (F-30):

- An optional `sound` block in the definition carries `firingsPerRev`, the combustion firings per crankshaft revolution, so an engine note's fundamental is `EngineRpm / 60 × firingsPerRev` Hz. 0 to 16; the default 0 means not given. The core validates it (same message from Rust and TypeScript), keeps it through `completeDefinition`, and never simulates it, so no result moves. The JSON schema lists it.
- Two telemetry channels for shift and rev-limiter events: `ShiftTimer`, the time left in the current shift (it jumps to `shiftTime + shiftHold` when a gear engages and counts down, with the torque cut while it is above `shiftHold`), so a shift is seen even when reading once per frame; and `RevLimiter`, how far into the rev limiter's cut the engine is, 0 at or below redline to 1 where the throttle is fully cut (always 0 without a combustion engine). Both follow a restore. The channels are appended, so existing indices do not move; the telemetry stride grows by two.
- Every preset sets `sound.firingsPerRev`: hatchback and open-wheeler 2, sports car 3, pickup 4, kart 1, electric crossover 0.
