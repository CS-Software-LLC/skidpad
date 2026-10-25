/**
 * The simulation loop, independent of React and of the renderer. Fixed
 * 60 Hz host steps with an accumulator; the core substeps at 1 kHz inside.
 *
 * Two hosts: the built-in minimal host (flat ground, the core integrates the
 * pose) and a Rapier scene with obstacles, driven through
 * `@skidpad/rapier` (ADR-0002). Two maps: the proving ground (either host)
 * and the circuit (Rapier only: it has real elevation), with lap timing and
 * a ghost of the best lap.
 */
import {
  init,
  validateDefinition,
  type Skidpad,
  type World,
  type VehicleDefinition,
} from "@skidpad/core";
import {
  KeyboardInput,
  GamepadInput,
  WheelInput,
  TouchInput,
  ffbFrameFromTelemetry,
  loadProfiles,
  type FfbSink,
  type InputFrame,
} from "@skidpad/input";
import { TelemetryRecorder } from "@skidpad/telemetry";
import { preset, presetIds, surfaceId, surfaceTable, type PresetId } from "@skidpad/presets";
import { createChassisBody, RapierVehicle } from "@skidpad/rapier";
import type RAPIER from "@dimforge/rapier3d-compat";
import { GhostPlayer, GhostRecorder, ghostQuaternion, type GhostPose } from "@skidpad/replay";
import { OBSTACLES, obstacleQuaternion } from "./track.js";
import { SandboxAudio } from "./audio.js";
import {
  buildCircuit,
  poseAt,
  Projector,
  SHOULDER,
  yawPitchQuat,
  type CircuitGeometry,
  type SpawnPose,
  type SurfaceKind,
} from "./circuit/geometry.js";
import { CIRCUIT } from "./circuit/layout.js";
import { LapTimer, type TimerState } from "./circuit/timing.js";
import { FfbTrace } from "./ffbTrace.js";
import { clearBest, loadBest, saveBest } from "./circuit/store.js";

export const HOST_DT = 1 / 60;

export type HostKind = "builtin" | "rapier";
export const hostKinds: HostKind[] = ["builtin", "rapier"];

export type MapKind = "provingGround" | "circuit";
export const mapKinds: MapKind[] = ["provingGround", "circuit"];

