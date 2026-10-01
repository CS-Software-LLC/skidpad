import { describe, expect, it, beforeAll } from "vitest";
import {
  init,
  type Skidpad,
  SkidpadError,
  validateAiConfig,
  chooseLod,
  LodController,
} from "../src/index.js";

let sp: Skidpad;
beforeAll(async () => {
  sp = await init();
});

function circle(r: number, n: number): [number, number][] {
  return Array.from({ length: n }, (_, k) => {
    const a = -Math.PI / 2 + (2 * Math.PI * k) / n;
    return [r * Math.cos(a), r * Math.sin(a)] as [number, number];
  });
}

describe("batched stepping", () => {
  it("stepMany matches single steps bit for bit", () => {
    const make = () => {
      const w = sp.createWorld(2);
      w.addVehicle({ name: "a" });
      w.addVehicle({ name: "b", simulation: { model: "singleTrack" } });
      w.setInput(0, { throttle: 0.8, steer: 0.2 });
      w.setInput(1, { throttle: 0.8, steer: -0.2 });
      return w;
    };
    const a = make();
    const b = make();
    for (let i = 0; i < 120; i++) a.step(1 / 60);
    b.stepMany(1 / 60, 120);
    expect(b.stepCount).toBe(120);
    expect(b.worldHash()).toBe(a.worldHash());
    expect(() => b.stepMany(1 / 60, 1.5)).toThrow(SkidpadError);
    a.free();
    b.free();
  });
});

describe("level of detail", () => {
  it("switches models without losing the motion", () => {
    const w = sp.createWorld(1);
    const car = w.addVehicle({ name: "lod" });
    w.setInput(car, { throttle: 1 });
    w.stepMany(1 / 60, 180);
    const speed = w.read(car, "Speed");
    expect(w.lod(car)).toBe("full");
    w.setLod(car, "singleTrack");
    expect(w.lod(car)).toBe("singleTrack");
    expect(Math.abs(w.read(car, "Speed") - speed)).toBeLessThan(0.05);
    w.step(1 / 60);
    expect(w.read(car, "Speed")).toBeGreaterThan(speed);

    const low = w.snapshot(car);
    w.setLod(car, "full");
    w.setLod(car, "frozen");
    const hash = w.stateHash(car);
    w.stepMany(1 / 60, 30);
    expect(w.stateHash(car)).toBe(hash);

    // A frozen car stays frozen whatever it restores; a running one takes
    // the level of the snapshot.
    w.restore(car, low);
    expect(w.lod(car)).toBe("frozen");
    w.setLod(car, "full");
    w.restore(car, low);
    expect(w.lod(car)).toBe("singleTrack");
    expect(() => w.setLod(car, "nope" as never)).toThrow(SkidpadError);
    expect(() => w.setLod(car, "full", -5)).toThrow(SkidpadError);
    w.free();
  });

  it("refuses to reduce an externally hosted car", () => {
    const w = sp.createWorld(1);
    const car = w.addVehicle({ name: "hosted" });
    w.setHostMode(car, "external");
    expect(() => w.setLod(car, "singleTrack")).toThrow(/single-track/);
    w.setLod(car, "frozen");
    expect(w.lod(car)).toBe("frozen");
    w.free();
  });
});

describe("path-following driver", () => {
  it("laps a circle and reports its status", () => {
    const w = sp.createWorld(1);
    const car = w.addVehicle({ name: "ai" });
    w.resetVehicle(car, 0, -50, 0);
    expect(w.aiStatus(car)).toBeNull();
    w.setAi(car, circle(50, 72), { lateralAccel: 5 });
    w.stepMany(1 / 60, 60 * 50);
    const st = w.aiStatus(car)!;
    expect(st.laps).toBeGreaterThanOrEqual(2);
    expect(Math.abs(st.lateralError)).toBeLessThan(0.6);
    expect(st.targetSpeed).toBeCloseTo(Math.sqrt(250), 0);
    expect(st.finished).toBe(false);
    expect(w.inputView(car)[0]).toBeLessThan(0);
    w.clearAi(car);
    expect(w.aiStatus(car)).toBeNull();
    w.free();
  });

  it("takes a flat path and an open path", () => {
    const w = sp.createWorld(1);
    const car = w.addVehicle({ name: "ai" });
    w.setAi(car, [0, 0, 60, 0], { closed: false, maxSpeed: 10 });
    w.stepMany(1 / 60, 60 * 25);
    const st = w.aiStatus(car)!;
    expect(st.finished).toBe(true);
    expect(w.read(car, "Speed")).toBeLessThan(0.2);
    w.free();
  });

  it("is deterministic", () => {
    const run = () => {
      const w = sp.createWorld(3);
      for (let i = 0; i < 3; i++) {
        w.addVehicle({ name: `ai${i}` });
        w.resetVehicle(i, 0, -50 + 3 * i, 0);
        w.setAi(i, circle(50, 72), { lateralOffset: 3 * i, maxSpeed: 12 + i });
      }
      w.stepMany(1 / 60, 600);
      const h = w.worldHash();
      w.free();
      return h;
    };
    expect(run()).toBe(run());
  });

  it("validates its config by field", () => {
    expect(validateAiConfig({})).toEqual([]);
    expect(validateAiConfig({ maxSpeed: 0 })[0]).toMatch(/maxSpeed must be positive/);
    expect(validateAiConfig({ speedGain: -1 })[0]).toMatch(/speedGain must be zero or positive/);
    expect(validateAiConfig({ lateralOffset: Number.NaN })[0]).toMatch(/lateralOffset/);
    const w = sp.createWorld(1);
    const car = w.addVehicle({ name: "ai" });
    expect(() => w.setAi(car, circle(10, 8), { brakeDecel: -1 })).toThrow(/brakeDecel/);
    expect(() => w.setAi(car, [0, 0, 1])).toThrow(SkidpadError);
    expect(() => w.setAi(car, [[0, 0]])).toThrow(SkidpadError);
    w.free();
  });
});

describe("LodController", () => {
  it("chooses levels with hysteresis", () => {
    const t = { singleTrackBeyond: 50, frozenBeyond: 200, hysteresis: 10 };
    expect(chooseLod(10, "full", t)).toBe("full");
    expect(chooseLod(55, "full", t)).toBe("singleTrack");
    // Coming back: stays single-track until 40 m.
    expect(chooseLod(45, "singleTrack", t)).toBe("singleTrack");
    expect(chooseLod(39, "singleTrack", t)).toBe("full");
    expect(chooseLod(250, "full", t)).toBe("frozen");
    expect(chooseLod(195, "frozen", t)).toBe("frozen");
    expect(chooseLod(150, "frozen", t)).toBe("singleTrack");
    expect(chooseLod(1e6, "full")).toBe("singleTrack");
  });

  it("applies levels to a world, keeping pinned and hosted cars up", () => {
    const w = sp.createWorld(4);
    for (let i = 0; i < 4; i++) w.addVehicle({ name: `c${i}` });
    w.setHostMode(3, "external");
    const lod = new LodController(w, { singleTrackBeyond: 50, frozenBeyond: 200 });
    lod.pin(0);
    lod.markExternal(3);
    const dist = [500, 100, 300, 100];
    expect(lod.update((i) => dist[i]!)).toBe(2);
    expect([0, 1, 2, 3].map((i) => w.lod(i))).toEqual(["full", "singleTrack", "frozen", "full"]);
    expect(lod.update((i) => dist[i]!)).toBe(0);
    w.free();
  });
});
