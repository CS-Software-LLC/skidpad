/**
 * Skidpad in Babylon.js on Jolt Physics (milestone 7).
 *
 * - The player's car is a Jolt rigid body driven by the Skidpad four-wheel
 *   model through `@skidpad/jolt`; WASD or the arrows drive, Space is the
 *   handbrake.
 * - Traffic: path-following drivers in the core (ADR-0020) lap the track on
 *   the built-in host, and a `LodController` moves them between the full
 *   model, the single-track model and frozen by distance from the camera
 *   (ADR-0019). Colour shows the level: white full, blue single-track,
 *   grey frozen.
 * - Your best lap comes back as a translucent ghost (`@skidpad/replay`,
 *   ADR-0021). Laps are timed at the start line.
 *
 * Babylon is switched to a right-handed, y-up scene, the convention the
 * Jolt adapter uses by default.
 */
import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  MeshBuilder,
  Quaternion,
  Scene,
  StandardMaterial,
  Vector3,
  type Mesh,
} from "@babylonjs/core";
import initJolt from "jolt-physics";
import { init, LodController, type ChannelName, type Lod } from "@skidpad/core";
import { preset } from "@skidpad/presets";
import { KeyboardInput } from "@skidpad/input";
import { createChassisBody, JoltVehicle, Frame } from "@skidpad/jolt";
import { GhostPlayer, GhostRecorder } from "@skidpad/replay";

const DT = 1 / 60;
const TRAFFIC = 24;

// ---- the track: a stadium with a kink, in the core's frame (x, y) --------

function trackPath(): [number, number][] {
  const pts: [number, number][] = [];
  const r = 45;
  const straight = 160;
  const n = 40;
  for (let k = 0; k < n; k++) pts.push([-straight / 2 + (straight * k) / n, -r]);
  for (let k = 0; k < n; k++) {
    const a = -Math.PI / 2 + (Math.PI * k) / n;
    pts.push([straight / 2 + r * Math.cos(a), r * Math.sin(a)]);
  }
  // The back straight has a gentle kink inward.
  for (let k = 0; k < n; k++) {
    const x = straight / 2 - (straight * k) / n;
    pts.push([x, r - 12 * Math.exp(-((x / 30) ** 2))]);
  }
  for (let k = 0; k < n; k++) {
    const a = Math.PI / 2 + (Math.PI * k) / n;
    pts.push([-straight / 2 + r * Math.cos(a), r * Math.sin(a)]);
  }
  return pts;
}

// ---- frame helpers ----------------------------------------------------------

const frame = new Frame("y");
const qCore: [number, number, number, number] = [0, 0, 0, 1];
const qScene: [number, number, number, number] = [0, 0, 0, 1];
const v: [number, number, number] = [0, 0, 0];

/** Place a mesh at a pose given in the core's frame (ISO: x forward, y left, z up). */
function placeCore(
  mesh: Mesh,
  x: number,
  y: number,
  z: number,
  yaw: number,
  pitch: number,
  roll: number,
): void {
  const [cy, sy] = [Math.cos(yaw / 2), Math.sin(yaw / 2)];
  const [cp, sp] = [Math.cos(pitch / 2), Math.sin(pitch / 2)];
  const [cr, sr] = [Math.cos(roll / 2), Math.sin(roll / 2)];
  // q = qz(yaw) · qy(pitch) · qx(roll)
  qCore[0] = cy * cp * sr - sy * sp * cr;
  qCore[1] = cy * sp * cr + sy * cp * sr;
  qCore[2] = sy * cp * cr - cy * sp * sr;
  qCore[3] = cy * cp * cr + sy * sp * sr;
  frame.quatToScene(qCore, qScene);
  frame.vecToScene([x, y, z], v);
  mesh.position.set(v[0], v[1], v[2]);
  mesh.rotationQuaternion ??= new Quaternion();
  mesh.rotationQuaternion.set(qScene[0], qScene[1], qScene[2], qScene[3]);
}

