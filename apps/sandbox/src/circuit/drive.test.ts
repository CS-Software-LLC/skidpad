/**
 * Driving the circuit: a path-following driver takes the sports car round
 * the corners on the circuit's own Rapier trimesh and on flat ground under
 * the same plan. The wheels should feel the circuit's elevation and banking,
 * not its triangles: a fold in the mesh every sample shook the tire loads,
 * and through them the lateral acceleration and steering torque, in every
 * corner.
 */
import { beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { init, type Skidpad } from "@skidpad/core";
import { preset } from "@skidpad/presets";
import { createChassisBody, RapierVehicle } from "@skidpad/rapier";
import { buildCircuit, yawPitchQuat, type CircuitGeometry } from "./geometry.js";
import { CIRCUIT } from "./layout.js";

const DT = 1 / 60;
const SECONDS = 70;
const CHANNELS = ["LatAccel", "SteeringTorque", "TireLoad_FL"] as const;

let sp: Skidpad;
let g: CircuitGeometry;
beforeAll(async () => {
  sp = await init();
  await RAPIER.init();
  g = buildCircuit(CIRCUIT);
});

type Trace = Record<(typeof CHANNELS)[number], number[]>;

/** Drive from the grid with the core's path follower; the circuit's mesh, or a flat plane under the same plan. */
function drive(ground: "circuit" | "flat"): Trace {
  const scene = new RAPIER.World({ x: 0, y: -9.80665, z: 0 });
  scene.timestep = DT;
  const fixed = scene.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  if (ground === "circuit") {
    for (const m of g.surfaces) {
      scene.createCollider(
        RAPIER.ColliderDesc.trimesh(m.positions, m.indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES),
        fixed,
      );
    }
  } else {
    scene.createCollider(
      RAPIER.ColliderDesc.cuboid(2000, 0.5, 2000).setTranslation(0, -0.5, 0),
      fixed,
    );
  }
  scene.step();

  const world = sp.createWorld(1);
  const def = preset("sportsRwd");
  const car = world.addVehicle(def);
  const p = g.grid;
  const y = ground === "circuit" ? p.y : 0;
  world.resetVehicle(car, p.x, -p.z, p.yaw);
  const body = createChassisBody(RAPIER, scene, def, { up: "y" });
  const q = yawPitchQuat(p.yaw, ground === "circuit" ? p.pitch : 0);
  body.setTranslation({ x: p.x, y: y + def.chassis.cgHeight + 0.1, z: p.z }, true);
  body.setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }, true);
  const host = new RapierVehicle(RAPIER, world, car, body, scene, { up: "y" });
  // Core plan coordinates: three (x, z) → core (x, −z).
  world.setAi(
    car,
    g.samples.map((s) => [s.x, -s.z] as const),
    { maxSpeed: 30 },
  );

  const trace: Trace = { LatAccel: [], SteeringTorque: [], TireLoad_FL: [] };
  for (let k = 0; k < SECONDS / DT; k++) {
    host.step(DT);
    scene.step();
    for (const c of CHANNELS) trace[c].push(world.read(car, c));
  }
  host.detach();
  world.free();
  scene.free();
  return trace;
}

/**
 * RMS of the frame-to-frame second difference over the frames where the car
 * is cornering: zero for a steady or steadily changing value, large for a
 * value that shakes from one frame to the next.
 */
function roughness(trace: Trace, channel: (typeof CHANNELS)[number]): number {
  const v = trace[channel];
  const lat = trace.LatAccel;
  let sum = 0;
  let n = 0;
  for (let k = 1; k < v.length - 1; k++) {
    if (Math.abs(lat[k]!) < 3) continue;
    const d2 = v[k + 1]! - 2 * v[k]! + v[k - 1]!;
    sum += d2 * d2;
    n++;
  }
  expect(n, "frames spent cornering").toBeGreaterThan(5 / DT);
  return Math.sqrt(sum / n);
}

describe("driving the circuit's corners", () => {
  it("is as smooth as the same corners on flat ground", () => {
    const flat = drive("flat");
    const circuit = drive("circuit");
    const ratio = (c: (typeof CHANNELS)[number]) => roughness(circuit, c) / roughness(flat, c);
    // A full-width quad per sample made these about 5x the flat ground's.
    expect(ratio("LatAccel")).toBeLessThan(1.5);
    expect(ratio("SteeringTorque")).toBeLessThan(1.5);
    // The load also follows the circuit's real crests, dips and kerbs; the
    // folds made it about 40x the flat ground's, and about 5x is left.
    expect(ratio("TireLoad_FL")).toBeLessThan(10);
  }, 120_000);
});
