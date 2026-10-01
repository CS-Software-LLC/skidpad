import type { Skidpad } from "@skidpad/core";
import { preset } from "@skidpad/presets";

export interface BenchCase {
  vehicles: number;
  /** Internal substep rate used for the case, Hz. */
  substepRateHz: number;
  /** Vehicle model for the case. */
  model: "fourWheel" | "singleTrack";
  label: string;
  /**
   * Drive every car with the core's path-following driver around a 300 m
   * loop instead of scripted inputs (milestone 7).
   */
  ai?: boolean;
  /**
   * Levels of detail (milestone 7, ADR-0019): how many of the cars run at
   * each level. The rest run at the full level. Single-track cars run at
   * `singleTrackRateHz`.
   */
  lod?: { singleTrack: number; frozen: number; singleTrackRateHz: number };
  /** Take all steps in one `stepMany` call (needs `ai`: no per-step inputs). */
  batched?: boolean;
}

export interface BenchResult extends BenchCase {
  /** Mean wall time of one 60 Hz host step for the whole world, ms. */
  msPerStep: number;
  /** Per-vehicle cost, µs per host step. */
  usPerVehicleStep: number;
  steps: number;
}

export interface BenchReport {
  platform: string;
  coreVersion: string;
  timestamp: string;
  results: BenchResult[];
}

/**
 * The published cases. LOD 0 is the four-wheel model at 1 kHz, the player
 * car. The single-track cases at lower substep rates were the stand-ins for
 * the lower levels of detail before milestone 7 and keep their labels so
 * the time series continues; the milestone 7 cases below them use real
 * levels of detail, the path-following driver and batched stepping.
 */
export const CASES: BenchCase[] = [
  { vehicles: 1, substepRateHz: 1000, model: "fourWheel", label: "1 car, LOD 0 (1 kHz)" },
  { vehicles: 10, substepRateHz: 1000, model: "fourWheel", label: "10 cars, LOD 0 (1 kHz)" },
  { vehicles: 20, substepRateHz: 1000, model: "fourWheel", label: "20 cars, LOD 0 (1 kHz)" },
  {
    vehicles: 50,
    substepRateHz: 500,
    model: "fourWheel",
    label: "50 cars, four-wheel at 500 Hz",
  },
  {
    vehicles: 50,
    substepRateHz: 500,
    model: "singleTrack",
    label: "50 cars, LOD 1 stand-in (single-track, 500 Hz)",
  },
  {
    vehicles: 200,
    substepRateHz: 240,
    model: "singleTrack",
    label: "200 cars, LOD 2 stand-in (single-track, 240 Hz)",
  },
  {
    vehicles: 20,
    substepRateHz: 1000,
    model: "fourWheel",
    ai: true,
    label: "20 cars, path-following driver (four-wheel, 1 kHz)",
  },
  {
    vehicles: 100,
    substepRateHz: 1000,
    model: "fourWheel",
    ai: true,
    lod: { singleTrack: 60, frozen: 30, singleTrackRateHz: 240 },
    label: "100 cars, driven: 10 full, 60 single-track at 240 Hz, 30 frozen",
  },
  {
    vehicles: 200,
    substepRateHz: 240,
    model: "singleTrack",
    ai: true,
    batched: true,
    label: "200 cars, driven single-track at 240 Hz, batched",
  },
];

/** A 300 m loop for the driven cases: two 80 m straights joined by 22 m half circles. */
function loop(): [number, number][] {
  const pts: [number, number][] = [];
  const r = 22;
  for (let k = 0; k < 16; k++) pts.push([-40 + (80 * k) / 16, -r]);
  for (let k = 0; k < 16; k++) {
    const a = -Math.PI / 2 + (Math.PI * k) / 16;
    pts.push([40 + r * Math.cos(a), r * Math.sin(a)]);
  }
  for (let k = 0; k < 16; k++) pts.push([40 - (80 * k) / 16, r]);
  for (let k = 0; k < 16; k++) {
    const a = Math.PI / 2 + (Math.PI * k) / 16;
    pts.push([-40 + r * Math.cos(a), r * Math.sin(a)]);
  }
  return pts;
}

export function runCase(sp: Skidpad, c: BenchCase, now: () => number, steps = 600): BenchResult {
  const w = sp.createWorld(c.vehicles);
  const def = preset("hatchbackFwd");
  def.simulation.substepRateHz = c.substepRateHz;
  def.simulation.model = c.model;
  for (let i = 0; i < c.vehicles; i++) w.addVehicle(def);
  if (c.ai) {
    const path = loop();
    for (let i = 0; i < c.vehicles; i++) {
      const p = path[(i * 7) % path.length]!;
      const q = path[((i * 7) % path.length) + 1] ?? path[0]!;
      w.resetVehicle(i, p[0], p[1], Math.atan2(q[1] - p[1], q[0] - p[0]));
      w.setAi(i, path, { maxSpeed: 14 + (i % 4), lateralOffset: (i % 3) - 1 });
    }
  } else {
    for (let i = 0; i < c.vehicles; i++) w.setInput(i, { throttle: 0.7, steer: 0.1 * Math.sin(i) });
  }
  if (c.lod) {
    const full = c.vehicles - c.lod.singleTrack - c.lod.frozen;
    for (let i = full; i < full + c.lod.singleTrack; i++)
      w.setLod(i, "singleTrack", c.lod.singleTrackRateHz);
    for (let i = full + c.lod.singleTrack; i < c.vehicles; i++) w.setLod(i, "frozen");
  }
  // Warm up.
  w.stepMany(1 / 60, 60);
  const t0 = now();
  if (c.batched) {
    w.stepMany(1 / 60, steps);
  } else {
    for (let k = 0; k < steps; k++) {
      if (!c.ai) {
        for (let i = 0; i < c.vehicles; i++) w.setInput(i, { steer: 0.3 * Math.sin(k / 50 + i) });
      }
      w.step(1 / 60);
    }
  }
  const ms = (now() - t0) / steps;
  w.free();
  return { ...c, msPerStep: ms, usPerVehicleStep: (ms * 1000) / c.vehicles, steps };
}

export function runAll(sp: Skidpad, platform: string, now: () => number): BenchReport {
  return {
    platform,
    coreVersion: sp.version,
    timestamp: new Date().toISOString(),
    results: CASES.map((c) => runCase(sp, c, now)),
  };
}

export function formatTable(r: BenchReport): string {
  const lines = [
    `Skidpad benchmark — ${r.platform} — core ${r.coreVersion}`,
    "",
    "| Case | ms per 60 Hz step | µs per vehicle-step |",
    "| --- | --- | --- |",
  ];
  for (const x of r.results)
    lines.push(`| ${x.label} | ${x.msPerStep.toFixed(3)} | ${x.usPerVehicleStep.toFixed(1)} |`);
  return lines.join("\n");
}
