import type { DifferentialDefinition, PartialVehicleDefinition, TireDefinition } from "./types.js";
import { CURRENT_FORMAT_VERSION } from "./types.js";

export interface ValidationResult {
  ok: boolean;
  /** Human-readable problems, e.g. "rear spring rate is zero". Empty when ok. */
  errors: string[];
  /** Non-fatal observations. */
  warnings: string[];
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function positive(errors: string[], path: string, v: unknown, required = false): void {
  if (v === undefined) {
    if (required) errors.push(`${path} is required`);
    return;
  }
  if (!isNum(v) || v <= 0) errors.push(`${path} must be a positive number (got ${String(v)})`);
}

function nonNegative(errors: string[], path: string, v: unknown): void {
  if (v === undefined) return;
  if (!isNum(v) || v < 0) errors.push(`${path} must be zero or positive (got ${String(v)})`);
}

function validateTire(errors: string[], warnings: string[], path: string, tire: unknown): void {
  if (tire === undefined) return;
  if (typeof tire !== "object" || tire === null) {
    errors.push(`${path} must be an object with a "model" field`);
    return;
  }
  const t = tire as Partial<TireDefinition> & Record<string, unknown>;
  if (t.model === undefined) {
    errors.push(`${path}.model is required ("feel" or "magicFormula")`);
    return;
  }
  if (t.model === "feel") {
    for (const k of [
      "radius",
      "nominalLoad",
      "peakFriction",
      "peakSlipRatio",
      "peakSlipAngleDeg",
      "longitudinalStiffness",
      "corneringStiffness",
      "stiffnessPeakLoad",
      "relaxationLengthLong",
      "relaxationLengthLat",
      "lowSpeedFloor",
      "lowSpeedDampingFade",
    ]) {
      positive(errors, `${path}.${k}`, t[k]);
    }
    nonNegative(errors, `${path}.lowSpeedDamping`, t.lowSpeedDamping);
    for (const k of ["falloffLong", "falloffLat"]) {
      const v = t[k];
      if (v !== undefined && (!isNum(v) || v <= 0 || v > 1)) {
        errors.push(`${path}.${k} must be in (0, 1] (got ${String(v)})`);
      }
    }
    if (isNum(t.peakSlipRatio) && t.peakSlipRatio >= 1) {
      errors.push(
        `${path}.peakSlipRatio must be below 1 (got ${t.peakSlipRatio}); the braking peak of the theoretical slip is κp / (1 − κp)`,
      );
    }
    if (isNum(t.peakSlipAngleDeg) && t.peakSlipAngleDeg > 45) {
      errors.push(`${path}.peakSlipAngleDeg must be at most 45 (got ${t.peakSlipAngleDeg})`);
    }
    const ls = t.loadSensitivity;
    if (ls !== undefined && (!isNum(ls) || ls < 0 || ls >= 1)) {
      errors.push(`${path}.loadSensitivity must be in [0, 1) (got ${String(ls)})`);
    }
    for (const k of ["camberStiffness", "pneumaticTrail", "rollingResistance"]) {
      nonNegative(errors, `${path}.${k}`, t[k]);
    }
    const tzc = t.trailZeroCrossing;
    if (tzc !== undefined && (!isNum(tzc) || tzc <= 0 || tzc > 5)) {
      errors.push(
        `${path}.trailZeroCrossing must be in (0, 5] multiples of the peak slip angle (got ${String(tzc)})`,
      );
    }
    const tr = t.trailReversal;
    if (tr !== undefined && (!isNum(tr) || tr < 0 || tr > 0.5)) {
      errors.push(
        `${path}.trailReversal must be in [0, 0.5] of the trail at zero slip (got ${String(tr)})`,
      );
    }
    const arm = t.fxMomentArm;
    if (arm !== undefined && (!isNum(arm) || Math.abs(arm) > 1)) {
      errors.push(`${path}.fxMomentArm must be within ±1 m (got ${String(arm)})`);
    }
    if (isNum(t.peakFriction) && t.peakFriction > 2.5) {
      warnings.push(
        `${path}.peakFriction of ${t.peakFriction} is beyond any road tire; fine for arcade use`,
      );
    }
  } else if (t.model === "magicFormula") {
    for (const k of [
      "unloadedRadius",
      "fz0",
      "relaxationLengthLong",
      "relaxationLengthLat",
      "lowSpeedFloor",
      "lowSpeedDampingFade",
    ]) {
      positive(errors, `${path}.${k}`, t[k]);
    }
    nonNegative(errors, `${path}.lowSpeedDamping`, t.lowSpeedDamping);
    const pky1 = t.pky1;
    if (isNum(pky1) && pky1 > 0) {
      errors.push(
        `${path}.pky1 is positive; Skidpad uses the ISO sign convention in which PKY1 is negative (ADR-0007)`,
      );
    }
    for (const [k, v] of Object.entries(t)) {
      if (k === "model") continue;
      if (v !== undefined && !isNum(v))
        errors.push(`${path}.${k} must be a finite number (got ${String(v)})`);
    }
  } else {
    errors.push(`${path}.model must be "feel" or "magicFormula" (got "${String(t.model)}")`);
  }
}

/**
 * Validate a (possibly partial) definition and explain problems in plain
 * language. Partial definitions are fine: missing fields take defaults in
 * the core. This mirrors the checks in `skidpad-core` so problems surface before
 * the WASM boundary.
 */
function validateDrivetrain(
  errors: string[],
  warnings: string[],
  dt: PartialVehicleDefinition["drivetrain"],
): void {
  if (dt === undefined) return;
  if (typeof dt !== "object" || dt === null) {
    errors.push("drivetrain must be an object");
    return;
  }
  const pu = dt.powerUnit as Record<string, unknown> | undefined;
  if (pu !== undefined) {
    if (typeof pu !== "object" || pu === null || typeof pu.kind !== "string") {
      errors.push('drivetrain.powerUnit.kind is required ("direct", "combustion" or "electric")');
    } else if (pu.kind === "direct") {
      nonNegative(errors, "drivetrain.powerUnit.maxWheelTorque", pu.maxWheelTorque);
      positive(errors, "drivetrain.powerUnit.maxWheelSpeed", pu.maxWheelSpeed);
    } else if (pu.kind === "combustion") {
      positive(errors, "drivetrain.powerUnit.idleRpm", pu.idleRpm);
      positive(errors, "drivetrain.powerUnit.redlineRpm", pu.redlineRpm);
      positive(errors, "drivetrain.powerUnit.inertia", pu.inertia);
      if (isNum(pu.idleRpm) && isNum(pu.redlineRpm) && pu.redlineRpm <= pu.idleRpm) {
        errors.push("drivetrain.powerUnit.redlineRpm must exceed idleRpm");
      }
      for (const k of ["engineBrakingIdle", "engineBrakingRedline", "idleTorqueMax"]) {
        nonNegative(errors, `drivetrain.powerUnit.${k}`, pu[k]);
      }
      const curve = pu.torqueCurve;
      if (curve !== undefined) {
        if (!Array.isArray(curve) || curve.length === 0 || curve.length > 32) {
          errors.push("drivetrain.powerUnit.torqueCurve needs 1 to 32 [rpm, N·m] points");
        } else {
          let prev = -Infinity;
          curve.forEach((p, i) => {
            if (!Array.isArray(p) || p.length !== 2 || !isNum(p[0]) || !isNum(p[1]) || p[0] < 0) {
              errors.push(`drivetrain.powerUnit.torqueCurve[${i}] must be [rpm ≥ 0, N·m]`);
            } else {
              if (p[0] <= prev) {
                errors.push(
                  `drivetrain.powerUnit.torqueCurve[${i}] rpm must increase along the curve`,
                );
              }
              prev = p[0];
            }
          });
        }
      }
    } else if (pu.kind === "electric") {
      for (const k of ["maxTorque", "maxPower", "maxRpm", "inertia"]) {
        positive(errors, `drivetrain.powerUnit.${k}`, pu[k]);
      }
      nonNegative(errors, "drivetrain.powerUnit.regenTorque", pu.regenTorque);
    } else {
      errors.push(
        `drivetrain.powerUnit.kind must be "direct", "combustion" or "electric" (got "${String(pu.kind)}")`,
      );
    }
  }
  const t = dt.transmission;
  if (t !== undefined) {
    if (t.gears !== undefined) {
      if (!Array.isArray(t.gears) || t.gears.length === 0 || t.gears.length > 10) {
        errors.push("drivetrain.transmission.gears needs 1 to 10 ratios");
      } else {
        t.gears.forEach((g, i) => positive(errors, `drivetrain.transmission.gears[${i}]`, g));
      }
    }
    nonNegative(errors, "drivetrain.transmission.reverse", t.reverse);
    positive(errors, "drivetrain.transmission.finalDrive", t.finalDrive);
    positive(errors, "drivetrain.transmission.clutchMaxTorque", t.clutchMaxTorque);
    for (const k of [
      "shiftTime",
      "shiftHold",
      "clutchEngageTime",
      "clutchBiteRpm",
      "inputInertia",
      "outputInertia",
    ] as const) {
      nonNegative(errors, `drivetrain.transmission.${k}`, t[k]);
    }
    if (t.mode !== undefined && t.mode !== "automatic" && t.mode !== "manual") {
      errors.push(
        `drivetrain.transmission.mode must be "automatic" or "manual" (got "${String(t.mode)}")`,
      );
    }
    if (
      t.shiftUpAt !== undefined &&
      (!isNum(t.shiftUpAt) || t.shiftUpAt <= 0 || t.shiftUpAt > 1.05)
    ) {
      errors.push(
        `drivetrain.transmission.shiftUpAt must be in (0, 1.05] (got ${String(t.shiftUpAt)})`,
      );
    }
    if (isNum(t.shiftDownAt) && isNum(t.shiftUpAt) && t.shiftDownAt >= t.shiftUpAt) {
      errors.push("drivetrain.transmission.shiftDownAt must be below shiftUpAt");
    }
    nonNegative(errors, "drivetrain.transmission.shiftDownAt", t.shiftDownAt);
    if (isNum(t.shiftTime) && t.shiftTime > 2) {
      warnings.push(
        `drivetrain.transmission.shiftTime of ${t.shiftTime} s is long; 0.1 to 0.5 s is typical`,
      );
    }
  }
  const diffs: Array<[string, Partial<DifferentialDefinition> | undefined]> = [
    ["front", dt.front],
    ["rear", dt.rear],
    ["center", dt.center],
  ];
  for (const [name, diff] of diffs) {
    if (diff === undefined) continue;
    if (
      diff.kind !== undefined &&
      diff.kind !== "open" &&
      diff.kind !== "locked" &&
      diff.kind !== "lsd"
    ) {
      errors.push(
        `drivetrain.${name}.kind must be "open", "locked" or "lsd" (got "${String(diff.kind)}")`,
      );
    }
    nonNegative(errors, `drivetrain.${name}.preload`, diff.preload);
    for (const k of ["biasDrive", "biasCoast"] as const) {
      const v = diff[k];
      if (v !== undefined && (!isNum(v) || v < 1)) {
        errors.push(`drivetrain.${name}.${k} must be at least 1 (got ${String(v)})`);
      }
    }
  }
  const f = dt.center?.frontTorqueFraction;
  if (f !== undefined && (!isNum(f) || f <= 0 || f >= 1)) {
    errors.push(`drivetrain.center.frontTorqueFraction must be in (0, 1) (got ${String(f)})`);
  }
}

/** Validate a surface table before handing it to the core (ADR-0014). */
export function validateSurfaces(surfaces: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!Array.isArray(surfaces)) {
    return { ok: false, errors: ["surfaces must be an array"], warnings };
  }
  if (surfaces.length > 16)
    errors.push(`a surface table holds at most 16 surfaces (got ${surfaces.length})`);
  surfaces.forEach((s, i) => {
    if (typeof s !== "object" || s === null) {
      errors.push(`surfaces[${i}] must be an object`);
      return;
    }
    const v = s as Record<string, unknown>;
    const grip = v.grip;
    if (grip !== undefined && (!isNum(grip) || grip < 0 || grip > 5)) {
      errors.push(`surfaces[${i}].grip must be between 0 and 5 (got ${String(grip)})`);
    }
    nonNegative(errors, `surfaces[${i}].rollingResistance`, v.rollingResistance);
    const drag = v.drag;
    if (drag !== undefined && (!isNum(drag) || drag < 0 || drag > 1)) {
      errors.push(`surfaces[${i}].drag must be between 0 and 1 (got ${String(drag)})`);
    }
  });
  return { ok: errors.length === 0, errors, warnings };
}

