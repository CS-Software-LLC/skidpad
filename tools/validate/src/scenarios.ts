import {
  smoothWave,
  type ParkedConfig,
  type ParkedResult,
  type Skidpad,
  type SweepCell,
  type VehicleDefinition,
} from "@skidpad/core";
import { presetIds, preset, type PresetId } from "@skidpad/presets";

/** One standstill case of the parked scenario (ADR-0005, ADR-0010). */
export interface ParkedCase {
  /** Mean creep speed over the 10 s hold, m/s. */
  creepSpeed: number;
  /** Velocity RMS over the last 5 s of the hold, m/s. */
  velocityRms: number;
  /** Settled, no drift, no oscillation. */
  holds: boolean;
}

/**
 * The standstill cases every preset runs. `null` marks a case the vehicle
 * cannot hold physically (no handbrake), which is skipped rather than
 * failed.
 */
export interface ParkedResults {
  flatRest: ParkedCase;
  grade10Brake: ParkedCase;
  grade20Brake: ParkedCase;
  grade30Brake: ParkedCase;
  grade10Handbrake: ParkedCase | null;
  grade20Handbrake: ParkedCase | null;
  cross20Brakes: ParkedCase;
}

export const PARKED_CASES: Record<keyof ParkedResults, ParkedConfig> = {
  flatRest: {},
  grade10Brake: { grade: 0.1, brake: 1 },
  grade20Brake: { grade: 0.2, brake: 1 },
  grade30Brake: { grade: 0.3, brake: 1 },
  grade10Handbrake: { grade: 0.1, handbrake: 1 },
  grade20Handbrake: { grade: 0.2, handbrake: 1 },
  cross20Brakes: { crossSlope: 0.2, brake: 1, handbrake: 1 },
};

function parkedCase(r: ParkedResult): ParkedCase {
  return { creepSpeed: r.creepSpeed, velocityRms: r.velocityRms, holds: r.holds };
}

export function runParked(sp: Skidpad, def: VehicleDefinition): ParkedResults {
  const run = (config: ParkedConfig): ParkedCase =>
    parkedCase(sp.runScenario({ scenario: "parkedOnSlope", definition: def, config }));
  const handbrake = (def.brakes?.handbrakeTorque ?? 0) > 0;
  return {
    flatRest: run(PARKED_CASES.flatRest),
    grade10Brake: run(PARKED_CASES.grade10Brake),
    grade20Brake: run(PARKED_CASES.grade20Brake),
    grade30Brake: run(PARKED_CASES.grade30Brake),
    grade10Handbrake: handbrake ? run(PARKED_CASES.grade10Handbrake) : null,
    grade20Handbrake: handbrake ? run(PARKED_CASES.grade20Handbrake) : null,
    cross20Brakes: run(PARKED_CASES.cross20Brakes),
  };
}

export interface VehicleResults {
  /** Which model produced `understeer` and `straightLine`. */
  model: string;
  understeer: ReturnType<Skidpad["runScenario"]> & {
    gradientDegPerG: number;
    analyticGradientDegPerG: number;
    ackermannAngle: number;
    fittedIntercept: number;
  };
  /**
   * The same manoeuvre on the single-track model, as a cross-check: it has
   * no lateral load transfer, so it should sit closest to linear theory,
   * and the four-wheel result should differ from it only by the load
   * sensitivity under lateral transfer.
   */
  understeerSingleTrack: {
    gradientDegPerG: number;
  };
  straightLine: {
    accelTime: number | null;
    quarterMileTime: number | null;
    brakingDistance: number;
    meanDeceleration: number;
    wheelLocked: boolean;
    /** Locked-brake behaviour (milestone 3): when the wheels lock they lock once … */
    lockTime: number | null;
    /** … and never release while moving (chatter), … */
    lockReleases: number;
    /** … the deceleration on sliding friction is smooth, … */
    lockedDecelRipple: number;
    /** … and the car springs back a few centimetres and comes to rest on the brake. */
    restSpeed: number;
    settledSpeed: number;
    /** The same stop with the anti-lock assist enabled (ADR-0013), m. */
    brakingDistanceAbs: number;
  };
  /** Standstill: at rest on flat ground and parked on slopes. */
  parked: ParkedResults;
  /**
   * Timestep sweep: the skidpad, a locked-wheel stop and a parked hold at
   * 250 to 2000 Hz internally and 30 to 240 Hz host steps, against the
   * reference cell the other scenarios run at.
   */
  timestepSweep: TimestepSweepSummary;
  /** State hash after a fixed scripted drive. Any physics change moves it. */
  scriptedDriveHash: string;
}