/** What the renderer needs: body pose in three.js terms plus per-wheel state. */
export interface SimSnapshot {
  /** Core-frame position (x forward, y left, z up). */
  x: number;
  y: number;
  z: number;
  /** Orientation as a three.js quaternion (y up). */
  quat: [number, number, number, number];
  yaw: number;
  steer: number;
  speed: number;
  /** Per wheel, FL FR RL RR: road-wheel steer, suspension travel, spin angle, contact flag. */
  wheelSteer: [number, number, number, number];
  wheelTravel: [number, number, number, number];
  wheelSpin: [number, number, number, number];
  wheelContact: [number, number, number, number];
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export function emptySnapshot(): SimSnapshot {
  return {
    x: 0,
    y: 0,
    z: 0,
    quat: [0, 0, 0, 1],
    yaw: 0,
    steer: 0,
    speed: 0,
    wheelSteer: [0, 0, 0, 0],
    wheelTravel: [0, 0, 0, 0],
    wheelSpin: [0, 0, 0, 0],
    wheelContact: [1, 1, 1, 1],
  };
}

// Core (z up) → three.js (y up): q_three = Rx(−90°) · q_core · Rx(+90°).
const H = Math.SQRT1_2;
function mulQ(
  a: readonly number[],
  b: readonly number[],
  out: [number, number, number, number],
): [number, number, number, number] {
  const [ax, ay, az, aw] = a as [number, number, number, number];
  const [bx, by, bz, bw] = b as [number, number, number, number];
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}
const RX_NEG = [-H, 0, 0, H] as const;
const RX_POS = [H, 0, 0, H] as const;
const tmpQ: [number, number, number, number] = [0, 0, 0, 1];
export function coreQuatToThree(
  q: readonly number[],
  out: [number, number, number, number],
): [number, number, number, number] {
  mulQ(RX_NEG, q, tmpQ);
  return mulQ(tmpQ, RX_POS, out);
}

const WHEELS = ["FL", "FR", "RL", "RR"] as const;
const KERB_SURFACE = surfaceId("kerb");
const GRASS_SURFACE = surfaceId("grass");
const GRAVEL_SURFACE = surfaceId("gravel");

/** The circuit's geometry, built once on first use. */
let circuitGeometry: CircuitGeometry | undefined;
export function circuitGeometryOnce(): CircuitGeometry {
  circuitGeometry ??= buildCircuit(CIRCUIT);
  return circuitGeometry;
}

export class Sim {
  sp!: Skidpad;
  world!: World;
  vehicle = 0;
  recorder!: TelemetryRecorder;
  // Slower throttle ramp than the package default: a keyboard tap should not
  // floor a 250 kW car.
  readonly keyboard = new KeyboardInput({ throttle: { riseRate: 1.5, fallRate: 6 } });
  readonly gamepad = new GamepadInput();
  /** Steering wheels and pedals through calibrated profiles (saved ones first). */
  readonly wheel = new WheelInput(
    loadProfiles(globalThis.localStorage).length > 0
      ? { profiles: loadProfiles(globalThis.localStorage) }
      : {},
  );
  /** On-screen controls for touch devices. */
  readonly touch = new TouchInput();
  /** Force-feedback output, when the user connected a device. */
  ffbSink: FfbSink | undefined;
  /** The last ten seconds of force feedback, for the setup panel's graph. */
  readonly ffbTrace = new FfbTrace();
  /** Peak requested rim torque over the last completed lap, N·m. */
  ffbLapPeak: number | undefined;
  /** Which device produced the last frame, for the HUD. */
  inputSource: "touch" | "wheel" | "gamepad" | "keyboard" = "keyboard";
  /** Synthesised engine and tire-slip sound; off until the user enables it. */
  readonly audio = new SandboxAudio();
  presetId: PresetId = "hatchbackFwd";
  hostKind: HostKind = "builtin";
  /** Surface id (index into the preset surface table) of the ground the car drives on. */
  surfaceId = 0;
  /**
   * Speed-sensitive steering for keyboards, as the core's steering assist
   * (ADR-0013): the road-wheel angle is capped so that the lateral
   * acceleration a steady turn would need stays near the tire limit. Set on
   * the definition, so it is deterministic and recorded in replays. Off by
   * default; the assists panel turns it on.
   */
  speedSensitiveSteering = false;
  /** Lateral acceleration the steering limit aims for, m/s². */
  steeringLimitAccel = 9.0;
  definition!: VehicleDefinition;
  private accumulator = 0;
  private last = 0;
  // Poses at the last two sim steps; the renderer interpolates between them
  // by the accumulator fraction so motion is smooth at any display rate.
  private readonly prevPose = emptySnapshot();
  private readonly currPose = emptySnapshot();
  private alpha = 0;
  private detach: (() => void) | undefined;
  stepsThisFrame = 0;
  /** Running mean of wall time per host step, ms (core plus host). */
  stepCostMs = 0;
  // Rapier host.
  private rapier: typeof RAPIER | undefined;
  private scene: RAPIER.World | undefined;
  private body: RAPIER.RigidBody | undefined;
  private host: RapierVehicle | undefined;
  /** Collider handles of the Rapier scene: the ground takes the selected surface, the kerb its own. */
  private groundHandle = -1;
  private readonly kerbHandles = new Set<number>();
  private readonly channel = new Map<string, number>();
  // Circuit.
  mapKind: MapKind = "provingGround";
  /** What each circuit collider is, by handle. */
  private readonly circuitKinds = new Map<number, SurfaceKind>();
  private projector: Projector | undefined;
  private wheelProjector: Projector | undefined;
  timer: LapTimer | undefined;
  private ghostRecorder: GhostRecorder | undefined;
  private ghostPlayer: GhostPlayer | null = null;
  /** Called when the best lap or its ghost changes (a new best, a load, a clear). */
  onBestChanged: (() => void) | undefined;
  /** Show the ghost of the best lap. */
  showGhost = true;
  /** The last tuning field edited, for the divergence notice. */
  lastTuningChange = "";
  /**
   * The core's divergence guard reset the car (its state went NaN or ran
   * away, usually from a tuning value the integrator cannot hold): what to
   * tell the user, and when (`performance.now()`), for the HUD.
   */
  divergence: { text: string; atMs: number } | undefined;
  private divergedSeen = 0;

