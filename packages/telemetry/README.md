# @skidpad/telemetry

A ring-buffer telemetry recorder with CSV and JSON export for
[`@skidpad/core`](https://www.npmjs.com/package/@skidpad/core).

```ts
import { TelemetryRecorder } from "@skidpad/telemetry";

const recorder = new TelemetryRecorder({ channels: sp.telemetryLayout, capacity: 60 * 60 });
// after each step
recorder.record(world.telemetryView(car));
// later
const speed = recorder.series("Speed");
const csv = recorder.toCSV();
```

Guide: [getting started](https://cs-software-llc.github.io/skidpad/docs/guide/getting-started).

License: MIT OR Apache-2.0.
