import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { MessageChannel, Worker } from "node:worker_threads";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { init, type Skidpad } from "@skidpad/core";
import { preset } from "@skidpad/presets";
import { WorkerWorld, serveWorld, nodeEndpoint, type Endpoint } from "../src/index.js";

let sp: Skidpad;
const ports: { close(): void }[] = [];
beforeAll(async () => {
  sp = await init();
});
afterAll(() => ports.forEach((p) => p.close()));

/** A world served over an in-process MessageChannel: the protocol without a thread. */
async function channelWorld(capacity: number): Promise<WorkerWorld> {
  const { port1, port2 } = new MessageChannel();
  ports.push(port1, port2);
  serveWorld(port2 as unknown as Endpoint);
  return WorkerWorld.create(port1 as unknown as Endpoint, { capacity });
}

function circle(r: number, n: number): [number, number][] {
  return Array.from({ length: n }, (_, k) => {
    const a = -Math.PI / 2 + (2 * Math.PI * k) / n;
    return [r * Math.cos(a), r * Math.sin(a)] as [number, number];
  });
}

describe("worker world over a message channel", () => {
  it("matches a main-thread world bit for bit", async () => {
    const ww = await channelWorld(3);
    expect(ww.version).toBe(sp.version);
    const local = sp.createWorld(3);
    const defs = [preset("sportsRwd"), preset("kart"), preset("hatchbackFwd")];
    for (const d of defs) {
      expect(await ww.addVehicle(d)).toBe(local.addVehicle(d));
    }
    await ww.resetVehicle(2, 0, -50, 0);
    local.resetVehicle(2, 0, -50, 0);
    await ww.setAi(2, circle(50, 72), { maxSpeed: 15 });
    local.setAi(2, circle(50, 72), { maxSpeed: 15 });
    await ww.setLod(1, "singleTrack");
    local.setLod(1, "singleTrack");
    expect(ww.vehicleCount).toBe(3);

    for (let k = 0; k < 300; k++) {
      const input = { throttle: 0.7, steer: ((k % 120) - 60) / 120 };
      ww.setInput(0, input);
      ww.setInput(1, input);
      local.setInput(0, input);
      local.setInput(1, input);
      await ww.step(1 / 60);
      local.step(1 / 60);
    }
    expect(ww.stepCount).toBe(300);
    expect(await ww.worldHash()).toBe(local.worldHash());
    expect(ww.read(0, "Speed")).toBe(local.read(0, "Speed"));
    expect(Array.from(ww.telemetryView(2))).toEqual(Array.from(local.telemetryView(2)));
    // The driver's inputs come back with each answer.
    expect(ww.appliedInputView(2)[1]).toBe(local.inputView(2)[1]);
    expect((await ww.aiStatus(2))!.laps).toBe(local.aiStatus(2)!.laps);
    expect(await ww.lod(1)).toBe("singleTrack");

    // Snapshots cross the boundary both ways.
    const snap = await ww.snapshot(0);
    expect(Array.from(snap)).toEqual(Array.from(local.snapshot(0)));
    await ww.step(1 / 60, 30);
    await ww.restore(0, snap);
    expect(await ww.stateHash(0)).toBe(local.stateHash(0));
    await ww.free();
    local.free();
  });

  it("pipelines steps in order", async () => {
    const ww = await channelWorld(1);
    const local = sp.createWorld(1);
    await ww.addVehicle({ name: "p" });
    local.addVehicle({ name: "p" });
    const inflight: Promise<void>[] = [];
    for (let k = 0; k < 60; k++) {
      ww.setInput(0, { throttle: k / 60 });
      local.setInput(0, { throttle: k / 60 });
      inflight.push(ww.step(1 / 60));
      local.step(1 / 60);
    }
    expect(ww.stepsInFlight).toBe(60);
    await Promise.all(inflight);
    expect(ww.stepsInFlight).toBe(0);
    expect(await ww.worldHash()).toBe(local.worldHash());
    expect(ww.workerStepMs).toBeGreaterThanOrEqual(0);
    local.free();
  });

  it("reports errors as SkidpadErrors", async () => {
    const ww = await channelWorld(1);
    await expect(ww.setLod(4, "full")).rejects.toThrow(/no vehicle/);
    await expect(ww.addVehicle({ chassis: { mass: -1 } } as never)).rejects.toThrow(/mass/);
    expect(() => ww.read(0, "Nope")).toThrow(/unknown telemetry channel/);
  });
});

const workerFile = fileURLToPath(new URL("./fixtures/node-worker.mjs", import.meta.url));
const built = existsSync(fileURLToPath(new URL("../dist/index.js", import.meta.url)));

describe("worker world in a real worker thread", () => {
  it.skipIf(!built)("steps off the main thread and agrees with the main thread", async () => {
    const thread = new Worker(workerFile);
    try {
      const ww = await WorkerWorld.create(nodeEndpoint(thread), { capacity: 2 });
      const local = sp.createWorld(2);
      for (let i = 0; i < 2; i++) {
        await ww.addVehicle(preset("sportsRwd"));
        local.addVehicle(preset("sportsRwd"));
        ww.setInput(i, { throttle: 1, steer: 0.1 * i });
        local.setInput(i, { throttle: 1, steer: 0.1 * i });
      }
      await ww.step(1 / 60, 240);
      local.stepMany(1 / 60, 240);
      expect(await ww.worldHash()).toBe(local.worldHash());
      expect(ww.read(1, "PosY")).toBe(local.read(1, "PosY"));
      local.free();
    } finally {
      await thread.terminate();
    }
  });
});
