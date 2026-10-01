/**
 * The simulation loop, independent of React and of the renderer. Fixed
 * 60 Hz host steps with an accumulator; the core substeps at 1 kHz inside.
 */
import { init, type ContactPatch, type World, type VehicleDefinition } from "@contactpatch/core";
import { KeyboardInput, GamepadInput } from "@contactpatch/input";
import { TelemetryRecorder } from "@contactpatch/telemetry";
import { preset, presetIds, type PresetId } from "@contactpatch/presets";

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

export class Sim {
  cp!: ContactPatch;
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
  private detach: (() => void) | undefined;
  stepsThisFrame = 0;
  /** Running mean of wall time per host step, ms. */
  stepCostMs = 0;

  async load(): Promise<void> {
    this.cp = await init();
    this.recorder = new TelemetryRecorder({ channels: this.cp.telemetryLayout, capacity: 60 * 60 });
    this.world = this.cp.createWorld(1);
    this.setPreset(this.presetId);
    this.detach = this.keyboard.attach(window);
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
  }

  reset(): void {
    this.world.resetVehicle(this.vehicle, 0, 0, 0);
    this.recorder.clear();
  }

  /** Call once per animation frame. */
  frame(nowMs: number): void {
    if (this.last === 0) this.last = nowMs;
    const dt = Math.min((nowMs - this.last) / 1000, 0.25);
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
      const t0 = performance.now();
      this.world.step(HOST_DT);
      const cost = performance.now() - t0;
      this.stepCostMs = this.stepCostMs === 0 ? cost : this.stepCostMs * 0.98 + cost * 0.02;
      this.recorder.record(this.world.telemetryView(this.vehicle));
      this.accumulator -= HOST_DT;
      this.stepsThisFrame++;
    }
  }

  snapshot(out: SimSnapshot): SimSnapshot {
    const w = this.world;
    out.x = w.read(this.vehicle, "PosX");
    out.y = w.read(this.vehicle, "PosY");
    out.yaw = w.read(this.vehicle, "Yaw");
    out.steer = w.read(this.vehicle, "SteerAngle");
    out.speed = w.read(this.vehicle, "Speed");
    out.wheelF = w.read(this.vehicle, "WheelSpeed_F");
    out.wheelR = w.read(this.vehicle, "WheelSpeed_R");
    return out;
  }

  dispose(): void {
    this.detach?.();
    this.world?.free();
  }
}

export { presetIds };
export type { PresetId };
