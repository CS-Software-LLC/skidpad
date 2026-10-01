import { describe, expect, it, beforeAll } from "vitest";
import initJolt from "jolt-physics";
import { init, type Skidpad } from "@skidpad/core";
import { preset } from "@skidpad/presets";
import { createChassisBody, JoltVehicle, type JoltModule, type UpAxis } from "../src/index.js";

let sp: Skidpad;
let Jolt: JoltModule;
beforeAll(async () => {
  sp = await init();
  Jolt = await initJolt();
});

const STATIC = 0;
const MOVING = 1;

/** A Jolt scene with the two-layer setup of Jolt's own examples and a ground box. */
function groundScene(up: UpAxis, slope = 0) {
  const settings = new Jolt.JoltSettings();
  const pairs = new Jolt.ObjectLayerPairFilterTable(2);
  pairs.EnableCollision(STATIC, MOVING);
  pairs.EnableCollision(MOVING, MOVING);
  const bpStatic = new Jolt.BroadPhaseLayer(0);
  const bpMoving = new Jolt.BroadPhaseLayer(1);
  const bp = new Jolt.BroadPhaseLayerInterfaceTable(2, 2);
  bp.MapObjectToBroadPhaseLayer(STATIC, bpStatic);
  bp.MapObjectToBroadPhaseLayer(MOVING, bpMoving);
  settings.mObjectLayerPairFilter = pairs;
  settings.mBroadPhaseLayerInterface = bp;
  settings.mObjectVsBroadPhaseLayerFilter = new Jolt.ObjectVsBroadPhaseLayerFilterTable(
    bp,
    2,
    pairs,
    2,
  );
  const jolt = new Jolt.JoltInterface(settings);
  Jolt.destroy(settings);
  const g = 9.80665;
  const system = jolt.GetPhysicsSystem();
  system.SetGravity(up === "y" ? new Jolt.Vec3(0, -g, 0) : new Jolt.Vec3(0, 0, -g));
  const bodies = system.GetBodyInterface();
  const half = up === "y" ? new Jolt.Vec3(200, 0.5, 200) : new Jolt.Vec3(200, 200, 0.5);
  const at = up === "y" ? new Jolt.RVec3(0, -0.5, 0) : new Jolt.RVec3(0, 0, -0.5);
  // A grade along +x: rotate the ground about the horizontal axis across it.
  const angle = Math.atan(slope);
  const axis = up === "y" ? new Jolt.Vec3(0, 0, 1) : new Jolt.Vec3(0, -1, 0);
  const rot = Jolt.Quat.prototype.sRotation(axis, angle);
  const ground = new Jolt.BodyCreationSettings(
    new Jolt.BoxShape(half, 0.05),
    at,
    rot,
    Jolt.EMotionType_Static,
    STATIC,
  );
  ground.mFriction = 1;
  bodies.CreateAndAddBody(ground, Jolt.EActivation_DontActivate);
  Jolt.destroy(ground);
  return jolt;
}

function position(body: ReturnType<typeof createChassisBody>, up: UpAxis) {
  const p = body.GetCenterOfMassPosition();
  // In the core's frame: x forward, y left, z up.
  return up === "y"
    ? { x: p.GetX(), y: -p.GetZ(), z: p.GetY() }
    : { x: p.GetX(), y: p.GetY(), z: p.GetZ() };
}

describe.each<UpAxis>(["y", "z"])("Jolt host with %s up", (up) => {
  it("rests at ride height, drives straight and turns", () => {
    const jolt = groundScene(up);
    const world = sp.createWorld(1);
    const def = preset("sportsRwd");
    const car = world.addVehicle(def);
    const body = createChassisBody(Jolt, jolt, def, { up, objectLayer: MOVING });
    const host = new JoltVehicle(Jolt, jolt, world, car, body, { up });
    const dt = 1 / 60;
    const tick = () => {
      host.step(dt);
      jolt.Step(dt, 1);
    };

    for (let k = 0; k < 120; k++) tick();
    expect(position(body, up).z).toBeCloseTo(def.chassis.cgHeight, 2);
    expect(world.read(car, "WheelContact_FL")).toBe(1);
    expect(world.read(car, "WheelContact_RR")).toBe(1);
    const loads = ["FL", "FR", "RL", "RR"].map((s) => world.read(car, `TireLoad_${s}`));
    expect(loads.reduce((a, b) => a + b, 0)).toBeCloseTo(def.chassis.mass * 9.80665, -1);

    world.setInput(car, { throttle: 0.6 });
    for (let k = 0; k < 240; k++) tick();
    const p = position(body, up);
    expect(p.x).toBeGreaterThan(10);
    expect(Math.abs(p.y)).toBeLessThan(0.05);
    expect(p.z).toBeCloseTo(def.chassis.cgHeight, 1);
    expect(world.read(car, "Speed")).toBeGreaterThan(8);
    expect(world.read(car, "PosX")).toBeCloseTo(p.x, 1);

    // Steer right: the body yaws clockwise and moves to −y.
    world.setInput(car, { throttle: 0.3, steer: 0.4 });
    for (let k = 0; k < 180; k++) tick();
    expect(position(body, up).y).toBeLessThan(-1);
    expect(world.read(car, "YawRate")).toBeLessThan(-0.1);
    expect(world.read(car, "Roll")).toBeLessThan(-0.003);

    host.detach();
    host.dispose();
    world.free();
  });
});

describe("Jolt host on a slope", () => {
  it("holds a car on a 10 % grade with the brakes", () => {
    const jolt = groundScene("y", 0.1);
    const world = sp.createWorld(1);
    const def = preset("hatchbackFwd");
    const car = world.addVehicle(def);
    // Start on the slope at ride height, nose uphill.
    const angle = Math.atan(0.1);
    const qz = Math.sin(angle / 2);
    const body = createChassisBody(Jolt, jolt, def, {
      objectLayer: MOVING,
      position: [0, def.chassis.cgHeight / Math.cos(angle), 0],
    });
    const rot = new Jolt.Quat(0, 0, qz, Math.cos(angle / 2));
    jolt
      .GetPhysicsSystem()
      .GetBodyInterface()
      .SetRotation(body.GetID(), rot, Jolt.EActivation_Activate);
    const host = new JoltVehicle(Jolt, jolt, world, car, body);
    world.setInput(car, { handbrake: 1, brake: 1 });
    for (let k = 0; k < 180; k++) {
      host.step(1 / 60);
      jolt.Step(1 / 60, 1);
    }
    const start = body.GetCenterOfMassPosition().GetX();
    for (let k = 0; k < 120; k++) {
      host.step(1 / 60);
      jolt.Step(1 / 60, 1);
    }
    const creep = Math.abs(body.GetCenterOfMassPosition().GetX() - start);
    expect(creep).toBeLessThan(0.01);
    expect(world.read(car, "Speed")).toBeLessThan(0.01);
    host.dispose();
    world.free();
  });
});
