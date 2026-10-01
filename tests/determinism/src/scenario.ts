import { smoothWave, type Skidpad } from "@skidpad/core";
import { presets } from "@skidpad/presets";
import { LAP_TRACES, replayLap, type LapReport } from "./lap.js";

/** Everything the determinism check compares across platforms. */
export interface DeterminismReport {
  platform: string;
  coreVersion: string;
  mathSelftestHash: string;
  /** Per-vehicle state hashes after the scripted drive. */
  vehicleHashes: string[];
  /** World hash after the scripted drive. */
  worldHash: string;
  /** Hash checkpoints every 300 steps. */
  checkpoints: string[];
  /**
   * Recorded laps of the sandbox track, one per preset, replayed open-loop
   * (milestone 3: a real drive, not just a scripted one).
   */
  laps: LapReport[];
}

export const SCENARIO_STEPS = 3000;

/**
 * Run the fixed scenario: three presets with scripted inputs for 3000 host
 * steps, then each preset's recorded lap of the sandbox track.
 */
export function runScenario(sp: Skidpad, platform: string): DeterminismReport {
  const w = sp.createWorld(3);
  const ids = [
    w.addVehicle(presets.hatchbackFwd),
    w.addVehicle(presets.sportsRwd),
    w.addVehicle(presets.kart),
  ];
  const checkpoints: string[] = [];
  for (let k = 0; k < SCENARIO_STEPS; k++) {
    const t = k / 60;
    ids.forEach((i, n) => {
      // Inputs use basic arithmetic only: Math.sin differs across engines.
      w.setInput(i, {
        steer: 0.6 * smoothWave(k, 720 - 120 * n, 37 * n),
        throttle: t < 30 ? 0.9 - 0.1 * n : 0.2,
        brake: t >= 30 && t < 36 ? 1 : 0,
        handbrake: t > 40 && t < 42 && n === 1 ? 1 : 0,
      });
    });
    w.step(1 / 60);
    if (k % 300 === 299) checkpoints.push(w.worldHash());
  }
  const report: DeterminismReport = {
    platform,
    coreVersion: sp.version,
    mathSelftestHash: sp.mathSelftestHash(),
    vehicleHashes: ids.map((i) => w.stateHash(i)),
    worldHash: w.worldHash(),
    checkpoints,
    laps: LAP_TRACES.map((trace) => replayLap(sp, trace)),
  };
  w.free();
  return report;
}