export function validateDefinition(def: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (typeof def !== "object" || def === null || Array.isArray(def)) {
    return { ok: false, errors: ["definition must be a JSON object"], warnings };
  }
  const d = def as PartialVehicleDefinition;

  if (d.formatVersion !== undefined && d.formatVersion !== CURRENT_FORMAT_VERSION) {
    errors.push(
      `formatVersion ${String(d.formatVersion)} is not current (${CURRENT_FORMAT_VERSION}); call migrateDefinition() first`,
    );
  }

  const c = d.chassis ?? {};
  positive(errors, "chassis.mass", c.mass);
  positive(errors, "chassis.yawInertia", c.yawInertia);
  positive(errors, "chassis.rollInertia", c.rollInertia);
  positive(errors, "chassis.pitchInertia", c.pitchInertia);
  positive(errors, "chassis.wheelbase", c.wheelbase);
  positive(errors, "chassis.cgToFrontAxle", c.cgToFrontAxle);
  nonNegative(errors, "chassis.cgHeight", c.cgHeight);
  positive(errors, "chassis.trackWidth", c.trackWidth);
  if (isNum(c.wheelbase) && isNum(c.cgToFrontAxle) && c.cgToFrontAxle >= c.wheelbase) {
    errors.push(
      `chassis.cgToFrontAxle (${c.cgToFrontAxle}) must be less than the wheelbase (${c.wheelbase}); the centre of mass has to sit between the axles`,
    );
  }

  if (d.axles !== undefined) {
    if (!Array.isArray(d.axles)) {
      errors.push("axles must be an array [front, rear]");
    } else {
      if (d.axles.length !== 2) {
        errors.push(
          `axles must contain exactly two entries (front, rear) in this milestone; got ${d.axles.length}`,
        );
      }
      d.axles.forEach((a, i) => {
        const name = i === 0 ? "front" : "rear";
        const path = `axles[${i}] (${name})`;
        if (a && (a.driven === undefined || a.steered === undefined)) {
          warnings.push(
            `${path} omits "driven" or "steered"; the core default for both is the front-axle setting (driven, steered). Set them explicitly.`,
          );
        }
        validateTire(errors, warnings, `${path}.tire`, a?.tire);
        positive(errors, `${path}.wheelInertia`, a?.wheelInertia);
        nonNegative(errors, `${path}.maxBrakeTorque`, a?.maxBrakeTorque);
        const camber = a?.staticCamberDeg;
        if (camber !== undefined && (!isNum(camber) || Math.abs(camber) > 45)) {
          errors.push(`${path}.staticCamberDeg must be within ±45 degrees (got ${String(camber)})`);
        }
        const s = a?.suspension;
        if (s !== undefined) {
          if (typeof s !== "object" || s === null) {
            errors.push(`${path}.suspension must be an object`);
          } else {
            positive(errors, `${path}.suspension.springRate`, s.springRate);
            positive(errors, `${path}.suspension.travelBump`, s.travelBump);
            positive(errors, `${path}.suspension.travelDroop`, s.travelDroop);
            nonNegative(errors, `${path}.suspension.bumpDamping`, s.bumpDamping);
            nonNegative(errors, `${path}.suspension.reboundDamping`, s.reboundDamping);
            nonNegative(errors, `${path}.suspension.antiRollStiffness`, s.antiRollStiffness);
            nonNegative(errors, `${path}.suspension.bumpStopStiffness`, s.bumpStopStiffness);
            if (s.kind !== undefined && s.kind !== "independent" && s.kind !== "solid") {
              errors.push(
                `${path}.suspension.kind must be "independent" or "solid" (got "${String(s.kind)}")`,
              );
            }
            const rc = s.rollCenterHeight;
            if (rc !== undefined && (!isNum(rc) || Math.abs(rc) > 1)) {
              errors.push(
                `${path}.suspension.rollCenterHeight must be within ±1 m (got ${String(rc)})`,
              );
            }
            if (isNum(rc) && isNum(c.cgHeight) && rc > c.cgHeight) {
              warnings.push(
                `${path}.suspension.rollCenterHeight of ${rc} m is above the centre of mass (${c.cgHeight} m); the axle will jack the body outward in a corner`,
              );
            }
            // Static compression beyond the bump travel means the car sits
            // on its bump stops at rest; worth a warning, not an error.
            const mass = c.mass;
            const wb = c.wheelbase;
            const cgf = c.cgToFrontAxle;
            if (
              isNum(mass) &&
              isNum(wb) &&
              isNum(cgf) &&
              isNum(s.springRate) &&
              isNum(s.travelBump)
            ) {
              const share = i === 0 ? (wb - cgf) / wb : cgf / wb;
              const staticLoad = 0.5 * mass * 9.80665 * share;
              const compression = staticLoad / s.springRate;
              if (compression > s.travelBump) {
                warnings.push(
                  `${path}.suspension: the static load of ${staticLoad.toFixed(0)} N compresses the spring ${(compression * 1000).toFixed(0)} mm, more than the ${(s.travelBump * 1000).toFixed(0)} mm of bump travel; the car rests on its bump stops`,
                );
              }
            }
          }
        }
      });
      if (d.axles.length === 2 && d.axles.every((a) => a?.driven === false)) {
        errors.push("at least one axle must be driven");
      }
    }
  }

  const s = d.steering ?? {};
  if (
    s.maxWheelAngleDeg !== undefined &&
    (!isNum(s.maxWheelAngleDeg) || s.maxWheelAngleDeg <= 0 || s.maxWheelAngleDeg > 90)
  ) {
    errors.push(`steering.maxWheelAngleDeg must be in (0, 90] (got ${String(s.maxWheelAngleDeg)})`);
  }
  positive(errors, "steering.ratio", s.ratio);
  if (s.ackermann !== undefined && (!isNum(s.ackermann) || s.ackermann < 0 || s.ackermann > 1)) {
    errors.push(`steering.ackermann must be between 0 and 1 (got ${String(s.ackermann)})`);
  }
  if (
    s.powerAssist !== undefined &&
    (!isNum(s.powerAssist) || s.powerAssist < 0 || s.powerAssist > 1)
  ) {
    errors.push(`steering.powerAssist must be between 0 and 1 (got ${String(s.powerAssist)})`);
  }
  positive(errors, "steering.steeringArm", s.steeringArm);
  for (const k of ["mechanicalTrail", "scrubRadius", "jackingRate"] as const) {
    const v = s[k];
    if (v !== undefined && (!isNum(v) || Math.abs(v) > 0.5)) {
      errors.push(`steering.${k} must be within ±0.5 m (got ${String(v)})`);
    }
  }
  nonNegative(errors, "steering.columnFriction", s.columnFriction);
  nonNegative(errors, "steering.columnDamping", s.columnDamping);
  nonNegative(errors, "brakes.handbrakeTorque", d.brakes?.handbrakeTorque);
  validateDrivetrain(errors, warnings, d.drivetrain);
  const as = d.assists;
  if (as !== undefined) {
    const abs = as.abs ?? {};
    if (isNum(abs.slipTarget) && isNum(abs.slipRelease) && abs.slipRelease <= abs.slipTarget) {
      errors.push("assists.abs.slipRelease must exceed slipTarget");
    }
    positive(errors, "assists.abs.slipTarget", abs.slipTarget);
    if (abs.floor !== undefined && (!isNum(abs.floor) || abs.floor < 0 || abs.floor > 1)) {
      errors.push(`assists.abs.floor must be in [0, 1] (got ${String(abs.floor)})`);
    }
    nonNegative(errors, "assists.abs.minSpeed", abs.minSpeed);
    const tc = as.tractionControl ?? {};
    positive(errors, "assists.tractionControl.slipTarget", tc.slipTarget);
    if (isNum(tc.slipTarget) && isNum(tc.slipRelease) && tc.slipRelease <= tc.slipTarget) {
      errors.push("assists.tractionControl.slipRelease must exceed slipTarget");
    }
    const esc = as.stabilityControl ?? {};
    for (const k of ["gain", "deadBand", "throttleCut", "minSpeed"] as const) {
      nonNegative(errors, `assists.stabilityControl.${k}`, esc[k]);
    }
    positive(errors, "assists.steeringAssist.latAccelLimit", as.steeringAssist?.latAccelLimit);
  }
  if ((d as Record<string, unknown>).drive !== undefined) {
    warnings.push(
      'the "drive" block was replaced by "drivetrain" (ADR-0011); migrateDefinition() converts it to a direct power unit',
    );
  }
  nonNegative(errors, "aero.dragCoefficient", d.aero?.dragCoefficient);
  nonNegative(errors, "aero.frontalArea", d.aero?.frontalArea);
  nonNegative(errors, "aero.airDensity", d.aero?.airDensity);
  for (const k of ["liftCoefficientFront", "liftCoefficientRear"] as const) {
    const v = d.aero?.[k];
    if (v !== undefined && (!isNum(v) || Math.abs(v) > 10)) {
      errors.push(`aero.${k} must be within ±10 (got ${String(v)})`);
    }
  }
  const dh = d.aero?.dragHeightAboveCg;
  if (dh !== undefined && (!isNum(dh) || Math.abs(dh) > 5)) {
    errors.push(`aero.dragHeightAboveCg must be within ±5 m (got ${String(dh)})`);
  }
  const rate = d.simulation?.substepRateHz;
  if (rate !== undefined && (!isNum(rate) || rate < 60 || rate > 10000)) {
    errors.push(`simulation.substepRateHz must be between 60 and 10000 (got ${String(rate)})`);
  }
  if (isNum(rate) && rate < 240) {
    warnings.push(
      `simulation.substepRateHz of ${rate} is low for a player car; 1000 is the sim default`,
    );
  }
  const model = d.simulation?.model;
  if (model !== undefined && model !== "singleTrack" && model !== "fourWheel") {
    errors.push(`simulation.model must be "fourWheel" or "singleTrack" (got "${String(model)}")`);
  }

  return { ok: errors.length === 0, errors, warnings };
}
