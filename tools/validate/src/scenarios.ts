import { smoothWave, type ContactPatch, type VehicleDefinition } from "@contactpatch/core";
import { presetIds, preset, type PresetId } from "@contactpatch/presets";

export interface VehicleResults {
  understeer: ReturnType<ContactPatch["runScenario"]> & {
    gradientDegPerG: number;
    analyticGradientDegPerG: number;
    ackermannAngle: number;
    fittedIntercept: number;
  };
  straightLine: {
    accelTime: number | null;
    quarterMileTime: number | null;
    brakingDistance: number;
    meanDeceleration: number;
    wheelLocked: boolean;
  };
  /** State hash after a fixed scripted drive. Any physics change moves it. */
  scriptedDriveHash: string;
}

export interface ValidationReport {
  coreVersion: string;
  mathSelftestHash: string;
  vehicles: Record<string, VehicleResults>;
}

/** A deterministic scripted drive used both for regression and determinism. */
export function scriptedDriveHash(cp: ContactPatch, def: VehicleDefinition, steps = 1800): string {
  const w = cp.createWorld(1);
  const i = w.addVehicle(def);
  for (let k = 0; k < steps; k++) {
    const t = k / 60;
    // Basic arithmetic only (no Math.sin): the hash must match across engines.
    w.setInput(i, {
      steer: 0.5 * smoothWave(k, 540),
      throttle: t < 20 ? 0.8 : 0,
      brake: t >= 20 && t < 26 ? 0.9 : 0,
      handbrake: t >= 27 ? 1 : 0,
    });
    w.step(1 / 60);
  }
  const h = w.stateHash(i);
  w.free();
  return h;
}

export function runAll(cp: ContactPatch, ids: PresetId[] = presetIds): ValidationReport {
  const vehicles: Record<string, VehicleResults> = {};
  for (const id of ids) {
    const def = preset(id);
    const understeer = cp.runScenario({ scenario: "understeerGradient", definition: def });
    const sl = cp.runScenario({ scenario: "straightLine", definition: def });
    vehicles[id] = {
      understeer,
      straightLine: {
        accelTime: sl.accelTime,
        quarterMileTime: sl.quarterMileTime,
        brakingDistance: sl.brakingDistance,
        meanDeceleration: sl.meanDeceleration,
        wheelLocked: sl.wheelLocked,
      },
      scriptedDriveHash: scriptedDriveHash(cp, def),
    };
  }
  return { coreVersion: cp.version, mathSelftestHash: cp.mathSelftestHash(), vehicles };
}

export interface Tolerance {
  /** Relative tolerance for scalar results. */
  rel: number;
  /** Absolute floor for values near zero. */
  abs: number;
}

export interface Difference {
  path: string;
  golden: unknown;
  current: unknown;
}

/** Compare a report against a golden one. Hashes must match exactly. */
export function compare(
  golden: ValidationReport,
  current: ValidationReport,
  tol: Tolerance,
): Difference[] {
  const diffs: Difference[] = [];
  const walk = (path: string, g: unknown, c: unknown): void => {
    if (typeof g === "number" && typeof c === "number") {
      const d = Math.abs(g - c);
      if (d > tol.abs && d > tol.rel * Math.abs(g)) diffs.push({ path, golden: g, current: c });
      return;
    }
    if (typeof g === "string" || typeof g === "boolean" || g === null || c === null) {
      if (g !== c) diffs.push({ path, golden: g, current: c });
      return;
    }
    if (Array.isArray(g) && Array.isArray(c)) {
      if (g.length !== c.length) {
        diffs.push({ path: `${path}.length`, golden: g.length, current: c.length });
        return;
      }
      g.forEach((v, i) => walk(`${path}[${i}]`, v, c[i]));
      return;
    }
    if (typeof g === "object" && typeof c === "object" && g && c) {
      const keys = new Set([...Object.keys(g), ...Object.keys(c)]);
      for (const k of keys) {
        if (k === "coreVersion") continue;
        walk(
          path ? `${path}.${k}` : k,
          (g as Record<string, unknown>)[k],
          (c as Record<string, unknown>)[k],
        );
      }
      return;
    }
    if (g !== c) diffs.push({ path, golden: g, current: c });
  };
  walk("", golden, current);
  return diffs;
}

export const DEFAULT_TOLERANCE: Tolerance = { rel: 0.02, abs: 1e-4 };
