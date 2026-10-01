import type { PartialVehicleDefinition, TireDefinition } from "./types.js";
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
    ]) {
      positive(errors, `${path}.${k}`, t[k]);
    }
    for (const k of ["falloffLong", "falloffLat"]) {
      const v = t[k];
      if (v !== undefined && (!isNum(v) || v <= 0 || v > 1)) {
        errors.push(`${path}.${k} must be in (0, 1] (got ${String(v)})`);
      }
    }
    const ls = t.loadSensitivity;
    if (ls !== undefined && (!isNum(ls) || ls < 0 || ls >= 1)) {
      errors.push(`${path}.loadSensitivity must be in [0, 1) (got ${String(ls)})`);
    }
    for (const k of ["camberStiffness", "pneumaticTrail", "rollingResistance"]) {
      nonNegative(errors, `${path}.${k}`, t[k]);
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
    ]) {
      positive(errors, `${path}.${k}`, t[k]);
    }
    const pky1 = t.pky1;
    if (isNum(pky1) && pky1 > 0) {
      errors.push(
        `${path}.pky1 is positive; Contact Patch uses the ISO sign convention in which PKY1 is negative (ADR-0007)`,
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
 * the core. This mirrors the checks in `cp-core` so problems surface before
 * the WASM boundary.
 */
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
  positive(errors, "chassis.wheelbase", c.wheelbase);
  positive(errors, "chassis.cgToFrontAxle", c.cgToFrontAxle);
  nonNegative(errors, "chassis.cgHeight", c.cgHeight);
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
  nonNegative(errors, "brakes.handbrakeTorque", d.brakes?.handbrakeTorque);
  nonNegative(errors, "drive.maxWheelTorque", d.drive?.maxWheelTorque);
  positive(errors, "drive.maxWheelSpeed", d.drive?.maxWheelSpeed);
  nonNegative(errors, "aero.dragCoefficient", d.aero?.dragCoefficient);
  nonNegative(errors, "aero.frontalArea", d.aero?.frontalArea);
  nonNegative(errors, "aero.airDensity", d.aero?.airDensity);
  const rate = d.simulation?.substepRateHz;
  if (rate !== undefined && (!isNum(rate) || rate < 60 || rate > 10000)) {
    errors.push(`simulation.substepRateHz must be between 60 and 10000 (got ${String(rate)})`);
  }
  if (isNum(rate) && rate < 240) {
    warnings.push(
      `simulation.substepRateHz of ${rate} is low for a player car; 1000 is the sim default`,
    );
  }

  return { ok: errors.length === 0, errors, warnings };
}