export interface TimestepSweepSummary {
  /** Largest |cell − reference| of the understeer gradient, deg/g. */
  gradientSpreadDegPerG: number;
  /** Largest relative |cell − reference| of the braking distance. */
  brakingDistanceSpread: number;
  allFinite: boolean;
  allHold: boolean;
  cleanStops: boolean;
  stable: boolean;
  /** The cells, `"substep/host"` keyed, with their two headline numbers. */
  cells: Record<string, { gradientDegPerG: number; brakingDistance: number }>;
}

export function runTimestepSweep(sp: Skidpad, def: VehicleDefinition): TimestepSweepSummary {
  const r = sp.runScenario({ scenario: "timestepSweep", definition: def });
  const cells: TimestepSweepSummary["cells"] = {};
  for (const c of r.cells as SweepCell[]) {
    cells[`${c.substepRateHz}/${c.hostRateHz}`] = {
      gradientDegPerG: c.gradientDegPerG,
      brakingDistance: c.brakingDistance,
    };
  }
  return {
    gradientSpreadDegPerG: r.gradientSpreadDegPerG,
    brakingDistanceSpread: r.brakingDistanceSpread,
    allFinite: r.allFinite,
    allHold: r.allHold,
    cleanStops: r.cleanStops,
    stable: r.stable,
    cells,
  };
}

export interface ValidationReport {
  coreVersion: string;
  mathSelftestHash: string;
  vehicles: Record<string, VehicleResults>;
}

/** A deterministic scripted drive used both for regression and determinism. */
export function scriptedDriveHash(sp: Skidpad, def: VehicleDefinition, steps = 1800): string {
  const w = sp.createWorld(1);
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

export function runAll(sp: Skidpad, ids: PresetId[] = presetIds): ValidationReport {
  const vehicles: Record<string, VehicleResults> = {};
  for (const id of ids) {
    const def = preset(id);
    const understeer = sp.runScenario({ scenario: "understeerGradient", definition: def });
    const sl = sp.runScenario({ scenario: "straightLine", definition: def });
    // The same stop with the anti-lock assist on (presets leave `assists`
    // at the core defaults, so the block may be absent).
    const withAbs = structuredClone(def) as VehicleDefinition & {
      assists?: Partial<VehicleDefinition["assists"]>;
    };
    withAbs.assists = {
      ...(withAbs.assists ?? {}),
      abs: { ...(withAbs.assists?.abs ?? {}), enabled: true },
    } as VehicleDefinition["assists"];
    const slAbs = sp.runScenario({
      scenario: "straightLine",
      definition: withAbs,
      config: { maxAccelTime: 0 },
    });
    const single = structuredClone(def);
    single.simulation.model = "singleTrack";
    const understeerSingle = sp.runScenario({
      scenario: "understeerGradient",
      definition: single,
    });
    vehicles[id] = {
      model: def.simulation.model,
      understeer,
      understeerSingleTrack: { gradientDegPerG: understeerSingle.gradientDegPerG },
      straightLine: {
        accelTime: sl.accelTime,
        quarterMileTime: sl.quarterMileTime,
        brakingDistance: sl.brakingDistance,
        meanDeceleration: sl.meanDeceleration,
        wheelLocked: sl.wheelLocked,
        lockTime: sl.lockTime,
        lockReleases: sl.lockReleases,
        lockedDecelRipple: sl.lockedDecelRipple,
        restSpeed: sl.restSpeed,
        settledSpeed: sl.settledSpeed,
        brakingDistanceAbs: slAbs.brakingDistance,
      },
      parked: runParked(sp, def),
      timestepSweep: runTimestepSweep(sp, def),
      scriptedDriveHash: scriptedDriveHash(sp, def),
    };
  }
  return { coreVersion: sp.version, mathSelftestHash: sp.mathSelftestHash(), vehicles };
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
