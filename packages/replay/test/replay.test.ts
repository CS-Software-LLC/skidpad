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
  sliceGhostFrames,
  ghostDuration,
  ghostQuaternion,
  gzip,
  gunzip,
  type Replay,
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

describe("replays of game logic", () => {
  /** The car weaves across a road whose verge is gravel, wheel by wheel. */
  function onTrack(w: World, car = 0): void {
    const y = w.read(car, "PosY");
    // Left wheels on gravel when the car is far enough left.
    const left = y > 1.5 ? 1 : 0;
    w.setWheelSurface(car, "FL", left);
    w.setWheelSurface(car, "RL", left);
  }

  function record(recordSurfaces: boolean): { replay: Replay; hash: string; world: World } {
    const w = sp.createWorld(1);
    w.addVehicle(defs[0]!);
    w.setSurfaces([{}, { grip: 0.5, rollingResistance: 3, drag: 0.05 }]);
    const rec = new ReplayRecorder(w, sp, {
      keyframeEvery: 200,
      definitions: [defs[0]!],
      recordSurfaces,
    });
    for (let k = 0; k < 900; k++) {
      w.setInput(0, { throttle: 0.6, steer: Math.sin(k / 40) * 0.4 });
      onTrack(w);
      rec.step(DT);
    }
    return { replay: rec.finish(), hash: w.worldHash(), world: w };
  }

  it("replay per-wheel surface changes without help", () => {
    const { replay, hash, world } = record(true);
    expect(replay.version).toBe(2);
    expect(replay.simulationVersion).toBe(sp.simulationVersion);
    expect(replay.coreVersion).toBe(sp.version);
    // The car did put two wheels on the gravel.
    expect(replay.surfaces!.some((id) => id === 1)).toBe(true);
    for (const r of [replay, decodeReplay(encodeReplay(replay))]) {
      const pw = createReplayWorld(sp, r);
      pw.setSurfaces([{}, { grip: 0.5, rollingResistance: 3, drag: 0.05 }]);
      const player = new ReplayPlayer(pw, r);
      player.advance(900);
      expect(player.desyncs).toBe(0);
      expect(pw.worldHash()).toBe(hash);
      // A backward seek keeps the world hash meaningful.
      player.seek(450);
      player.seek(900);
      expect(pw.worldHash()).toBe(hash);
      pw.free();
    }
    // Without the surfaces the stock player can only re-sync.
    const blind = record(false);
    const pw = createReplayWorld(sp, blind.replay);
    pw.setSurfaces([{}, { grip: 0.5, rollingResistance: 3, drag: 0.05 }]);
    const player = new ReplayPlayer(pw, blind.replay);
    player.advance(900);
    expect(player.desyncs).toBeGreaterThan(0);
    pw.free();
    world.free();
    blind.world.free();
  });

  it("follow host logic and application state through beforeStep and onRestore", () => {
    // The game tilts the ground as the car passes marks and counts them.
    const w = sp.createWorld(1);
    w.addVehicle(defs[1]!);
    const game = { marks: 0 };
    const logic = (world: World, state: { marks: number }) => {
      const x = world.read(0, "PosX");
      if (x > 10 * (state.marks + 1)) state.marks++;
      world.setGroundSlope(0, state.marks % 2 === 0 ? 0 : 0.08);
    };
    const rec = new ReplayRecorder(w, sp, {
      keyframeEvery: 150,
      definitions: [defs[1]!],
      keyframeState: () => ({ ...game }),
    });
    const marks: number[] = [];
    for (let k = 0; k < 900; k++) {
      w.setInput(0, { throttle: 0.7 });
      logic(w, game);
      rec.step(DT);
      marks.push(game.marks);
    }
    expect(game.marks).toBeGreaterThan(3);
    const replay = decodeReplay(encodeReplay(rec.finish()));
    expect(replay.keyframes[2]!.state).toEqual({ marks: marks[299] });

    const pw = createReplayWorld(sp, replay);
    const played = { marks: 0 };
    const restored: number[] = [];
    const player = new ReplayPlayer(pw, replay, {
      beforeStep: (_step, world) => logic(world, played),
      onRestore: (step, state) => {
        restored.push(step);
        Object.assign(played, state as { marks: number });
      },
    });
    player.advance(900);
    expect(player.desyncs).toBe(0);
    expect(pw.worldHash()).toBe(w.worldHash());
    expect(played.marks).toBe(game.marks);
    // Seeking back restores the game's state with the cars.
    player.seek(320);
    expect(restored.at(-1)).toBe(300);
    expect(played.marks).toBe(marks[319]);
    player.seek(900);
    expect(pw.worldHash()).toBe(w.worldHash());
    pw.free();
    w.free();
  });

  it("store rarely changing data as runs, and gzip", async () => {
    const { replay, world } = record(true);
    const bytes = encodeReplay(replay);
    const keyframes = replay.keyframes.reduce(
      (n, k) => n + k.snapshots.reduce((m, s) => m + s.byteLength, 0),
      0,
    );
    const defsJson = JSON.stringify(replay.definitions).length;
    // 48 bytes of inputs per step; the rest is runs, keyframes and the header.
    expect(bytes.byteLength).toBeLessThan(900 * 48 + keyframes + defsJson + 3_000);
    const packed = await gzip(bytes);
    expect(packed.byteLength).toBeLessThan(bytes.byteLength / 3);
    expect(Array.from(await gunzip(packed))).toEqual(Array.from(bytes));
    world.free();
  });

  it("still play a version 1 replay", () => {
    const w = scene();
    const rec = new ReplayRecorder(w, sp.version, { definitions: defs, keyframeEvery: 100 });
    for (let k = 0; k < 300; k++) {
      drive(w, k);
      rec.step(DT);
    }
    const current = rec.finish();
    expect(current.simulationVersion).toBeUndefined();
    const v1: Replay = { ...current, version: 1 };
    delete v1.surfaces;
    delete v1.startStep;
    const back = decodeReplay(encodeReplay(v1));
    expect(back.version).toBe(1);
    expect(back.surfaces).toBeUndefined();
    const pw = createReplayWorld(sp, back);
    const player = new ReplayPlayer(pw, back);
    player.advance(300);
    expect(player.desyncs).toBe(0);
    expect(pw.stateHash(0)).toBe(w.stateHash(0));
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

  it("restart on a lap line with the crossing pose at time zero", () => {
    const w = scene();
    const g = new GhostRecorder(w, 1, sp);
    for (let k = 0; k < 100; k++) {
      w.step(DT);
      g.sample(DT);
    }
    const x0 = w.read(1, "PosX");
    g.restart({ lap: 2 });
    expect(g.length).toBe(1);
    const truth: number[] = [];
    for (let k = 0; k < 60; k++) {
      w.step(DT);
      g.sample(DT);
      truth.push(w.read(1, "PosX"));
    }
    const lap = g.finish();
    expect(lap.meta).toEqual({ lap: 2 });
    const p = new GhostPlayer(lap);
    expect(p.poseAt(0).x).toBeCloseTo(x0, 3);
    // Ghost time t is t / dt steps after the restart.
    expect(p.poseAt(30 * DT).x).toBeCloseTo(truth[29]!, 3);
    expect(ghostDuration(lap)).toBeCloseTo(60 * DT, 5);
    w.free();
  });

  it("slice by time without losing boundary frames, or by frame", () => {
    const n = 200;
    const frames = new Float32Array(n * 9);
    let t = 0;
    for (let k = 0; k < n; k++) {
      frames[k * 9] = t;
      frames[k * 9 + 1] = k;
      t += DT;
    }
    const g = { version: 1, frames };
    // Bounds computed in float64 the way the frame times were.
    let from = 0;
    for (let k = 0; k < 37; k++) from += DT;
    let to = from;
    for (let k = 0; k < 50; k++) to += DT;
    const lap = sliceGhost(g, from, to);
    expect(lap.frames.length / 9).toBe(51);
    expect(lap.frames[1]).toBe(37);
    expect(lap.frames[0]).toBe(0);
    const byFrame = sliceGhostFrames(g, 37, 88);
    expect(Array.from(byFrame.frames)).toEqual(Array.from(lap.frames));
    expect(sliceGhostFrames(g, 190, 500).frames.length / 9).toBe(10);
  });

  it("turn a pose into the core's quaternion", () => {
    const w = scene();
    for (let k = 0; k < 400; k++) {
      drive(w, k);
      w.step(DT);
    }
    const r = w.readAll(0);
    const q = ghostQuaternion({ yaw: r.Yaw!, pitch: r.Pitch!, roll: r.Roll! });
    const sign = Math.sign(q[3]) === Math.sign(r.QuatW!) ? 1 : -1;
    expect(sign * q[0]).toBeCloseTo(r.QuatX!, 9);
    expect(sign * q[1]).toBeCloseTo(r.QuatY!, 9);
    expect(sign * q[2]).toBeCloseTo(r.QuatZ!, 9);
    expect(sign * q[3]).toBeCloseTo(r.QuatW!, 9);
    w.free();
  });
});