  async load(): Promise<void> {
    this.sp = await init();
    this.recorder = new TelemetryRecorder({ channels: this.sp.telemetryLayout, capacity: 60 * 60 });
    this.world = this.sp.createWorld(1);
    this.world.setSurfaces(surfaceTable());
    this.setPreset(this.presetId);
    this.detach = this.keyboard.attach(globalThis.window);
  }

  /**
   * Whether the current definition has an engine or motor of its own (the
   * `direct` power unit has none). Tolerates a definition built before the
   * drivetrain existed, which has no `drivetrain` block at all.
   */
  get hasEngine(): boolean {
    return powerUnitKind(this.definition) !== "direct";
  }

  private read(name: string): number {
    let i = this.channel.get(name);
    if (i === undefined) {
      i = this.sp.channel(name);
      this.channel.set(name, i);
    }
    return this.world.telemetryView(this.vehicle)[i] ?? 0;
  }

  /**
   * A preset as the sandbox runs it. Presets leave `assists` at the core
   * defaults; the block is filled in so the panels can toggle each one, and
   * the steering limit is set.
   */
  presetDefinition(id: PresetId): VehicleDefinition {
    const def = this.sp.completeDefinition(preset(id));
    const defaults = this.sp.defaultDefinition().assists;
    const given = (def as { assists?: Partial<typeof defaults> }).assists ?? {};
    def.assists = {
      abs: { ...defaults.abs, ...given.abs },
      tractionControl: { ...defaults.tractionControl, ...given.tractionControl },
      stabilityControl: { ...defaults.stabilityControl, ...given.stabilityControl },
      steeringAssist: {
        ...defaults.steeringAssist,
        enabled: this.speedSensitiveSteering,
        latAccelLimit: this.steeringLimitAccel,
      },
    };
    return def;
  }

  setPreset(id: PresetId): void {
    this.presetId = id;
    this.definition = this.presetDefinition(id);
    this.syncSteeringLock();
    if (this.world.vehicleCount === 0) {
      this.vehicle = this.world.addVehicle(this.definition);
    } else {
      this.world.setDefinition(this.vehicle, this.definition);
      this.world.resetVehicle(this.vehicle, 0, 0, 0);
    }
    this.syncSurface();
    if (this.hostKind === "rapier") this.rebuildRapierBody();
    this.audio.setDefinition(this.definition);
    this.recorder.clear();
    this.syncPoses();
    if (this.mapKind === "circuit") this.enterCircuit();
  }

  /**
   * Live tuning: swap the running car's definition, keeping its state. The
   * definition is validated first and an invalid one is rejected with the
   * validator's messages, leaving the car as it was.
   */
  applyDefinition(def: VehicleDefinition): void {
    const v = validateDefinition(def);
    if (!v.ok) throw new Error(v.errors.join("\n"));
    this.definition = def;
    this.speedSensitiveSteering = def.assists.steeringAssist.enabled;
    this.steeringLimitAccel = def.assists.steeringAssist.latAccelLimit;
    this.syncSteeringLock();
    this.world.setDefinition(this.vehicle, def);
    this.syncSurface();
    if (this.hostKind === "rapier") this.host?.refreshGeometry();
    this.audio.setDefinition(def);
  }

  /** Choose the ground surface by its id in the preset surface table. */
  setSurface(id: number): void {
    this.surfaceId = id;
    this.syncSurface();
  }

  /**
   * Tell the built-in host which surface its flat ground is. The core
   * forgets it when the vehicle model is rebuilt, so this runs after every
   * definition swap too. Under Rapier the wheel rays tag each contact.
   */
  private syncSurface(): void {
    if (this.hostKind === "builtin") this.world.setSurface(this.vehicle, this.surfaceId);
  }

