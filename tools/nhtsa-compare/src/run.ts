/**
 * Drives Skidpad's Jeep through a measured manoeuvre with the measured
 * hand-wheel angle, at the test's constant speed, and logs what the
 * paper's plots show.
 *
 * The test driver held speed on cruise control; the harness holds it with
 * the Chrono harness's PI controller at stiffer gains (with the Chrono
 * script's, the integral term tops out at 0.3 throttle, short of what
 * 22.5 m/s needs). Before the window starts the car
 * is driven up to speed in a straight line and settled there, so the
 * manoeuvre begins from the same steady state the test car was in. Steering
 * is the measured hand-wheel angle over the steering ratio: Skidpad's
 * steering is kinematic, so any compliance between the hand wheel and the
 * road wheels is outside the model and shows up in the ratio a fit picks.
 *
 * The gearbox is held in one gear through each manoeuvre (`Manoeuvre.gear`),
 * as a manual: left to Skidpad's automatic, the speed controller's throttle
 * at the limit sets off a kickdown, and the shift's drive-torque transient
 * spins the car (docs/validation/nhtsa-jeep-cherokee.md). The test car's
 * engine speed is not published for these runs.
 *
 * Skidpad's channels use ISO axes (y left, z up); the rows are converted to
 * the paper's SAE axes (y right, z down). Skidpad's `LatAccel` is what an
 * accelerometer fixed to the body reads, so it carries `g · sin(roll)` of
 * gravity; VRTC's lateral acceleration is in the road plane (it sits below
 * speed × yaw rate in a steady turn, where a body-fixed reading would sit
 * above it), so the harness takes the gravity component out. With
 * `bodyFixedAy` it keeps Skidpad's reading as it is, as the first run did.
 */
import type { PartialVehicleDefinition, Skidpad } from "@skidpad/core";
import { loadTrace, MANOEUVRES, sample, type Row } from "./reference.js";
import { ESTIMATED, jeepCherokee, steerInput, type Tunable } from "./jeep.js";

const STEP = 1e-3;
const LOG_EVERY = 10;
const DEG = 180 / Math.PI;
const G = 9.81;

class SpeedController {
  i = 0;
  constructor(
    public target: number,
    private readonly kp = 1.0,
    private readonly ki = 0.5,
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
  /** Compare Skidpad's body-fixed `LatAccel` as it is, gravity component included. */
  bodyFixedAy?: boolean;
  definition?: PartialVehicleDefinition;
}

export function runManoeuvre(sp: Skidpad, name: string, opts: RunOptions = {}): Row[] {
  const m = MANOEUVRES[name];
  if (!m) throw new Error(`unknown manoeuvre ${name}`);
  const tunable = opts.tunable ?? ESTIMATED;
  const hw = loadTrace(`${name}_handwheel_exp`);
  const world = sp.createWorld(1);
  try {
    const def = structuredClone(opts.definition ?? jeepCherokee(tunable));
    def.drivetrain!.transmission!.mode = "manual";
    const car = world.addVehicle(def);
    const read = (ch: Parameters<typeof world.read>[1]) => world.read(car, ch);

    // Up to speed, then settle on a tight controller with the wheel held
    // where the test began (the first measured hand-wheel sample).
    const steer0 = steerInput(sample(hw, m.start), tunable);
    const pre = new SpeedController(m.speed, 2.0, 2.0);
    let t = 0;
    let gear = 1;
    while (read("VelX") < m.speed - 0.01) {
      if (gear < m.gear && read("EngineRpm") > 3000) gear++;
      const [throttle, brake] = pre.update(read("VelX"), STEP);
      world.setInput(car, { throttle, brake, steer: 0, gear });
      world.step(STEP);
      t += STEP;
      if (t > 120) throw new Error(`${name}: never reached ${m.speed} m/s`);
    }
    const settler = new SpeedController(m.speed, 2.0, 2.0);
    gear = m.gear;
    for (let k = 0; k < 3000; k++) {
      const [throttle, brake] = settler.update(read("VelX"), STEP);
      world.setInput(car, { throttle, brake, steer: steer0, gear });
      world.step(STEP);
    }

    const hold = new SpeedController(m.speed);
    // Road-plane lateral acceleration (SAE) of the last step, for the compliance.
    const roadAy = () => -read("LatAccel") + G * Math.sin(read("Roll"));
    const rows: Row[] = [];
    const steps = Math.round((m.end - m.start) / STEP);
    for (let k = 0; k < steps; k++) {
      const tm = m.start + k * STEP;
      const [throttle, brake] = hold.update(read("VelX"), STEP);
      world.setInput(car, {
        throttle,
        brake,
        steer: steerInput(sample(hw, tm), tunable, roadAy()),
        gear,
      });
      world.step(STEP);
      if ((k + 1) % LOG_EVERY !== 0) continue;
      const ts = Math.round((tm + STEP) * 100) / 100;
      rows.push({
        t: ts,
        handwheel: sample(hw, ts),
        ay: opts.bodyFixedAy ? -read("LatAccel") : roadAy(),
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
