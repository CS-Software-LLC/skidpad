/**
 * Drives Skidpad's Jeep through a measured manoeuvre with the measured
 * hand-wheel angle, at the test's constant speed, and logs what the
 * paper's plots show.
 *
 * The test driver held speed on cruise control; the harness holds it with
 * the PI controller of the Chrono harness. Before the window starts the car
 * is driven up to speed in a straight line and settled there, so the
 * manoeuvre begins from the same steady state the test car was in. Steering
 * is the measured hand-wheel angle over the steering ratio: Skidpad's
 * steering is kinematic, so any compliance between the hand wheel and the
 * road wheels is outside the model and shows up in the ratio a fit picks.
 *
 * Skidpad's channels use ISO axes (y left, z up); the rows are converted to
 * the paper's SAE axes (y right, z down).
 */
import type { PartialVehicleDefinition, Skidpad } from "@skidpad/core";
import { loadTrace, MANOEUVRES, sample, type Row } from "./reference.js";
import { ESTIMATED, jeepCherokee, steerInput, type Tunable } from "./jeep.js";

const STEP = 1e-3;
const LOG_EVERY = 10;
const DEG = 180 / Math.PI;

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

export interface RunOptions {
  tunable?: Tunable;
  definition?: PartialVehicleDefinition;
}

export function runManoeuvre(sp: Skidpad, name: string, opts: RunOptions = {}): Row[] {
  const m = MANOEUVRES[name];
  if (!m) throw new Error(`unknown manoeuvre ${name}`);
  const tunable = opts.tunable ?? ESTIMATED;
  const hw = loadTrace(`${name}_handwheel_exp`);
  const world = sp.createWorld(1);
  try {
    const car = world.addVehicle(opts.definition ?? jeepCherokee(tunable));
    const read = (ch: Parameters<typeof world.read>[1]) => world.read(car, ch);

    // Up to speed, then settle on a tight controller with the wheel held
    // where the test began (the first measured hand-wheel sample).
    const steer0 = steerInput(sample(hw, m.start), tunable);
    const pre = new SpeedController(m.speed);
    let t = 0;
    while (read("VelX") < m.speed - 0.01) {
      const [throttle, brake] = pre.update(read("VelX"), STEP);
      world.setInput(car, { throttle, brake, steer: 0 });
      world.step(STEP);
      t += STEP;
      if (t > 120) throw new Error(`${name}: never reached ${m.speed} m/s`);
    }
    const settler = new SpeedController(m.speed, 2.0, 2.0);
    for (let k = 0; k < 3000; k++) {
      const [throttle, brake] = settler.update(read("VelX"), STEP);
      world.setInput(car, { throttle, brake, steer: steer0 });
      world.step(STEP);
    }

    const hold = new SpeedController(m.speed);
    const rows: Row[] = [];
    const steps = Math.round((m.end - m.start) / STEP);
    for (let k = 0; k < steps; k++) {
      const tm = m.start + k * STEP;
      const [throttle, brake] = hold.update(read("VelX"), STEP);
      world.setInput(car, { throttle, brake, steer: steerInput(sample(hw, tm), tunable) });
      world.step(STEP);
      if ((k + 1) % LOG_EVERY !== 0) continue;
      const ts = Math.round((tm + STEP) * 100) / 100;
      rows.push({
        t: ts,
        handwheel: sample(hw, ts),
        ay: -read("LatAccel"),
        yawRate: -read("YawRate") * DEG,
        roll: read("Roll") * DEG,
        speed: read("VelX"),
      });
    }
    return rows;
  } finally {
    world.free();
  }
}
