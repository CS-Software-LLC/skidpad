import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  init,
  type Skidpad,
  validateDefinition,
  migrateDefinition,
  MigrationError,
  CURRENT_FORMAT_VERSION,
  triangleWave,
  smoothWave,
} from "../src/index.js";
import { init as initCompat } from "../src/compat.js";

const pinnedHash = readFileSync(
  fileURLToPath(new URL("../../../crates/skidpad-math/selftest.hash", import.meta.url)),
  "utf8",
).trim();
const tirText = readFileSync(
  fileURLToPath(
    new URL("../../../crates/skidpad-core/tests/fixtures/synthetic_passenger.tir", import.meta.url),
  ),
  "utf8",
);

let sp: Skidpad;
beforeAll(async () => {
  sp = await init();
});

describe("loading", () => {
  it("reports a version and a telemetry layout", () => {
    expect(sp.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(sp.telemetryLayout.length).toBeGreaterThan(20);
    expect(sp.channel("Speed")).toBeGreaterThanOrEqual(0);
    expect(sp.channel("Nope")).toBe(-1);
  });

  it("math self-test hash matches the pinned native value", () => {
    expect(sp.mathSelftestHash()).toBe(pinnedHash);
  });

  it("compat build produces the same hash", async () => {
    const c = await initCompat();
    expect(c.mathSelftestHash()).toBe(pinnedHash);
  });

  it("exposes the default definition", () => {
    const d = sp.defaultDefinition();
    expect(d.formatVersion).toBe(CURRENT_FORMAT_VERSION);
    expect(d.axles).toHaveLength(2);
    expect(d.chassis.mass).toBe(1300);
    expect(validateDefinition(d).ok).toBe(true);
  });
});

describe("world", () => {
  it("steps a vehicle and reads telemetry", () => {
    const w = sp.createWorld(2);
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
      const w = sp.createWorld(1);
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

    const a = sp.createWorld(1);
    const b = sp.createWorld(1);
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
    const w = sp.createWorld(1);
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
    const w = sp.createWorld(1);
    w.addVehicle({});
    expect(() => w.addVehicle({})).toThrow(/full/);
    w.free();
  });

  it("supports live definition swaps", () => {
    const w = sp.createWorld(1);
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

describe("four-wheel model and host contract", () => {
  it("rests at ride height with per-wheel channels", () => {
    const w = sp.createWorld(1);
    const d = sp.defaultDefinition();
    const i = w.addVehicle(d);
    for (let k = 0; k < 120; k++) w.step(1 / 60);
    expect(w.read(i, "PosZ")).toBeCloseTo(d.chassis.cgHeight, 6);
    expect(w.read(i, "Speed")).toBeLessThan(1e-9);
    const loads = ["FL", "FR", "RL", "RR"].map((s) => w.read(i, `TireLoad_${s}`));
    expect(loads.reduce((a, b) => a + b, 0)).toBeCloseTo(d.chassis.mass * 9.80665, 0);
    expect(w.read(i, "WheelContact_RR")).toBe(1);
    expect(w.read(i, "QuatW")).toBeCloseTo(1, 9);
    w.free();
  });

  it("rolls into a corner and transfers load outward", () => {
    const w = sp.createWorld(1);
    const i = w.addVehicle({});
    w.setInput(i, { throttle: 0.6 });
    for (let k = 0; k < 240; k++) w.step(1 / 60);
    w.setInput(i, { throttle: 0.3, steer: 0.3 });
    for (let k = 0; k < 240; k++) w.step(1 / 60);
    expect(w.read(i, "LatAccel")).toBeLessThan(-2);
    expect(w.read(i, "Roll")).toBeLessThan(-0.005);
    expect(w.read(i, "TireLoad_FL")).toBeGreaterThan(w.read(i, "TireLoad_FR"));
    expect(w.read(i, "SuspTravel_FL")).toBeGreaterThan(w.read(i, "SuspTravel_FR"));
    w.free();
  });

  it("the single-track model still runs from the same definition", () => {
    const w = sp.createWorld(1);
    const i = w.addVehicle({ simulation: { model: "singleTrack" } });
    w.setInput(i, { throttle: 1 });
    for (let k = 0; k < 120; k++) w.step(1 / 60);
    expect(w.read(i, "Speed")).toBeGreaterThan(5);
    expect(w.read(i, "Roll")).toBe(0);
    expect(() => w.setHostMode(i, "external")).toThrow(/single-track/);
    expect(() => w.wheelRays(i)).toThrow(/single-track/);
    w.free();
  });

  it("exposes wheel rays and the host-sync contract", () => {
    const w = sp.createWorld(1);
    const d = sp.defaultDefinition();
    const i = w.addVehicle(d);
    const rays = w.wheelRays(i);
    expect(rays).toHaveLength(sp.wheelCount);
    expect(rays[0]!.origin[0]).toBeCloseTo(d.chassis.cgToFrontAxle, 9);
    expect(rays[1]!.origin[1]).toBeLessThan(0);
    expect(rays[0]!.direction).toEqual([0, 0, -1]);
    expect(rays[0]!.radius).toBeGreaterThan(0.2);

    w.setHostMode(i, "external");
    // Body resting level at ride height on flat ground: the impulse over a
    // step must balance gravity.
    w.writeHostBody(i, 0, 0, d.chassis.cgHeight, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0);
    for (let k = 0; k < 4; k++) {
      w.writeWheelContact(i, k, { point: [0, 0, 0], normal: [0, 0, 1] });
    }
    w.step(1 / 60);
    const imp = w.readHostImpulse(i);
    expect(imp.impulse[2]).toBeCloseTo((d.chassis.mass * 9.80665) / 60, 3);
    expect(Math.abs(imp.impulse[0])).toBeLessThan(1e-6);
    expect(Math.abs(imp.angularImpulse[0])).toBeLessThan(1e-6);
    const hubs = w.wheelPositionsView(i);
    expect(hubs[2]).toBeCloseTo(rays[0]!.radius, 6);

    // Airborne: no contacts, no impulse beyond drag.
    w.writeHostBody(i, 0, 0, 10, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0);
    for (let k = 0; k < 4; k++) w.clearWheelContact(i, k);
    w.step(1 / 60);
    const air = w.readHostImpulse(i);
    expect(Math.abs(air.impulse[2])).toBeLessThan(1e-3);
    expect(w.read(i, "WheelContact_FL")).toBe(0);
    expect(w.read(i, "TireLoad_FL")).toBe(0);

    w.setHostMode(i, "builtin");
    w.step(1 / 60);
    expect(w.read(i, "PosZ")).toBeCloseTo(d.chassis.cgHeight, 3);
    w.free();
  });

  it("validates suspension and model fields in plain language", () => {
    const v = validateDefinition({
      chassis: { mass: 1500, wheelbase: 2.6, cgToFrontAxle: 1.2 },
      axles: [
        { driven: true, steered: true, suspension: { springRate: 5000, travelBump: 0.05 } },
        { driven: false, steered: false, suspension: { springRate: -1 } },
      ],
      steering: { ackermann: 2 },
      simulation: { model: "hover" as never },
    });
    expect(v.ok).toBe(false);
    expect(v.errors.join("\n")).toMatch(/suspension\.springRate must be a positive number/);
    expect(v.errors.join("\n")).toMatch(/steering\.ackermann must be between 0 and 1/);
    expect(v.errors.join("\n")).toMatch(/simulation\.model must be/);
    expect(v.warnings.join("\n")).toMatch(/rests on its bump stops/);
  });
});

describe("tire", () => {
  it("evaluates and sweeps", () => {
    const t = sp.createTire({ model: "feel" });
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
    const imp = sp.importTir(tirText);
    expect(imp.params.model).toBe("magicFormula");
    expect(imp.params.pky1).toBe(-19);
    expect(imp.warnings.some((w) => w.key === "PTX1")).toBe(true);
    const t = sp.createTire(imp.params);
    const o = t.eval({ fz: 4500, slipRatio: 0.1, slipAngle: 0 });
    expect(o.fx).toBeGreaterThan(3500);
    t.free();
  });

  it("rejects positive PKY1", () => {
    expect(() => sp.createTire({ model: "magicFormula", pky1: 20 })).toThrow(/ISO sign convention/);
  });
});

describe("scenarios", () => {
  it("runs the understeer gradient scenario", () => {
    const r = sp.runScenario({
      scenario: "understeerGradient",
      definition: {},
      config: { speeds: [4, 8, 12] },
    });
    expect(r.points).toHaveLength(3);
    expect(r.gradient).toBeGreaterThan(0);
    expect(Math.abs(r.gradientDegPerG - r.analyticGradientDegPerG)).toBeLessThan(0.3);
  });

  it("runs the straight line scenario", () => {
    const r = sp.runScenario({ scenario: "straightLine", definition: {} });
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
