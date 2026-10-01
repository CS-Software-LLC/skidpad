/**
 * The simulation loop, independent of React and of the renderer. Fixed
 * 60 Hz host steps with an accumulator; the core substeps at 1 kHz inside.
 *
 * Two hosts: the built-in minimal host (flat ground, the core integrates the
 * pose) and a Rapier scene with obstacles, driven through
 * `@skidpad/rapier` (ADR-0002).
 */
import { init, type Skidpad, type World, type VehicleDefinition } from "@skidpad/core";
import { KeyboardInput, GamepadInput } from "@skidpad/input";
import { TelemetryRecorder } from "@skidpad/telemetry";
import { preset, presetIds, type PresetId } from "@skidpad/presets";
import { createChassisBody, RapierVehicle } from "@skidpad/rapier";
import type RAPIER from "@dimforge/rapier3d-compat";
import { OBSTACLES, obstacleQuaternion } from "./track.js";
import { SandboxAudio } from "./audio.js";

export const HOST_DT = 1 / 60;

export type HostKind = "builtin" | "rapier";
export const hostKinds: HostKind[] = ["builtin", "rapier"];

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

export class Sim {
  sp!: Skidpad;
  world!: World;
  vehicle = 0;
  recorder!: TelemetryRecorder;
  // Slower throttle ramp than the package default: a keyboard tap should not
  // floor a 250 kW car.
  readonly keyboard = new KeyboardInput({ throttle: { riseRate: 1.5, fallRate: 6 } });
  readonly gamepad = new GamepadInput();
  /** Synthesised engine and tire-slip sound; off until the user enables it. */
  readonly audio = new SandboxAudio();
  presetId: PresetId = "hatchbackFwd";
  hostKind: HostKind = "builtin";
  /**
   * Sandbox-side speed-sensitive steering for keyboards: the road-wheel angle
   * is capped so that the lateral acceleration a steady turn would need stays
   * near the tire limit (`δ ≈ L · a_lim / v²`). Full lock at walking pace, a
   * few degrees at highway speed. The proper assist moves into the core's
   * assists layer in milestone 5 so it is deterministic and recorded in
   * replays.
   */
  speedSensitiveSteering = true;
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
  private readonly channel = new Map<string, number>();

  async load(): Promise<void> {
    this.sp = await init();
    this.recorder = new TelemetryRecorder({ channels: this.sp.telemetryLayout, capacity: 60 * 60 });
    this.world = this.sp.createWorld(1);
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

  setPreset(id: PresetId): void {
    this.presetId = id;
    this.definition = preset(id);
    if (this.world.vehicleCount === 0) {
      this.vehicle = this.world.addVehicle(this.definition);
    } else {
      this.world.setDefinition(this.vehicle, this.definition);
      this.world.resetVehicle(this.vehicle, 0, 0, 0);
    }
    if (this.hostKind === "rapier") this.rebuildRapierBody();
    this.audio.setDefinition(this.definition);
    this.recorder.clear();
    this.syncPoses();
  }

  /** Switch hosts. The Rapier module loads on first use. */
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
      this.host?.detach();
      this.host = undefined;
      this.body = undefined;
      this.scene?.free();
      this.scene = undefined;
      this.hostKind = kind;
      this.world.resetVehicle(this.vehicle, 0, 0, 0);
    }
    this.recorder.clear();
    this.syncPoses();
  }

  private buildScene(): void {
    const R = this.rapier!;
    this.scene?.free();
    const scene = new R.World({ x: 0, y: -9.80665, z: 0 });
    scene.timestep = HOST_DT;
    const ground = scene.createRigidBody(R.RigidBodyDesc.fixed());
    scene.createCollider(R.ColliderDesc.cuboid(2000, 0.5, 2000).setTranslation(0, -0.5, 0), ground);
    for (const o of OBSTACLES) {
      const q = obstacleQuaternion(o);
      scene.createCollider(
        R.ColliderDesc.cuboid(o.size[0] / 2, o.size[1] / 2, o.size[2] / 2)
          .setTranslation(o.position[0], o.position[1], o.position[2])
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
        ground,
      );
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
    this.host = new RapierVehicle(R, this.world, this.vehicle, this.body, scene, { up: "y" });
  }

  reset(): void {
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
      const pad = this.gamepad.poll();
      const padActive =
        pad !== undefined &&
        (pad.steer !== 0 || pad.throttle !== 0 || pad.brake !== 0 || pad.handbrake !== 0);
      const keys = this.keyboard.update(HOST_DT);
      const frame = padActive ? pad : keys;
      if (this.speedSensitiveSteering) {
        const speed = this.read("Speed");
        const maxLock = (this.definition.steering.maxWheelAngleDeg * Math.PI) / 180;
        const limit =
          (this.definition.chassis.wheelbase * this.steeringLimitAccel) /
          Math.max(speed * speed, 1e-3);
        frame.steer *= Math.min(1, limit / maxLock);
      }
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
      this.readPose(this.currPose);
      this.stepCostMs = this.stepCostMs === 0 ? cost : this.stepCostMs * 0.98 + cost * 0.02;
      this.recorder.record(this.world.telemetryView(this.vehicle));
      this.accumulator -= HOST_DT;
      this.stepsThisFrame++;
    }
    this.alpha = Math.min(1, Math.max(0, this.accumulator / HOST_DT));
    this.audio.update(dt, this.readChannel, this.definition);
  }

  private readonly readChannel = (name: string): number => this.read(name);

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
