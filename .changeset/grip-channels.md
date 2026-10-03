---
"@skidpad/core": minor
---

New per-wheel telemetry channels: `TireFmax_FL` … `TireFmax_RR`, each tire's friction limit at its load and surface (the axle channels `TireFmax_F`/`_R` are their sums), and `PeakSlip_FL` … `PeakSlip_RR`, the combined slip relative to the slip of the tire's peak force: below 1 the tire grips, above 1 it slides. For tire sound and grip meters without reading tire parameters. The channels are appended, so existing channel indices do not move; the telemetry stride grows by eight.
