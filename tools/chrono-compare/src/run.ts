/**
 * Runs the manoeuvres in `chrono/maneuvers.json` on Skidpad's model of the
 * Chrono BMW_E90 and returns rows in the same format as the Chrono CSVs
 * (`chrono/bmw_e90.py`): 100 Hz, vehicle frame x forward, y left, z up,
 * steer input + = right.
 *
 * Inputs follow the Chrono script: the same pedal schedules, and the same PI
 * speed controller for `holdSpeed`, updated at the same 1 kHz. Steering is
 * the one deliberate difference: Skidpad's steering is kinematic, so the car
 * is steered with Chrono's logged mean front road-wheel angle, which takes
 * the steering linkage (its ratio curve, toe, Ackermann, roll steer) out of
 * the comparison.
 *
 * The other difference is the start. Chrono places its car at `initSpeed`
 * with the wheels spinning and settles it for `settle` seconds on the PI
 * controller, which leaves it 0.15–0.22 m/s above the target when the
 * manoeuvre starts. Skidpad's API starts at rest, so the harness drives up
 * and then settles on a tighter controller at the speed Chrono's car
 * actually has at the start, in the gear the automatic picks. Both cars
 * begin the manoeuvre at the same speed, with the manoeuvre's own
 * controller starting fresh in each.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WHEEL_ORDER, type PartialVehicleDefinition, type Skidpad } from "@skidpad/core";
import { at, loadReference, ROOT, type Row } from "./reference.js";
import { bmwE90, MAX_WHEEL_ANGLE_DEG } from "./vehicle.js";

export { at, loadReference, type Row, type RowKey } from "./reference.js";

type Pts = [number, number][];
export interface Spec {
  duration: number;
  initSpeed?: number;
  settle?: number;
  holdSpeed?: number;
  throttle?: Pts;
  brake?: Pts;
  steer?:
    | { type: "points"; points: Pts }
    | { type: "sine"; amp: number; freq: number; start: number; cycles: number };
}
export const MANEUVERS: Record<string, Spec> = JSON.parse(
  readFileSync(join(ROOT, "chrono", "maneuvers.json"), "utf8"),
) as Record<string, Spec>;

function interp(points: Pts, t: number): number {
  const first = points[0]!;
  if (t <= first[0]) return first[1];
  for (let i = 0; i < points.length - 1; i++) {
    const [t0, v0] = points[i]!;
    const [t1, v1] = points[i + 1]!;
    if (t <= t1) return t1 > t0 ? v0 + ((v1 - v0) * (t - t0)) / (t1 - t0) : v1;
  }
  return points[points.length - 1]![1];
}

/**
 * The PI cruise control of the Chrono script (same gains, same clamps). The
 * harness's pre-phase also uses it with tighter gains to settle the start.
 */
class SpeedController {
  i = 0;
  constructor(
    public target: number,
    private readonly kp = 0.4,
    private readonly ki = 0.15,
  ) {}
  update(speed: number, dt: number): [number, number] {
    const e = this.target - speed;
    this.i = Math.max(-2, Math.min(2, this.i + e * dt));
    const u = this.kp * e + this.ki * this.i;
    return [Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, -u * 0.5))];
  }
}

const STEP = 1e-3;
const LOG_EVERY = 10;
const MAX_STEER = (MAX_WHEEL_ANGLE_DEG * Math.PI) / 180;

export interface RunOptions {
  definition?: PartialVehicleDefinition;
}

export function runManeuver(sp: Skidpad, name: string, opts: RunOptions = {}): Row[] {
  const spec = MANEUVERS[name];
  if (!spec) throw new Error(`unknown manoeuvre ${name}`);
  const ref = loadReference(name);
  const world = sp.createWorld(1);
  try {
    const car = world.addVehicle(opts.definition ?? bmwE90());
    const read = (ch: string) => world.read(car, ch);
    const init = spec.initSpeed ?? 0;
    const settle = spec.settle ?? 1;

    // Pre-phase. Parked on 0.3 brake, or driven up to the speed Chrono's
    // car starts the manoeuvre at and settled there.
    if (init > 0) {
      const target = ref[0]!.speed;
      const pre = new SpeedController(target);
      let t = 0;
      while (read("VelX") < target - 0.01) {
        const [throttle, brake] = pre.update(read("VelX"), STEP);
        world.setInput(car, { throttle, brake, steer: 0 });
        world.step(STEP);
        t += STEP;
        if (t > 120) throw new Error(`${name}: never reached ${target} m/s`);
      }
      const settler = new SpeedController(target, 2.0, 2.0);
      for (let k = 0; k < Math.round(settle / STEP); k++) {
        const [throttle, brake] = settler.update(read("VelX"), STEP);
        world.setInput(car, { throttle, brake, steer: 0 });
        world.step(STEP);
      }
    } else {
      for (let k = 0; k < Math.round(settle / STEP); k++) {
        world.setInput(car, { throttle: 0, brake: 0.3, steer: 0 });
        world.step(STEP);
      }
    }

    const hold = spec.holdSpeed !== undefined ? new SpeedController(spec.holdSpeed) : null;
    const x0 = read("PosX");
    const y0 = read("PosY");
    const yaw0 = read("Yaw");
    const rows: Row[] = [];
    const steps = Math.round(spec.duration / STEP);
    for (let k = 0; k < steps; k++) {
      const tm = k * STEP;
      let throttle = spec.throttle ? interp(spec.throttle, tm) : 0;
      let brake = spec.brake ? interp(spec.brake, tm) : 0;
      if (hold) [throttle, brake] = hold.update(read("VelX"), STEP);
      // Chrono's mean front road-wheel angle, + = left; Skidpad's steer is + = right.
      const delta = 0.5 * (at(ref, tm, "delta0") + at(ref, tm, "delta1"));
      world.setInput(car, { throttle, brake, steer: -delta / MAX_STEER });
      world.step(STEP);
      if ((k + 1) % LOG_EVERY !== 0) continue;
      const dx = read("PosX") - x0;
      const dy = read("PosY") - y0;
      const row: Record<string, number> = {
        t: Math.round((tm + STEP) * 1e4) / 1e4,
        // Position in the frame of the start heading.
        x: dx * Math.cos(yaw0) + dy * Math.sin(yaw0),
        y: -dx * Math.sin(yaw0) + dy * Math.cos(yaw0),
        speed: read("VelX"),
        vy: read("VelY"),
        ax: read("LongAccel"),
        ay: read("LatAccel"),
        yawRate: read("YawRate"),
        roll: read("Roll"),
        pitch: read("Pitch"),
        rpm: read("EngineRpm"),
        gear: read("Gear"),
        throttle,
        brake,
        steer: (spec.steer ? 1 : 0) * at(ref, tm + STEP, "steer"),
        delta: delta,
      };
      WHEEL_ORDER.forEach((w, i) => {
        row[`fz${i}`] = read(`TireLoad_${w}`);
        row[`fx${i}`] = read(`TireFx_${w}`);
        row[`fy${i}`] = read(`TireFy_${w}`);
        row[`slip${i}`] = read(`SlipRatio_${w}`);
        row[`alpha${i}`] = read(`SlipAngle_${w}`);
        row[`omega${i}`] = read(`WheelSpeed_${w}`);
      });
      rows.push(row as Row);
    }
    return rows;
  } finally {
    world.free();
  }
}
