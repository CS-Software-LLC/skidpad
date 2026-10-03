import { describe, expect, it, beforeAll } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { init, type Skidpad } from "@skidpad/core";
import { preset } from "@skidpad/presets";
import { createChassisBody, RapierVehicle, surfaceIdsByHandle, type UpAxis } from "../src/index.js";

let sp: Skidpad;
beforeAll(async () => {
  sp = await init();
  await RAPIER.init();
});

function groundScene(up: UpAxis): RAPIER.World {
  const g = 9.80665;
  const scene = new RAPIER.World(up === "y" ? { x: 0, y: -g, z: 0 } : { x: 0, y: 0, z: -g });
  scene.timestep = 1 / 60;
  const ground = scene.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const desc =
    up === "y"
      ? RAPIER.ColliderDesc.cuboid(200, 0.5, 200).setTranslation(0, -0.5, 0)
      : RAPIER.ColliderDesc.cuboid(200, 200, 0.5).setTranslation(0, 0, -0.5);
  scene.createCollider(desc, ground);
  // Populate the query pipeline so the first wheel rays can hit.
  scene.step();
  return scene;
}

function heightOf(body: RAPIER.RigidBody, up: UpAxis): number {
  const t = body.translation();
  return up === "y" ? t.y : t.z;
}

describe.each<UpAxis>(["y", "z"])("Rapier host with %s up", (up) => {
  it("rests at ride height and drives straight", () => {
    const scene = groundScene(up);
    const world = sp.createWorld(1);
    const def = preset("sportsRwd");
    const car = world.addVehicle(def);
    const body = createChassisBody(RAPIER, scene, def, { up });
    const host = new RapierVehicle(RAPIER, world, car, body, scene, { up });

    for (let k = 0; k < 120; k++) {
      host.step(1 / 60);
      scene.step();
    }
    expect(heightOf(body, up)).toBeCloseTo(def.chassis.cgHeight, 2);
    expect(world.read(car, "WheelContact_FL")).toBe(1);
    expect(world.read(car, "WheelContact_RR")).toBe(1);
    const loads = ["FL", "FR", "RL", "RR"].map((s) => world.read(car, `TireLoad_${s}`));
    expect(loads.reduce((a, b) => a + b, 0)).toBeCloseTo(def.chassis.mass * 9.80665, -1);

    world.setInput(car, { throttle: 1 });
    for (let k = 0; k < 240; k++) {
      host.step(1 / 60);
      scene.step();
    }
    const t = body.translation();
    expect(t.x).toBeGreaterThan(10);
    expect(Math.abs(up === "y" ? t.z : t.y)).toBeLessThan(0.05);
    expect(heightOf(body, up)).toBeCloseTo(def.chassis.cgHeight, 1);
    expect(world.read(car, "Speed")).toBeGreaterThan(8);
    // The core's proxy pose tracks the Rapier body.
    expect(world.read(car, "PosX")).toBeCloseTo(t.x, 1);

    // Steer: the body yaws about the up axis and moves to its right (−y core).
    world.setInput(car, { throttle: 0.3, steer: 0.4 });
    for (let k = 0; k < 180; k++) {
      host.step(1 / 60);
      scene.step();
    }
    const t2 = body.translation();
    const sideways = up === "y" ? t2.z : -t2.y; // core −y is scene +z (y up) or −y (z up)
    expect(sideways).toBeGreaterThan(1);
    expect(world.read(car, "YawRate")).toBeLessThan(-0.1);
    expect(world.read(car, "Roll")).toBeLessThan(-0.003);

    host.detach();
    world.free();
  });
});