  private syncSteeringLock(): void {
    this.wheel.steeringLockDeg =
      this.definition.steering.ratio * this.definition.steering.maxWheelAngleDeg;
  }

  /**
   * Switch hosts. The Rapier module loads on first use. The circuit needs
   * Rapier, so the built-in host takes the car back to the proving ground.
   */
  async setHost(kind: HostKind): Promise<void> {
    if (kind === this.hostKind) return;
    if (kind === "rapier") {
      if (!this.rapier) {
        const mod = await import("@dimforge/rapier3d-compat");
        await mod.default.init();
        this.rapier = mod.default;
      }
      this.hostKind = kind;
      this.buildScene();
      this.rebuildRapierBody();
    } else {
      if (this.mapKind === "circuit") this.leaveCircuit();
      this.host?.detach();
      this.host = undefined;
      this.body = undefined;
      this.scene?.free();
      this.scene = undefined;
      this.hostKind = kind;
      this.world.resetVehicle(this.vehicle, 0, 0, 0);
      this.syncSurface();
    }
    this.recorder.clear();
    this.syncPoses();
  }

  /** Switch maps. The circuit loads Rapier if it is not the host already. */
  async setMap(kind: MapKind): Promise<void> {
    if (kind === this.mapKind) return;
    if (kind === "circuit") {
      this.mapKind = kind;
      if (this.hostKind !== "rapier") await this.setHost("rapier");
      else this.rebuildRapierScene();
      this.enterCircuit();
    } else {
      this.leaveCircuit();
      this.rebuildRapierScene();
      this.reset();
    }
  }

  /** A new Rapier scene for the current map, with a new chassis body in it. */
  private rebuildRapierScene(): void {
    // The old body and host belong to the scene about to be freed.
    this.host?.detach();
    this.host = undefined;
    this.body = undefined;
    this.buildScene();
    this.rebuildRapierBody();
  }

  private enterCircuit(): void {
    const g = circuitGeometryOnce();
    this.projector = new Projector(g.samples, g.length);
    this.wheelProjector = new Projector(g.samples, g.length);
    this.timer = new LapTimer(g.gates, g.length, HOST_DT);
    // Half rate keeps a stored ghost small; the player interpolates.
    this.ghostRecorder = new GhostRecorder(this.world, this.vehicle, this.sp, { every: 2 });
    this.ghostPlayer = null;
    this.toGrid();
    void this.loadBest();
  }

  private leaveCircuit(): void {
    this.mapKind = "provingGround";
    this.projector = undefined;
    this.wheelProjector = undefined;
    this.timer = undefined;
    this.ghostRecorder = undefined;
    this.ghostPlayer = null;
    this.onBestChanged?.();
  }

  /** The key a preset's best lap is stored under. */
  private get bestKey(): string {
    return `${CIRCUIT.name}.${this.presetId}`;
  }

  private async loadBest(): Promise<void> {
    const key = this.bestKey;
    const stored = await loadBest(key);
    // The preset or map may have changed while the ghost decoded.
    if (key !== this.bestKey || !this.timer) return;
    this.timer.setBest(stored?.lap ?? null);
    this.ghostPlayer = stored?.ghost ? new GhostPlayer(stored.ghost) : null;
    this.onBestChanged?.();
  }

  /** Forget the current preset's best lap and ghost. */
  clearBest(): void {
    clearBest(this.bestKey);
    this.timer?.setBest(null);
    this.ghostPlayer = null;
    this.onBestChanged?.();
  }

  /** Lap timing on the circuit, or undefined elsewhere. */
  get timing(): TimerState | undefined {
    return this.timer?.state;
  }

  /**
   * The ghost's pose at the current lap time, in the core frame, or null
   * when there is none to show. Not for anything deterministic.
   */
  ghostPose(out: GhostPose): GhostPose | null {
    const t = this.timer;
    if (!this.showGhost || !t || !this.ghostPlayer || !t.isRunning) return null;
    // The lap clock between steps: the renderer interpolates the car the same way.
    const lapTime = t.state.lapTime + this.alpha * HOST_DT;
    return this.ghostPlayer.poseAt(lapTime, out);
  }