function carMesh(
  scene: Scene,
  name: string,
  length: number,
  width: number,
  color: Color3,
  alpha = 1,
): Mesh {
  const body = MeshBuilder.CreateBox(name, { width: length, height: 0.5, depth: width }, scene);
  const mat = new StandardMaterial(`${name}-mat`, scene);
  mat.diffuseColor = color;
  mat.alpha = alpha;
  body.material = mat;
  const cabin = MeshBuilder.CreateBox(
    `${name}-cabin`,
    { width: length * 0.45, height: 0.4, depth: width * 0.85 },
    scene,
  );
  cabin.parent = body;
  cabin.position.set(-0.1 * length, 0.42, 0);
  cabin.material = mat;
  return body;
}

// ---- main --------------------------------------------------------------------

async function main(): Promise<void> {
  const hud = document.getElementById("hud")!;
  const canvas = document.getElementById("view") as HTMLCanvasElement;
  const [sp, Jolt] = await Promise.all([init(), initJolt()]);

  // Babylon scene.
  const engine = new Engine(canvas, true);
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  scene.clearColor = new Color4(0.06, 0.08, 0.1, 1);
  const camera = new ArcRotateCamera("cam", -Math.PI / 2, 1.15, 14, Vector3.Zero(), scene);
  camera.attachControl(canvas, true);
  camera.lowerRadiusLimit = 6;
  // Chase the car from behind unless the user is orbiting.
  let orbiting = false;
  canvas.addEventListener("pointerdown", () => (orbiting = true));
  window.addEventListener("pointerup", () => (orbiting = false));
  camera.upperRadiusLimit = 400;
  new HemisphericLight("sky", new Vector3(0, 1, 0), scene).intensity = 0.7;
  new DirectionalLight("sun", new Vector3(-0.4, -1, -0.3), scene).intensity = 0.6;
  const ground = MeshBuilder.CreateGround("ground", { width: 600, height: 600 }, scene);
  ground.position.y = -0.01;
  const groundMat = new StandardMaterial("ground-mat", scene);
  groundMat.diffuseColor = new Color3(0.22, 0.3, 0.22);
  ground.material = groundMat;
  const path = trackPath();
  // An asphalt ribbon 14 m wide along the path, and edge posts every 12 m
  // so speed reads on screen.
  const left: Vector3[] = [];
  const right: Vector3[] = [];
  const asphalt = new StandardMaterial("asphalt", scene);
  asphalt.diffuseColor = new Color3(0.16, 0.17, 0.19);
  const postMat = new StandardMaterial("post", scene);
  postMat.diffuseColor = new Color3(0.95, 0.45, 0.1);
  let sincePost = 0;
  for (let k = 0; k <= path.length; k++) {
    const [x, y] = path[k % path.length]!;
    const [nx, ny] = path[(k + 1) % path.length]!;
    const [px, py] = path[(k - 1 + path.length) % path.length]!;
    const len = Math.hypot(nx - px, ny - py);
    // Left normal in the core frame, then to the scene (x, 0, −y).
    const lx = -(ny - py) / len;
    const ly = (nx - px) / len;
    left.push(new Vector3(x + 7 * lx, 0.02, -(y + 7 * ly)));
    right.push(new Vector3(x - 7 * lx, 0.02, -(y - 7 * ly)));
    sincePost += Math.hypot(nx - x, ny - y);
    if (sincePost > 12 && k < path.length) {
      sincePost = 0;
      for (const side of [1, -1]) {
        const post = MeshBuilder.CreateBox("post", { width: 0.3, height: 1, depth: 0.3 }, scene);
        post.position.set(x + side * 8.5 * lx, 0.5, -(y + side * 8.5 * ly));
        post.material = postMat;
      }
    }
  }
  const road = MeshBuilder.CreateRibbon(
    "road",
    { pathArray: [left, right], sideOrientation: 2 },
    scene,
  );
  road.material = asphalt;
  const line = MeshBuilder.CreateBox("start", { width: 0.6, height: 0.03, depth: 14 }, scene);
  line.position.set(path[0]![0], 0.03, -path[0]![1]);
  const lineMat = new StandardMaterial("start-mat", scene);
  lineMat.emissiveColor = new Color3(0.9, 0.9, 0.9);
  line.material = lineMat;

  // Jolt scene: the usual two object layers and a ground box whose top is
  // the plane y = 0, where the built-in host's flat ground also is.
  const STATIC = 0;
  const MOVING = 1;
  const settings = new Jolt.JoltSettings();
  const pairs = new Jolt.ObjectLayerPairFilterTable(2);
  pairs.EnableCollision(STATIC, MOVING);
  pairs.EnableCollision(MOVING, MOVING);
  const bp = new Jolt.BroadPhaseLayerInterfaceTable(2, 2);
  bp.MapObjectToBroadPhaseLayer(STATIC, new Jolt.BroadPhaseLayer(0));
  bp.MapObjectToBroadPhaseLayer(MOVING, new Jolt.BroadPhaseLayer(1));
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
  jolt.GetPhysicsSystem().SetGravity(new Jolt.Vec3(0, -9.80665, 0));
  const groundBody = new Jolt.BodyCreationSettings(
    new Jolt.BoxShape(new Jolt.Vec3(300, 1, 300), 0.05),
    new Jolt.RVec3(0, -1, 0),
    new Jolt.Quat(0, 0, 0, 1),
    Jolt.EMotionType_Static,
    STATIC,
  );
  jolt
    .GetPhysicsSystem()
    .GetBodyInterface()
    .CreateAndAddBody(groundBody, Jolt.EActivation_DontActivate);
  Jolt.destroy(groundBody);

  // Skidpad world: the player first, then the traffic.
  const world = sp.createWorld(1 + TRAFFIC);
  const playerDef = preset("sportsRwd");
  const player = world.addVehicle(playerDef);
  const [sx, sy] = path[0]!;
  const playerBody = createChassisBody(Jolt, jolt, playerDef, {
    objectLayer: MOVING,
    position: [sx - 10, playerDef.chassis.cgHeight, -sy],
  });
  const host = new JoltVehicle(Jolt, jolt, world, player, playerBody);
  const playerMesh = carMesh(scene, "player", 4.3, 1.85, new Color3(0.85, 0.15, 0.12));

  const trafficDef = preset("hatchbackFwd");
  const traffic: { index: number; mesh: Mesh; mat: StandardMaterial }[] = [];
  for (let k = 0; k < TRAFFIC; k++) {
    const i = world.addVehicle(trafficDef);
    // Spread the cars around the lap on two lines.
    const p = path[Math.floor((k * path.length) / TRAFFIC)]!;
    const q = path[(Math.floor((k * path.length) / TRAFFIC) + 1) % path.length]!;
    world.resetVehicle(i, p[0], p[1], Math.atan2(q[1] - p[1], q[0] - p[0]));
    world.setAi(i, path, {
      maxSpeed: 16 + (k % 5) * 2,
      lateralAccel: 5,
      lateralOffset: k % 2 === 0 ? 2.5 : -2.5,
    });
    const mesh = carMesh(scene, `traffic-${k}`, 4, 1.75, new Color3(1, 1, 1));
    traffic.push({ index: i, mesh, mat: mesh.material as StandardMaterial });
  }
  const lod = new LodController(world, {
    singleTrackBeyond: 60,
    frozenBeyond: 260,
    hysteresis: 10,
  });
  lod.pin(player);
  lod.markExternal(player);
  const lodColour: Record<Lod, Color3> = {
    full: new Color3(0.95, 0.95, 0.95),
    singleTrack: new Color3(0.3, 0.55, 0.95),
    frozen: new Color3(0.35, 0.35, 0.35),
  };

  // Ghost of the best lap.
  let recorder = new GhostRecorder(world, player, sp);
  let ghost: GhostPlayer | undefined;
  let best = Number.POSITIVE_INFINITY;
  let lapStart = 0;
  let lastLap = Number.NaN;
  let lastX = sx - 10;
  const ghostMesh = carMesh(scene, "ghost", 4.3, 1.85, new Color3(0.4, 0.9, 1), 0.35);
  ghostMesh.setEnabled(false);

  const keys = new KeyboardInput();
  keys.attach(window);
  let time = 0;
  let accumulator = 0;
  let stepMs = 0;

  engine.runRenderLoop(() => {
    accumulator = Math.min(accumulator + engine.getDeltaTime() / 1000, 0.1);
    while (accumulator >= DT) {
      accumulator -= DT;
      const frameInput = keys.update(DT);
      world.setInput(player, frameInput);
      const t0 = performance.now();
      host.beforeStep();
      world.step(DT);
      host.afterStep(DT);
      jolt.Step(DT, 1);
      stepMs = performance.now() - t0;
      time += DT;
      recorder.sample(DT);

      // Lap timing at the start line (x = start, on the front straight).
      const x = world.read(player, "PosX");
      const y = world.read(player, "PosY");
      if (lastX < sx && x >= sx && Math.abs(y - sy) < 10) {
        const lap = time - lapStart;
        if (lapStart > 0 && lap > 10) {
          lastLap = lap;
          if (lap < best) {
            best = lap;
            ghost = new GhostPlayer(recorder.finish());
            ghostMesh.setEnabled(true);
          }
        }
        lapStart = time;
        recorder = new GhostRecorder(world, player, sp);
      }
      lastX = x;
    }

    // Level of detail by distance from the camera target.
    const cx = camera.target.x;
    const cy = -camera.target.z;
    lod.update((i) => Math.hypot(world.read(i, "PosX") - cx, world.read(i, "PosY") - cy));

    // Draw.
    const pb = playerBody.GetCenterOfMassPosition();
    const pr = playerBody.GetRotation();
    playerMesh.position.set(pb.GetX(), pb.GetY(), pb.GetZ());
    playerMesh.rotationQuaternion ??= new Quaternion();
    playerMesh.rotationQuaternion.set(pr.GetX(), pr.GetY(), pr.GetZ(), pr.GetW());
    camera.target.set(pb.GetX(), pb.GetY(), pb.GetZ());
    if (!orbiting) {
      // Behind the car: alpha = π − yaw in a right-handed y-up scene.
      let d = Math.PI - world.read(player, "Yaw") - camera.alpha;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      camera.alpha += 0.08 * d;
    }
    const counts: Record<Lod, number> = { full: 0, singleTrack: 0, frozen: 0 };
    for (const t of traffic) {
      const tel = (c: ChannelName) => world.read(t.index, c);
      placeCore(
        t.mesh,
        tel("PosX"),
        tel("PosY"),
        tel("PosZ"),
        tel("Yaw"),
        tel("Pitch"),
        tel("Roll"),
      );
      const level = world.lod(t.index);
      counts[level]++;
      t.mat.diffuseColor = lodColour[level];
    }
    if (ghost) {
      const g = ghost.poseAt(time - lapStart);
      placeCore(ghostMesh, g.x, g.y, g.z, g.yaw, g.pitch, g.roll);
    }
    scene.render();

    hud.textContent = [
      `speed  ${(world.read(player, "Speed") * 3.6).toFixed(0).padStart(4)} km/h   gear ${world.read(player, "Gear")}`,
      `lap    ${(time - lapStart).toFixed(2)} s   last ${Number.isFinite(lastLap) ? lastLap.toFixed(2) : "–"}   best ${Number.isFinite(best) ? best.toFixed(2) : "–"}`,
      `traffic full ${counts.full}  single-track ${counts.singleTrack}  frozen ${counts.frozen}`,
      `step   ${stepMs.toFixed(2)} ms (Skidpad + Jolt)`,
      `WASD / arrows drive, Space handbrake, drag to orbit`,
    ].join("\n");
  });
  window.addEventListener("resize", () => engine.resize());
}

main().catch((e: unknown) => {
  const hud = document.getElementById("hud");
  if (hud) hud.textContent = `failed to start: ${String(e)}`;
  throw e;
});
