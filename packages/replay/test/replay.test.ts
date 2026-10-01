import { describe, expect, it, beforeAll } from "vitest";
import { init, type Skidpad, type World, LodController } from "@skidpad/core";
import { preset } from "@skidpad/presets";
import {
  ReplayRecorder,
  ReplayPlayer,
  createReplayWorld,
  encodeReplay,
  decodeReplay,
  GhostRecorder,
  GhostPlayer,
  encodeGhost,
  decodeGhost,
  sliceGhost,
  ghostDuration,
} from "../src/index.js";

let sp: Skidpad;
beforeAll(async () => {
  sp = await init();
});

const DT = 1 / 60;

function circle(r: number, n: number): [number, number][] {
  return Array.from({ length: n }, (_, k) => {
    const a = -Math.PI / 2 + (2 * Math.PI * k) / n;
    return [r * Math.cos(a), r * Math.sin(a)] as [number, number];
  });
}

const defs = [preset("sportsRwd"), preset("hatchbackFwd"), preset("kart")];

/** Three cars: one driven by scripted inputs, two by the core's driver. */
function scene(): World {
  const w = sp.createWorld(3);
  defs.forEach((d) => w.addVehicle(d));
  w.resetVehicle(1, 0, -50, 0);
  w.resetVehicle(2, 0, -46, 0);
  w.setAi(1, circle(50, 72), { maxSpeed: 18 });
  w.setAi(2, circle(50, 72), { maxSpeed: 14, lateralOffset: 4 });
  return w;
}

function drive(w: World, k: number): void {
  w.setInput(0, {
    throttle: k < 300 ? 0.8 : 0.2,
    steer: Math.sin(k / 50) * 0.3,
    brake: k > 900 ? 0.5 : 0,
  });
}

describe("replays", () => {
  it("re-simulate bit for bit, through level changes", () => {
    const w = scene();
    const rec = new ReplayRecorder(w, sp.version, {
      keyframeEvery: 300,
      definitions: defs,
      meta: { track: "circle" },
    });
    const lod = new LodController(rec, { singleTrackBeyond: 30 });
    const hashes: string[] = [];
    for (let k = 0; k < 1200; k++) {
      drive(w, k);
      // Car 2 drops to single-track and back as an arbitrary "camera" moves.
      lod.update((i) => (i === 2 ? (k % 400 < 200 ? 10 : 60) : 0));
      if (k === 700) rec.setLod(1, "frozen");
      if (k === 760) rec.setLod(1, "singleTrack", 240);
      if (k === 820) w.setLod(1, "full");
      rec.step(DT);
      hashes.push(w.stateHash(0) + w.stateHash(1) + w.stateHash(2));
    }
    const replay = rec.finish();
    expect(replay.steps).toBe(1200);
    expect(replay.keyframes.map((k) => k.step)).toEqual([0, 300, 600, 900, 1200]);

    const pw = createReplayWorld(sp, replay);
    const player = new ReplayPlayer(pw, replay);
    for (let k = 0; k < 1200; k++) {
      expect(player.advance()).toBe(1);
      expect(pw.stateHash(0) + pw.stateHash(1) + pw.stateHash(2)).toBe(hashes[k]);
    }
    expect(player.done).toBe(true);
    expect(player.advance()).toBe(0);
    expect(player.desyncs).toBe(0);
    expect(player.time).toBeCloseTo(20, 9);
    w.free();
    pw.free();
  });

  it("seek forwards and backwards", () => {
    const w = scene();
    const rec = new ReplayRecorder(w, sp.version, { keyframeEvery: 120, definitions: defs });
    const hashes: string[] = [];
    for (let k = 0; k < 600; k++) {
      drive(w, k);
      rec.step(DT);
      hashes.push(w.stateHash(0) + w.stateHash(2));
    }
    const replay = rec.finish();
    const pw = createReplayWorld(sp, replay);
    const player = new ReplayPlayer(pw, replay);
    for (const target of [450, 130, 131, 599, 1, 240, 10_000]) {
      player.seek(target);
      const at = Math.min(target, 600);
      expect(player.position).toBe(at);
      expect(pw.stateHash(0) + pw.stateHash(2)).toBe(hashes[at - 1]);
    }
    player.seek(0);
    expect(player.position).toBe(0);
    pw.free();
    w.free();
  });

  it("round-trip through the binary format", () => {
    const w = scene();
    const rec = new ReplayRecorder(w, sp.version, {
      vehicles: [0, 2],
      definitions: [defs[0]!, defs[2]!],
      meta: { lap: 1 },
    });
    for (let k = 0; k < 700; k++) {
      drive(w, k);
      rec.step(DT);
    }
    const replay = rec.finish();
    const bytes = encodeReplay(replay);
    // Per step: the step length, and per car 6 inputs, a level and its rate
    // (57 bytes); plus two keyframes of two snapshots and the definitions.
    const defsJson = JSON.stringify([defs[0], defs[2]]).length;
    expect(bytes.byteLength).toBeLessThan(700 * (8 + 2 * 57) + 4 * 400 + defsJson + 2_000);
    const back = decodeReplay(bytes);
    expect(back.steps).toBe(700);
    expect(back.vehicles).toEqual([0, 2]);
    expect(back.meta).toEqual({ lap: 1 });
    expect(Array.from(back.inputs)).toEqual(Array.from(replay.inputs));
    expect(back.keyframes[1]!.hashes).toEqual(replay.keyframes[1]!.hashes);

    const pw = createReplayWorld(sp, back);
    const player = new ReplayPlayer(pw, back);
    player.advance(700);
    expect(pw.stateHash(0)).toBe(w.stateHash(0));
    expect(pw.stateHash(1)).toBe(w.stateHash(2));
    expect(player.desyncs).toBe(0);

    expect(() => decodeReplay(bytes.subarray(0, 8))).toThrow();
    const bad = bytes.slice();
    bad[0] = 0;
    expect(() => decodeReplay(bad)).toThrow(/SKRP/);
    pw.free();
    w.free();
  });

  it("re-sync at keyframes when the playback world differs", () => {
    const w = scene();
    const rec = new ReplayRecorder(w, sp.version, { vehicles: [0], keyframeEvery: 100 });
    for (let k = 0; k < 400; k++) {
      drive(w, k);
      rec.step(DT);
    }
    const replay = rec.finish();
    // A heavier car: the physics diverges, the keyframes pull it back.
    const pw = sp.createWorld(1);
    pw.addVehicle({
      ...preset("sportsRwd"),
      chassis: { ...preset("sportsRwd").chassis, mass: 2500 },
    });
    const player = new ReplayPlayer(pw, replay);
    player.advance(400);
    expect(player.desyncs).toBeGreaterThan(0);
    expect(pw.stateHash(0)).toBe(w.stateHash(0));
    const strict = new ReplayPlayer(pw, replay, { verify: false });
    strict.advance(400);
    expect(strict.desyncs).toBe(0);
    expect(pw.stateHash(0)).not.toBe(w.stateHash(0));
    expect(() => createReplayWorld(sp, replay)).toThrow(/definitions/);
    expect(() => new ReplayPlayer(pw, replay, { targets: [0, 1] })).toThrow();
    pw.free();
    w.free();
  });
});