describe("Rapier host", () => {
  it("drops onto the ground and settles", () => {
    const up: UpAxis = "y";
    const scene = groundScene(up);
    const world = sp.createWorld(1);
    const def = preset("hatchbackFwd");
    const car = world.addVehicle(def);
    const body = createChassisBody(RAPIER, scene, def, {
      up,
      position: [0, def.chassis.cgHeight + 0.3, 0],
    });
    const host = new RapierVehicle(RAPIER, world, car, body, scene, { up });
    let airborne = 0;
    for (let k = 0; k < 240; k++) {
      host.step(1 / 60);
      scene.step();
      if (world.read(car, "WheelContact_FL") === 0) airborne++;
    }
    expect(airborne).toBeGreaterThan(5);
    expect(heightOf(body, up)).toBeCloseTo(def.chassis.cgHeight, 2);
    const v = body.linvel();
    expect(Math.hypot(v.x, v.y, v.z)).toBeLessThan(0.02);
    world.free();
  });

  it("rides a moving platform", () => {
    const up: UpAxis = "y";
    const scene = groundScene(up);
    const world = sp.createWorld(1);
    const def = preset("hatchbackFwd");
    const car = world.addVehicle(def);
    // A kinematic slab moving along +x under the car.
    const slab = scene.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicVelocityBased().setTranslation(0, 0.5, 0).setLinvel(2, 0, 0),
    );
    scene.createCollider(RAPIER.ColliderDesc.cuboid(100, 0.5, 100), slab);
    const body = createChassisBody(RAPIER, scene, def, {
      up,
      position: [0, 1 + def.chassis.cgHeight, 0],
    });
    const host = new RapierVehicle(RAPIER, world, car, body, scene, { up });
    world.setInput(car, { brake: 1 });
    for (let k = 0; k < 240; k++) {
      host.step(1 / 60);
      scene.step();
    }
    expect(body.linvel().x).toBeCloseTo(2, 1);
    expect(body.translation().x).toBeGreaterThan(5);
    world.free();
  });
});

describe("Rapier builds and definitions", () => {
  it("drives the deterministic build without a cast", async () => {
    const DET = (await import("@dimforge/rapier3d-deterministic-compat")).default;
    await DET.init();
    const scene = new DET.World({ x: 0, y: -9.80665, z: 0 });
    scene.timestep = 1 / 60;
    const ground = scene.createRigidBody(DET.RigidBodyDesc.fixed());
    const asphalt = scene.createCollider(
      DET.ColliderDesc.cuboid(10, 0.5, 200).setTranslation(-10, -0.5, 0),
      ground,
    );
    const ice = scene.createCollider(
      DET.ColliderDesc.cuboid(10, 0.5, 200).setTranslation(10, -0.5, 0),
      ground,
    );
    scene.step();
    const world = sp.createWorld(1);
    world.setSurfaces([{}, { grip: 0.2 }]);
    const def = preset("hatchbackFwd");
    const car = world.addVehicle(def);
    const body = createChassisBody(DET, scene, def);
    const ids = new Map([
      [asphalt.handle, 0],
      [ice.handle, 1],
    ]);
    const host = new RapierVehicle(DET, world, car, body, scene, {
      surfaceId: surfaceIdsByHandle(ids),
    });
    for (let k = 0; k < 60; k++) {
      host.step(1 / 60);
      scene.step();
    }
    // The car straddles the seam at x = 0: front wheels on the ice, rear
    // ones on the asphalt.
    expect(world.read(car, "WheelContact_FL")).toBe(1);
    expect(world.read(car, "SurfaceId_FL")).toBe(1);
    expect(world.read(car, "SurfaceId_FR")).toBe(1);
    expect(world.read(car, "SurfaceId_RL")).toBe(0);
    expect(world.read(car, "SurfaceId_RR")).toBe(0);
    expect(body.translation().y).toBeCloseTo(def.chassis!.cgHeight!, 1);
  });

  it("asks for a completed definition when the chassis is not sized", () => {
    const scene = groundScene("y");
    expect(() => createChassisBody(RAPIER, scene, { name: "bare" })).toThrow(/completeDefinition/);
    const full = sp.completeDefinition({ name: "bare" });
    const body = createChassisBody(RAPIER, scene, full);
    scene.step();
    expect(body.mass()).toBeCloseTo(full.chassis.mass, 6);
  });
});
