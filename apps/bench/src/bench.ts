import type { Skidpad } from "@skidpad/core";
import { preset } from "@skidpad/presets";

export interface BenchCase {
  vehicles: number;
  /** Internal substep rate used for the case, Hz. */
  substepRateHz: number;
  label: string;
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
 * The published cases. LOD 1 and LOD 2 arrive in milestone 7; until then the
 * lower substep rates stand in for them so the dashboard has a time series
 * from day one.
 */
export const CASES: BenchCase[] = [
  { vehicles: 1, substepRateHz: 1000, label: "1 car, LOD 0 (1 kHz)" },
  { vehicles: 10, substepRateHz: 1000, label: "10 cars, LOD 0 (1 kHz)" },
  { vehicles: 20, substepRateHz: 1000, label: "20 cars, LOD 0 (1 kHz)" },
  { vehicles: 50, substepRateHz: 500, label: "50 cars, LOD 1 stand-in (500 Hz)" },
  { vehicles: 200, substepRateHz: 240, label: "200 cars, LOD 2 stand-in (240 Hz)" },
];

export function runCase(sp: Skidpad, c: BenchCase, now: () => number, steps = 600): BenchResult {
  const w = sp.createWorld(c.vehicles);
  const def = preset("hatchbackFwd");
  def.simulation.substepRateHz = c.substepRateHz;
  for (let i = 0; i < c.vehicles; i++) w.addVehicle(def);
  for (let i = 0; i < c.vehicles; i++) w.setInput(i, { throttle: 0.7, steer: 0.1 * Math.sin(i) });
  // Warm up.
  for (let k = 0; k < 60; k++) w.step(1 / 60);
  const t0 = now();
  for (let k = 0; k < steps; k++) {
    for (let i = 0; i < c.vehicles; i++) w.setInput(i, { steer: 0.3 * Math.sin(k / 50 + i) });
    w.step(1 / 60);
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