describe("ghosts", () => {
  it("record a pose track and interpolate it", () => {
    const w = scene();
    const g = new GhostRecorder(w, 1, sp, { meta: { driver: "ai" } });
    const truth: { x: number; y: number; yaw: number }[] = [];
    for (let k = 0; k < 600; k++) {
      w.step(DT);
      g.sample(DT);
      truth.push({ x: w.read(1, "PosX"), y: w.read(1, "PosY"), yaw: w.read(1, "Yaw") });
    }
    const ghost = g.finish();
    expect(ghostDuration(ghost)).toBeCloseTo(599 / 60, 4);
    const player = new GhostPlayer(ghost);
    const pose = player.poseAt(100 / 60);
    expect(pose.x).toBeCloseTo(truth[100]!.x, 3);
    expect(pose.y).toBeCloseTo(truth[100]!.y, 3);
    // Halfway between two samples.
    const mid = player.poseAt(100.5 / 60);
    expect(mid.x).toBeCloseTo((truth[100]!.x + truth[101]!.x) / 2, 3);
    // Going back and clamping.
    expect(player.poseAt(0).x).toBeCloseTo(truth[0]!.x, 3);
    expect(player.poseAt(1e9).x).toBeCloseTo(truth[599]!.x, 3);

    const back = decodeGhost(encodeGhost(ghost));
    expect(back.meta).toEqual({ driver: "ai" });
    expect(Array.from(back.frames)).toEqual(Array.from(ghost.frames));

    const lap = sliceGhost(ghost, 2, 4);
    expect(ghostDuration(lap)).toBeCloseTo(2, 1);
    expect(new GhostPlayer(lap).poseAt(0).x).toBeCloseTo(truth[120]!.x, 2);
    w.free();
  });

  it("interpolates yaw across the ±π wrap", () => {
    const frames = new Float32Array([0, 0, 0, 0, 3.1, 0, 0, 0, 0, 1, 0, 0, 0, -3.1, 0, 0, 0, 0]);
    const p = new GhostPlayer({ version: 1, frames });
    const yaw = p.poseAt(0.5).yaw;
    expect(Math.abs(Math.abs(yaw) - Math.PI)).toBeLessThan(1e-3);
  });

  it("samples every n-th step", () => {
    const w = scene();
    const g = new GhostRecorder(w, 0, sp, { every: 4 });
    for (let k = 0; k < 40; k++) {
      w.step(DT);
      g.sample(DT);
    }
    expect(g.length).toBe(10);
    w.free();
  });
});
