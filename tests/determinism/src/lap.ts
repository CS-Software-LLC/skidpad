/**
 * Recorded laps of the sandbox track (milestone 3: "cross-browser test on a
 * real drive"). `record-lap.ts` produced the traces once with a closed-loop
 * driver; the determinism scenario replays them open-loop, so every engine
 * sees exactly the same inputs: integers over `quantum`, which divides
 * identically everywhere.
 */
import type { Skidpad, VehicleDefinition, World } from "@skidpad/core";
import { preset, type PresetId } from "@skidpad/presets";
import type { LapTrace } from "./lap-format.js";
import hatchbackFwd from "../data/lap-hatchbackFwd.json";
import sportsRwd from "../data/lap-sportsRwd.json";
import kart from "../data/lap-kart.json";

export type { LapTrace } from "./lap-format.js";
export { LAP_RATE, LAP_QUANTUM } from "./lap-format.js";

export const LAP_TRACES: LapTrace[] = [hatchbackFwd, sportsRwd, kart];

export interface LapReport {
  preset: string;
  /** Host steps replayed. */
  steps: number;
  /** State hash every 600 steps (10 s) and at the end. */
  checkpoints: string[];
  /** Final planar position, so a desync is visible as a number too. */
  finalX: number;
  finalY: number;
}

/** Apply step `k` of a trace to a vehicle. */
export function applyLapInput(w: World, vehicle: number, trace: LapTrace, k: number): void {
  const q = trace.quantum;
  w.setInput(vehicle, {
    steer: trace.steer[k]! / q,
    throttle: trace.throttle[k]! / q,
    brake: trace.brake[k]! / q,
    handbrake: trace.handbrake[k]! / q,
  });
}

/** Replay one recorded lap on its own preset (or a given definition) and hash the state along the way. */
export function replayLap(sp: Skidpad, trace: LapTrace, def?: VehicleDefinition): LapReport {
  const w = sp.createWorld(1);
  const i = w.addVehicle(def ?? preset(trace.preset as PresetId));
  const checkpoints: string[] = [];
  const dt = 1 / trace.rate;
  for (let k = 0; k < trace.steps; k++) {
    applyLapInput(w, i, trace, k);
    w.step(dt);
    if (k % 600 === 599) checkpoints.push(w.stateHash(i));
  }
  checkpoints.push(w.stateHash(i));
  const report: LapReport = {
    preset: trace.preset,
    steps: trace.steps,
    checkpoints,
    finalX: w.read(i, "PosX"),
    finalY: w.read(i, "PosY"),
  };
  w.free();
  return report;
}
