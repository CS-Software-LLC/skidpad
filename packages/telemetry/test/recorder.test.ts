import { describe, expect, it } from "vitest";
import { TelemetryRecorder, parseCSV } from "../src/index.js";

const channels = [
  { name: "Time", unit: "s" },
  { name: "Speed", unit: "m/s" },
];

describe("TelemetryRecorder", () => {
  it("keeps the newest samples when full", () => {
    const r = new TelemetryRecorder({ channels, capacity: 3 });
    for (let i = 0; i < 5; i++) r.record([i, i * 10]);
    expect(r.length).toBe(3);
    expect(Array.from(r.series("Time"))).toEqual([2, 3, 4]);
    expect(r.latest()?.[1]).toBe(40);
    r.clear();
    expect(r.length).toBe(0);
    expect(r.latest()).toBeUndefined();
  });

  it("exports CSV and JSON that round-trip", () => {
    const r = new TelemetryRecorder({ channels, capacity: 10 });
    r.record([0, 0]);
    r.record([0.016667, 1.5]);
    const csv = r.toCSV();
    expect(csv.split("\n")[0]).toBe("Time [s],Speed [m/s]");
    const parsed = parseCSV(csv);
    expect(parsed.channels).toEqual(channels);
    expect(parsed.rows[1]?.[1]).toBeCloseTo(1.5);
    const json = r.toJSON();
    expect(json.samples).toBe(2);
    expect(json.data.Speed).toEqual([0, 1.5]);
  });

  it("rejects unknown channels", () => {
    const r = new TelemetryRecorder({ channels });
    expect(() => r.series("Nope")).toThrow(/unknown channel/);
  });
});
