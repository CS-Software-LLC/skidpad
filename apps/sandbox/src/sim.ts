/**
 * The simulation loop, independent of React and of the renderer. Fixed
 * 60 Hz host steps with an accumulator; the core substeps at 1 kHz inside.
 */
import { init, type Skidpad, type World, type VehicleDefinition } from "@skidpad/core";
import { KeyboardInput, GamepadInput } from "@skidpad/input";
import { TelemetryRecorder } from "@skidpad/telemetry";
import { preset, presetIds, type PresetId } from "@skidpad/presets";

export const HOST_DT = 1 / 60;

export interface SimSnapshot {
  x: number;
  y: number;
  yaw: number;
  steer: number;
  speed: number;
  wheelF: number;
  wheelR: number;
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function emptySnapshot(): SimSnapshot {
  return { x: 0, y: 0, yaw: 0, steer: 0, speed: 0, wheelF: 0, wheelR: 0 };
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
  presetId: PresetId = "hatchbackFwd";
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
  // by the accumulator fraction so motion is smooth at any display rate
  // (60 Hz sim on a 120 Hz screen would otherwise move every other frame).
  private readonly prevPose = emptySnapshot();
  private readonly currPose = emptySnapshot();
  private alpha = 0;
  private detach: (() => void) | undefined;
  stepsThisFrame = 0;
  /** Running mean of wall time per host step, ms. */
  stepCostMs = 0;

  async load(): Promise<void> {
    this.sp = await init();
    this.recorder = new TelemetryRecorder({ channels: this.sp.telemetryLayout, capacity: 60 * 60 });
    this.world = this.sp.createWorld(1);
    this.setPreset(this.presetId);
    this.detach = this.keyboard.attach(globalThis.window);
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
    this.recorder.clear();
    this.syncPoses();
  }

  reset(): void {
    this.world.resetVehicle(this.vehicle, 0, 0, 0);
    this.recorder.clear();
    this.syncPoses();
  }

  private readPose(out: SimSnapshot): void {
    const w = this.world;
    out.x = w.read(this.vehicle, "PosX");
    out.y = w.read(this.vehicle, "PosY");
    out.yaw = w.read(this.vehicle, "Yaw");
    out.steer = w.read(this.vehicle, "SteerAngle");
    out.speed = w.read(this.vehicle, "Speed");
    out.wheelF = w.read(this.vehicle, "WheelSpeed_F");
    out.wheelR = w.read(this.vehicle, "WheelSpeed_R");
  }

  private syncPoses(): void {
    this.readPose(this.currPose);
    Object.assign(this.prevPose, this.currPose);
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
        const speed = this.world.read(this.vehicle, "Speed");
        const maxLock = (this.definition.steering.maxWheelAngleDeg * Math.PI) / 180;
        const limit =
          (this.definition.chassis.wheelbase * this.steeringLimitAccel) /
          Math.max(speed * speed, 1e-3);
        frame.steer *= Math.min(1, limit / maxLock);
      }
      this.world.setInput(this.vehicle, frame);
      Object.assign(this.prevPose, this.currPose);
      const t0 = performance.now();
      this.world.step(HOST_DT);
      const cost = performance.now() - t0;
      this.readPose(this.currPose);
      this.stepCostMs = this.stepCostMs === 0 ? cost : this.stepCostMs * 0.98 + cost * 0.02;
      this.recorder.record(this.world.telemetryView(this.vehicle));
      this.accumulator -= HOST_DT;
      this.stepsThisFrame++;
    }
    this.alpha = Math.min(1, Math.max(0, this.accumulator / HOST_DT));
  }

  /** Render pose, interpolated between the last two sim steps. */
  snapshot(out: SimSnapshot): SimSnapshot {
    const a = this.alpha;
    const p = this.prevPose;
    const c = this.currPose;
    out.x = p.x + (c.x - p.x) * a;
    out.y = p.y + (c.y - p.y) * a;
    out.yaw = p.yaw + wrapAngle(c.yaw - p.yaw) * a;
    out.steer = p.steer + (c.steer - p.steer) * a;
    out.speed = c.speed;
    out.wheelF = c.wheelF;
    out.wheelR = c.wheelR;
    return out;
  }

  dispose(): void {
    this.detach?.();
    this.world?.free();
  }
}

export { presetIds };
export type { PresetId };
