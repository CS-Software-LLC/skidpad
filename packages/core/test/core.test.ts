import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  init,
  type ContactPatch,
  validateDefinition,
  migrateDefinition,
  MigrationError,
  CURRENT_FORMAT_VERSION,
  triangleWave,
  smoothWave,
} from "../src/index.js";
import { init as initCompat } from "../src/compat.js";

const pinnedHash = readFileSync(
  fileURLToPath(new URL("../../../crates/cp-math/selftest.hash", import.meta.url)),
  "utf8",
).trim();
const tirText = readFileSync(
  fileURLToPath(
    new URL("../../../crates/cp-core/tests/fixtures/synthetic_passenger.tir", import.meta.url),
  ),
  "utf8",
);

let cp: ContactPatch;
beforeAll(async () => {
  cp = await init();
});

describe("loading", () => {
  it("reports a version and a telemetry layout", () => {
    expect(cp.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(cp.telemetryLayout.length).toBeGreaterThan(20);
    expect(cp.channel("Speed")).toBeGreaterThanOrEqual(0);
    expect(cp.channel("Nope")).toBe(-1);
  });

  it("math self-test hash matches the pinned native value", () => {
    expect(cp.mathSelftestHash()).toBe(pinnedHash);
  });

  it("compat build produces the same hash", async () => {
    const c = await initCompat();
    expect(c.mathSelftestHash()).toBe(pinnedHash);
  });

  it("exposes the default definition", () => {
    const d = cp.defaultDefinition();
    expect(d.formatVersion).toBe(CURRENT_FORMAT_VERSION);
    expect(d.axles).toHaveLength(2);
    expect(d.chassis.mass).toBe(1300);
    expect(validateDefinition(d).ok).toBe(true);
  });
});

describe("world", () => {
  it("steps a vehicle and reads telemetry", () => {
    const w = cp.createWorld(2);
    const i = w.addVehicle({ name: "t" });
    w.setInput(i, { throttle: 1 });
    for (let k = 0; k < 120; k++) w.step(1 / 60);
    expect(w.read(i, "Speed")).toBeGreaterThan(5);
    expect(w.read(i, "Time")).toBeCloseTo(2, 6);
    expect(w.readAll(i).Throttle).toBe(1);
    expect(w.stepCount).toBe(120);
    w.free();
  });

  it("is deterministic and snapshot/restore round-trips", () => {
    const run = (): string[] => {
      const w = cp.createWorld(1);
      const i = w.addVehicle({});
      const hashes: string[] = [];
      for (let k = 0; k < 600; k++) {
        w.setInput(i, { steer: Math.sin(k * 0.05) * 0.4, throttle: 0.7 });
        w.step(1 / 60);
        if (k % 100 === 0) hashes.push(w.stateHash(i));
      }
      w.free();
      return hashes;
    };
    expect(run()).toEqual(run());

    const a = cp.createWorld(1);
    const b = cp.createWorld(1);
    a.addVehicle({});
    b.addVehicle({});
    a.setInput(0, { throttle: 1, steer: 0.2 });
    b.setInput(0, { throttle: 1, steer: 0.2 });
    for (let k = 0; k < 200; k++) {
      a.step(1 / 60);
      b.step(1 / 60);
    }
    const snap = a.snapshot(0);
    expect(snap.length).toBeGreaterThan(12);
    b.setInput(0, { brake: 1, steer: -1 });
    for (let k = 0; k < 50; k++) b.step(1 / 60);
    b.restore(0, snap);
    b.setInput(0, { throttle: 1, steer: 0.2, brake: 0 });
    expect(b.stateHash(0)).toBe(a.stateHash(0));
    for (let k = 0; k < 200; k++) {
      a.step(1 / 60);
      b.step(1 / 60);
    }
    expect(b.stateHash(0)).toBe(a.stateHash(0));
    a.free();
    b.free();
  });

  it("rejects bad definitions with readable errors before the WASM boundary", () => {
    const w = cp.createWorld(1);
    expect(() => w.addVehicle({ chassis: { mass: -5 } })).toThrow(
      /chassis\.mass must be a positive number/,
    );
    expect(() =>
      w.addVehicle({ axles: [{ tire: { model: "feel", peakFriction: 0 } }, {}] }),
    ).toThrow(/axles\[0\] \(front\)\.tire\.peakFriction/);
    expect(() => w.restore(0, new Uint8Array([1, 2, 3]))).toThrow();
    w.free();
  });

  it("enforces capacity", () => {
    const w = cp.createWorld(1);
    w.addVehicle({});
    expect(() => w.addVehicle({})).toThrow(/full/);
    w.free();
  });

  it("supports live definition swaps", () => {
    const w = cp.createWorld(1);
    w.addVehicle({});
    // Gentle throttle so the driven wheel does not spin up; a spinning wheel
    // would keep pushing the car after torque is removed, which is correct.
    w.setInput(0, { throttle: 0.3 });
    for (let k = 0; k < 120; k++) w.step(1 / 60);
    const before = w.read(0, "Speed");
    w.setDefinition(0, { drive: { maxWheelTorque: 0 } });
    for (let k = 0; k < 120; k++) w.step(1 / 60);
    expect(w.read(0, "Speed")).toBeLessThan(before);
    w.free();
  });
});

describe("tire", () => {
  it("evaluates and sweeps", () => {
    const t = cp.createTire({ model: "feel" });
    const o = t.eval({ fz: 4000, slipRatio: 0, slipAngle: 0.05 });
    expect(o.fy).toBeLessThan(0);
    expect(o.mz).toBeGreaterThan(0);
    const sweep = t.sweep({ axis: "slipAngle", from: 0, to: 0.3, n: 50, fz: 4000 });
    expect(sweep.length).toBe(50 * 8);
    expect(sweep[1]).toBeCloseTo(0, 12);
    expect(sweep[49 * 8 + 1]).toBeLessThan(-3000);
    t.free();
  });

  it("imports .tir files with warnings", () => {
    const imp = cp.importTir(tirText);
    expect(imp.params.model).toBe("magicFormula");
    expect(imp.params.pky1).toBe(-19);
    expect(imp.warnings.some((w) => w.key === "PTX1")).toBe(true);
    const t = cp.createTire(imp.params);
    const o = t.eval({ fz: 4500, slipRatio: 0.1, slipAngle: 0 });
    expect(o.fx).toBeGreaterThan(3500);
    t.free();
  });

  it("rejects positive PKY1", () => {
    expect(() => cp.createTire({ model: "magicFormula", pky1: 20 })).toThrow(/ISO sign convention/);
  });
});

describe("scenarios", () => {
  it("runs the understeer gradient scenario", () => {
    const r = cp.runScenario({
      scenario: "understeerGradient",
      definition: {},
      config: { speeds: [4, 8, 12] },
    });
    expect(r.points).toHaveLength(3);
    expect(r.gradient).toBeGreaterThan(0);
    expect(Math.abs(r.gradientDegPerG - r.analyticGradientDegPerG)).toBeLessThan(0.3);
  });

  it("runs the straight line scenario", () => {
    const r = cp.runScenario({ scenario: "straightLine", definition: {} });
    expect(r.accelTime).not.toBeNull();
    expect(r.brakingDistance).toBeGreaterThan(30);
  });
});

describe("waveforms", () => {
  it("triangle and smooth waves stay in range and are periodic", () => {
    expect(triangleWave(0, 100)).toBe(-1);
    expect(triangleWave(50, 100)).toBe(1);
    expect(triangleWave(25, 100)).toBe(0);
    expect(triangleWave(150, 100)).toBe(triangleWave(50, 100));
    expect(triangleWave(-1, 100)).toBe(triangleWave(99, 100));
    for (let k = 0; k < 400; k++) {
      expect(Math.abs(smoothWave(k, 120, 7))).toBeLessThanOrEqual(1);
    }
  });
});

describe("migrations", () => {
  it("migrates version 0 and rejects the future", () => {
    expect(migrateDefinition({ name: "old" }).formatVersion).toBe(CURRENT_FORMAT_VERSION);
    expect(migrateDefinition({ formatVersion: 1, name: "cur" }).formatVersion).toBe(1);
    expect(() => migrateDefinition({ formatVersion: 99 })).toThrow(MigrationError);
    expect(() => migrateDefinition("nope")).toThrow(MigrationError);
  });

  it("validation explains problems in plain language", () => {
    const v = validateDefinition({
      chassis: { wheelbase: 2, cgToFrontAxle: 3 },
      axles: [{ driven: false }, { driven: false }],
      simulation: { substepRateHz: 100 },
    });
    expect(v.ok).toBe(false);
    expect(v.errors.join("\n")).toMatch(/centre of mass has to sit between the axles/);
    expect(v.errors.join("\n")).toMatch(/at least one axle must be driven/);
    expect(v.warnings.join("\n")).toMatch(/low for a player car/);
  });
});
