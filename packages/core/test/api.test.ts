import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { init, type Skidpad, WHEEL_ORDER } from "../src/index.js";
import * as main from "../src/index.js";
import * as compat from "../src/compat.js";

let sp: Skidpad;
beforeAll(async () => {
  sp = await init();
});

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};

describe("version identity", () => {
  it("reports the npm version, the crate version and a simulation version", () => {
    expect(sp.version).toBe(pkg.version);
    expect(sp.crateVersion).toMatch(/^\d+\.\d+\.\d+/);
    // Set by scripts/build-wasm.mjs from the Rust sources.
    expect(sp.simulationVersion).toMatch(/^[0-9a-f]{16}$/);
  });

  it("exports package.json", () => {
    const require = createRequire(import.meta.url);
    const resolved = require.resolve("@skidpad/core/package.json");
    expect(JSON.parse(readFileSync(resolved, "utf8")).name).toBe("@skidpad/core");
  });
});

describe("channel names", () => {
  it("match the core's telemetry layout (else run scripts/gen-channels.mjs)", () => {
    expect([...main.CHANNEL_NAMES]).toEqual(sp.telemetryLayout.map((c) => c.name));
  });
});

describe("entries", () => {
  it("compat exports what the main entry does, apart from defaultWasmUrl", () => {
    const names = (m: object) => Object.keys(m).sort();
    expect(names(compat)).toEqual(names(main).filter((n) => n !== "defaultWasmUrl"));
  });

  it("compat init accepts a WASM override", async () => {
    const bytes = readFileSync(main.defaultWasmUrl());
    const other = await compat.init({ wasm: bytes });
    expect(other.simulationVersion).toBe(sp.simulationVersion);
  });
});

describe("definitions", () => {
  it("completes a partial definition as addVehicle reads it", () => {
    expect(sp.completeDefinition({})).toEqual(sp.defaultDefinition());
    const def = sp.completeDefinition({
      chassis: { mass: 900 },
      assists: { abs: { enabled: true } },
    });
    expect(def.chassis.mass).toBe(900);
    expect(def.chassis.wheelbase).toBe(sp.defaultDefinition().chassis.wheelbase);
    expect(def.assists.abs.enabled).toBe(true);
    expect(typeof def.assists.abs.slipTarget).toBe("number");
    expect(() => sp.completeDefinition({ chassis: { mass: -1 } })).toThrow(/mass/);
    // The completed definition drives exactly like the partial one.
    const a = sp.createWorld(1);
    const b = sp.createWorld(1);
    a.addVehicle({ chassis: { mass: 900 }, assists: { abs: { enabled: true } } });
    b.addVehicle(def);
    for (const w of [a, b]) {
      w.setInput(0, { throttle: 1, steer: 0.3 });
      w.stepMany(1 / 60, 120);
    }
    expect(b.worldHash()).toBe(a.worldHash());
    a.free();
    b.free();
  });
});

describe("world API", () => {
  it("has wheel positions before the first step and after a reset", () => {
    const w = sp.createWorld(1);
    const car = w.addVehicle({});
    const view = () => Array.from(w.wheelPositionsView(car));
    const fresh = view();
    expect(fresh.every((v) => v === 0)).toBe(false);
    // Contact points on the ground.
    for (let k = 0; k < 4; k++) expect(fresh[k * 6 + 5]).toBeCloseTo(0, 9);
    // Hub one tire radius above the contact.
    const radius = w.wheelRays(car)[0]!.radius;
    expect(fresh[2]! - fresh[5]!).toBeCloseTo(radius, 9);
    w.resetVehicle(car, 7, 0, 0);
    expect(view()[0]).toBeCloseTo(fresh[0]! + 7, 9);
    // A step from rest agrees with the filled-in values.
    w.step(1 / 60);
    view().forEach((v, i) => expect(v).toBeCloseTo(fresh[i]! + (i % 3 === 0 ? 7 : 0), 3));
    // And so does a restore, without stepping.
    w.setInput(car, { throttle: 1 });
    w.stepMany(1 / 60, 60);
    const snap = w.snapshot(car);
    const there = view();
    w.stepMany(1 / 60, 60);
    w.restore(car, snap);
    view().forEach((v, i) => expect(v).toBeCloseTo(there[i]!, 2));
    w.free();
  });

  it("resets onto a heading vector without Math.atan2", () => {
    const a = sp.createWorld(1);
    const b = sp.createWorld(1);
    a.addVehicle({});
    b.addVehicle({});
    a.resetVehicle(0, 1, 2, [0, 1]);
    b.resetVehicle(0, 1, 2, Math.PI / 2);
    expect(a.read(0, "Yaw")).toBeCloseTo(Math.PI / 2, 12);
    expect(a.readAll(0).PosX).toBe(1);
    expect(() => a.resetVehicle(0, 0, 0, [0, 0])).toThrow(/heading/);
    a.free();
    b.free();
  });

  it("sets the surface under each wheel", () => {
    const w = sp.createWorld(1);
    const car = w.addVehicle({});
    w.setSurfaces([{}, { grip: 0.5 }]);
    w.setWheelSurface(car, "FL", 1);
    w.setWheelSurface(car, 3, 1);
    w.step(1 / 60);
    expect(WHEEL_ORDER.map((n) => w.read(car, `SurfaceId_${n}`))).toEqual([1, 0, 0, 1]);
    expect(() => w.setWheelSurface(car, "XX" as never, 1)).toThrow(/unknown wheel/);
    w.free();
  });

  it("snapshots a whole world, step counter included", () => {
    const w = sp.createWorld(2);
    w.addVehicle({});
    w.addVehicle({});
    w.setInput(0, { throttle: 1 });
    w.setInput(1, { throttle: 0.5, steer: 0.2 });
    w.stepMany(1 / 60, 60);
    const saved = w.snapshotWorld();
    const hash = w.worldHash();
    w.stepMany(1 / 60, 30);
    const ahead = w.worldHash();
    w.restoreWorld(saved);
    expect(w.stepCount).toBe(60);
    expect(w.worldHash()).toBe(hash);
    w.stepMany(1 / 60, 30);
    expect(w.worldHash()).toBe(ahead);
    expect(() => w.restoreWorld(saved.subarray(0, 30))).toThrow(/truncated/);
    w.free();
  });
});