  /** The ghost pose's orientation as a three.js quaternion. */
  ghostQuat(
    pose: GhostPose,
    out: [number, number, number, number],
  ): [number, number, number, number] {
    return coreQuatToThree(ghostQuaternion(pose), out);
  }

  /** Back to the grid behind the start/finish line; the clock stops until the line. */
  toGrid(): void {
    if (this.mapKind !== "circuit") return;
    this.placeAt(circuitGeometryOnce().grid);
    this.timer?.stop();
    this.projector?.reset();
    this.wheelProjector?.reset();
  }

  /** Put the car on the ground at a pose, at rest. */
  private placeAt(p: SpawnPose): void {
    this.world.resetVehicle(this.vehicle, p.x, -p.z, p.yaw);
    if (this.body) {
      const q = yawPitchQuat(p.yaw, p.pitch);
      // A little above the ground so the wheels settle onto it.
      const lift = this.definition.chassis.cgHeight + 0.1;
      this.body.setTranslation({ x: p.x, y: p.y + lift, z: p.z }, true);
      this.body.setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }, true);
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.body.resetForces(true);
      this.body.resetTorques(true);
    }
    this.audio.setDefinition(this.definition);
    this.recorder.clear();
    this.syncPoses();
  }

  /** Whether every wheel in contact is outside the track's limits (asphalt and kerbs). */
  private allWheelsOff(): boolean {
    const proj = this.wheelProjector!;
    const samples = circuitGeometryOnce().samples;
    const w = this.world.wheelPositionsView(this.vehicle);
    const stride = this.sp.hostOutWheelStride;
    let contact = false;
    for (let i = 0; i < 4; i++) {
      if (this.currPose.wheelContact[i]! < 0.5) continue;
      contact = true;
      // Contact point, core frame → three plan (x, −y).
      const p = proj.project(w[i * stride + 3]!, -w[i * stride + 4]!);
      if (Math.abs(p.lateral) <= samples[p.index]!.width / 2 + SHOULDER) return false;
    }
    return contact;
  }

  /** After each host step on the circuit: the lap clock and the ghost. */
  private stepCircuit(): void {
    const timer = this.timer!;
    const p = this.prevPose;
    const c = this.currPose;
    const s = this.projector!.project(c.x, -c.y).s;
    const r = timer.step(p.x, -p.y, c.x, -c.y, s, this.allWheelsOff());
    const rec = this.ghostRecorder!;
    if (timer.isRunning || r.completed) rec.sample(HOST_DT);
    const scaler = this.ffbSink?.scaler;
    if (r.completed && scaler) {
      this.ffbLapPeak = scaler.peak;
      scaler.peak = 0;
    }
    if (r.completed?.valid && timer.state.best === r.completed) {
      const ghost = rec.finish();
      ghost.meta = { preset: this.presetId, time: r.completed.time };
      this.ghostPlayer = new GhostPlayer(ghost);
      void saveBest(this.bestKey, r.completed, ghost);
      this.onBestChanged?.();
    }
    if (r.started) rec.restart();
  }

  private buildScene(): void {
    const R = this.rapier!;
    this.scene?.free();
    const scene = new R.World({ x: 0, y: -9.80665, z: 0 });
    scene.timestep = HOST_DT;
    const ground = scene.createRigidBody(R.RigidBodyDesc.fixed());
    this.kerbHandles.clear();
    this.circuitKinds.clear();
    if (this.mapKind === "circuit") {
      this.groundHandle = -1;
      const g = circuitGeometryOnce();
      const flags = R.TriMeshFlags.FIX_INTERNAL_EDGES;
      for (const m of g.surfaces) {
        const c = scene.createCollider(
          R.ColliderDesc.trimesh(m.positions, m.indices, flags),
          ground,
        );
        this.circuitKinds.set(c.handle, m.kind);
      }
      const t = scene.createCollider(
        R.ColliderDesc.trimesh(g.terrain.positions, g.terrain.indices, flags),
        ground,
      );
      this.circuitKinds.set(t.handle, "grass");
      for (const b of g.barriers) {
        scene.createCollider(
          R.ColliderDesc.cuboid(b.halfExtents[0], b.halfExtents[1], b.halfExtents[2])
            .setTranslation(b.center[0], b.center[1], b.center[2])
            .setRotation({ x: b.quat[0], y: b.quat[1], z: b.quat[2], w: b.quat[3] }),
          ground,
        );
      }
      scene.step();
      this.scene = scene;
      return;
    }
    this.groundHandle = scene.createCollider(
      R.ColliderDesc.cuboid(2000, 0.5, 2000).setTranslation(0, -0.5, 0),
      ground,
    ).handle;
    for (const o of OBSTACLES) {
      const q = obstacleQuaternion(o);
      const collider = scene.createCollider(
        R.ColliderDesc.cuboid(o.size[0] / 2, o.size[1] / 2, o.size[2] / 2)
          .setTranslation(o.position[0], o.position[1], o.position[2])
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
        ground,
      );
      if (o.label === "kerb") this.kerbHandles.add(collider.handle);
    }
    // Populate the query pipeline so the first wheel rays can hit.
    scene.step();
    this.scene = scene;
  }

  private rebuildRapierBody(): void {
    const R = this.rapier;
    const scene = this.scene;
    if (!R || !scene) return;
    this.host?.detach();
    if (this.body) scene.removeRigidBody(this.body);
    this.body = createChassisBody(R, scene, this.definition, { up: "y" });
    this.host = new RapierVehicle(R, this.world, this.vehicle, this.body, scene, {
      up: "y",
      // On the circuit the wheels touch the ground only: a ray landing on top
      // of a barrier block would lift the wheel 0.8 m in one step. The
      // chassis collider meets the barriers instead.
      filterPredicate: (collider) =>
        this.mapKind !== "circuit" || this.circuitKinds.has(collider.handle),
      // Proving ground: the ground plane is whatever surface the sandbox
      // selected; the kerb obstacle is painted concrete; bumps and the ramp
      // are the reference. Circuit: the asphalt takes the selected surface,
      // the runoff its own; barriers are the reference.
      surfaceId: (collider) => {
        const kind = this.circuitKinds.get(collider.handle);
        if (kind !== undefined) {
          return kind === "asphalt"
            ? this.surfaceId
            : kind === "kerb"
              ? KERB_SURFACE
              : kind === "gravel"
                ? GRAVEL_SURFACE
                : GRASS_SURFACE;
        }
        return collider.handle === this.groundHandle
          ? this.surfaceId
          : this.kerbHandles.has(collider.handle)
            ? KERB_SURFACE
            : 0;
      },
    });
  }

  /**
   * Reset the car. On the circuit it goes back onto the centreline at the
   * nearest point, facing along the lap, and the lap no longer counts.
   */
  reset(): void {
    if (this.mapKind === "circuit" && this.projector) {
      const proj = this.projector.project(this.currPose.x, -this.currPose.y);
      this.placeAt(poseAt(circuitGeometryOnce().samples, proj.index));
      this.timer?.invalidate();
      this.projector.reset();
      this.wheelProjector?.reset();
      return;
    }
    this.world.resetVehicle(this.vehicle, 0, 0, 0);
    if (this.body) {
      this.body.setTranslation({ x: 0, y: this.definition.chassis.cgHeight, z: 0 }, true);
      this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.body.resetForces(true);
      this.body.resetTorques(true);
    }
    this.audio.setDefinition(this.definition);
    this.recorder.clear();
    this.syncPoses();
  }

  private readPose(out: SimSnapshot): void {
    out.x = this.read("PosX");
    out.y = this.read("PosY");
    out.z = this.read("PosZ");
    coreQuatToThree(
      [this.read("QuatX"), this.read("QuatY"), this.read("QuatZ"), this.read("QuatW")],
      out.quat,
    );
    out.yaw = this.read("Yaw");
    out.steer = this.read("SteerAngle");
    out.speed = this.read("Speed");
    WHEELS.forEach((w, i) => {
      out.wheelSteer[i] = this.read(`WheelSteer_${w}`);
      out.wheelTravel[i] = this.read(`SuspTravel_${w}`);
      out.wheelSpin[i] = this.read(`SpinAngle_${w}`);
      out.wheelContact[i] = this.read(`WheelContact_${w}`);
    });
  }

  private syncPoses(): void {
    this.readPose(this.currPose);
    copySnapshot(this.prevPose, this.currPose);
    this.alpha = 0;
  }

  /** Call once per animation frame. */
  frame(nowMs: number): void {
    if (this.last === 0) this.last = nowMs;
    // Clamp: never step backwards, and never try to catch up more than a
    // quarter second after a stall (tab switch, GC pause).
    const dt = Math.max(0, Math.min((nowMs - this.last) / 1000, 0.25));
    this.last = nowMs;
    this.accumulator += dt;
    this.stepsThisFrame = 0;
    while (this.accumulator >= HOST_DT) {
      const frame = this.pollInputs();
      this.world.setInput(this.vehicle, frame);
      copySnapshot(this.prevPose, this.currPose);
      const t0 = performance.now();
      if (this.host && this.scene) {
        this.host.beforeStep();
        this.world.step(HOST_DT);
        this.host.afterStep(HOST_DT);
        this.scene.step();
      } else {
        this.world.step(HOST_DT);
      }
      const cost = performance.now() - t0;
      if (this.read("Diverged") > this.divergedSeen) this.onDiverged();
      this.readPose(this.currPose);
      if (this.timer) this.stepCircuit();
      this.stepCostMs = this.stepCostMs === 0 ? cost : this.stepCostMs * 0.98 + cost * 0.02;
      this.recorder.record(this.world.telemetryView(this.vehicle));
      this.accumulator -= HOST_DT;
      this.stepsThisFrame++;
    }
    if (this.stepsThisFrame > 0 && this.ffbSink?.connected) {
      void this.ffbSink.update(
        ffbFrameFromTelemetry(
          this.readChannel,
          this.definition.steering,
          // The runaway guard watches the hand wheel; only a wheel has one.
          this.wheel.status.wheel ? this.wheel.status.wheelAngleDeg : undefined,
        ),
        this.stepsThisFrame * HOST_DT,
      );
      // The scaler runs before the sink's first await, so it is current.
      if (this.ffbSink.scaler) this.ffbTrace.push(this.ffbSink.scaler, this.readChannel);
    }
    this.alpha = Math.min(1, Math.max(0, this.accumulator / HOST_DT));
    this.audio.update(dt, this.readChannel, this.definition);
  }

  private readonly readChannel = (name: string): number => this.read(name);

  /**
   * The core has put the car back at rest at its last healthy pose. Say so,
   * with what went wrong and the last tuning edit (the usual cause); a
   * Rapier body still carries the bad motion, so reset it too.
   */
  private onDiverged(): void {
    const h = this.world.health(this.vehicle);
    this.divergedSeen = h.recoveries;
    const what = h.cause === "runaway" ? "ran away" : "went non-finite";
    const where = h.channel ? ` (${h.channel} ${what})` : ` (state ${what})`;
    const change = this.lastTuningChange ? ` · last tuning change: ${this.lastTuningChange}` : "";
    this.divergence = {
      text: `Simulation diverged and the car was reset${where}${change}`,
      atMs: performance.now(),
    };
    if (this.body) this.reset();
  }

  /**
   * One frame from the highest-priority active device: touch while a finger
   * is down, a known wheel when one is connected, a gamepad when it is
   * doing something, else the keyboard.
   */
  private pollInputs(): InputFrame {
    const keys = this.keyboard.update(HOST_DT);
    if (this.touch.active) {
      this.inputSource = "touch";
      return this.touch.update(HOST_DT);
    }
    this.touch.update(HOST_DT);
    const wheel = this.wheel.poll();
    if (wheel) {
      this.inputSource = "wheel";
      // The keyboard can still shift and reset alongside a wheel.
      if (keys.gear !== 0 && wheel.gear === 0) wheel.gear = keys.gear;
      return wheel;
    }
    this.gamepad.speed = this.read("Speed");
    const pad = this.gamepad.poll(HOST_DT);
    const padActive =
      pad !== undefined &&
      (pad.steer !== 0 || pad.throttle !== 0 || pad.brake !== 0 || pad.handbrake !== 0);
    if (padActive) {
      this.inputSource = "gamepad";
      return pad;
    }
    this.inputSource = "keyboard";
    return keys;
  }

  /** Route touch pointers on the canvas to the on-screen controls. */
  attachTouch(canvas: HTMLCanvasElement): () => void {
    const pos = (e: PointerEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
    };
    const down = (e: PointerEvent): void => {
      if (e.pointerType !== "touch") return;
      e.preventDefault();
      this.touch.pointerDown(e.pointerId, ...pos(e));
    };
    const move = (e: PointerEvent): void => {
      if (e.pointerType !== "touch") return;
      this.touch.pointerMove(e.pointerId, ...pos(e));
    };
    const up = (e: PointerEvent): void => {
      if (e.pointerType !== "touch") return;
      this.touch.pointerUp(e.pointerId);
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    };
  }

  /** Turn an assist on or off on the running car (live definition swap). */
  setAssist(
    name: "abs" | "tractionControl" | "stabilityControl" | "steeringAssist",
    enabled: boolean,
  ): void {
    const a = this.definition.assists;
    this.definition.assists = { ...a, [name]: { ...a[name], enabled } };
    if (name === "steeringAssist") this.speedSensitiveSteering = enabled;
    this.world.setDefinition(this.vehicle, this.definition);
  }

  /** Render pose, interpolated between the last two sim steps. */
  snapshot(out: SimSnapshot): SimSnapshot {
    const a = this.alpha;
    const p = this.prevPose;
    const c = this.currPose;
    out.x = p.x + (c.x - p.x) * a;
    out.y = p.y + (c.y - p.y) * a;
    out.z = p.z + (c.z - p.z) * a;
    // Normalised lerp of the quaternions; the step-to-step rotation is small.
    let dot = 0;
    for (let i = 0; i < 4; i++) dot += p.quat[i]! * c.quat[i]!;
    const s = dot < 0 ? -1 : 1;
    let n = 0;
    for (let i = 0; i < 4; i++) {
      const v = p.quat[i]! * (1 - a) + s * c.quat[i]! * a;
      out.quat[i] = v;
      n += v * v;
    }
    n = Math.sqrt(n) || 1;
    for (let i = 0; i < 4; i++) out.quat[i] = out.quat[i]! / n;
    out.yaw = p.yaw + wrapAngle(c.yaw - p.yaw) * a;
    out.steer = p.steer + (c.steer - p.steer) * a;
    out.speed = c.speed;
    for (let i = 0; i < 4; i++) {
      out.wheelSteer[i] = p.wheelSteer[i]! + (c.wheelSteer[i]! - p.wheelSteer[i]!) * a;
      out.wheelTravel[i] = p.wheelTravel[i]! + (c.wheelTravel[i]! - p.wheelTravel[i]!) * a;
      out.wheelSpin[i] = p.wheelSpin[i]! + wrapAngle(c.wheelSpin[i]! - p.wheelSpin[i]!) * a;
      out.wheelContact[i] = c.wheelContact[i]!;
    }
    return out;
  }

  dispose(): void {
    this.audio.dispose();
    this.detach?.();
    this.host?.detach();
    this.scene?.free();
    this.world?.free();
  }
}

function copySnapshot(dst: SimSnapshot, src: SimSnapshot): void {
  dst.x = src.x;
  dst.y = src.y;
  dst.z = src.z;
  dst.yaw = src.yaw;
  dst.steer = src.steer;
  dst.speed = src.speed;
  for (let i = 0; i < 4; i++) {
    dst.quat[i] = src.quat[i]!;
    dst.wheelSteer[i] = src.wheelSteer[i]!;
    dst.wheelTravel[i] = src.wheelTravel[i]!;
    dst.wheelSpin[i] = src.wheelSpin[i]!;
    dst.wheelContact[i] = src.wheelContact[i]!;
  }
}

/** The power unit kind of a definition, `"direct"` when it has none. */
export function powerUnitKind(def: VehicleDefinition | undefined): string {
  return def?.drivetrain?.powerUnit?.kind ?? "direct";
}

export { presetIds };
export type { PresetId };
