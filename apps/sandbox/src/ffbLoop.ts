/**
 * A closed force-feedback loop with nobody holding the wheel: a rim with
 * inertia, the firmware's column friction and damper, the wheel's angle
 * read once per host step into the core, the core's torque through the
 * scaler, and the motor holding each output until the next one. Every
 * filter change in the force-feedback path can be checked here for the
 * classic failure of a wheel that oscillates when released, before it
 * reaches a real wheel.
 *
 * The rim is integrated at 1 kHz between host steps:
 * `J·θ̈ = T_motor − c·θ̇ − f·sign(θ̇)` with the friction as a stick-slip
 * Coulomb term, angles positive right like the steer input.
 */
import type { PartialVehicleDefinition, Skidpad } from "@skidpad/core";
import { FfbScaler, ffbFrameFromTelemetry, type FfbScalerOptions } from "@skidpad/input";

export interface ReleaseOptions {
  /** Car speed when the wheel is let go, m/s (held with the throttle). */
  speed: number;
  /** Rim angle when released, rad (default 90°). */
  releaseAngle?: number;
  /** Seconds to simulate after the release (default 4). */
  seconds?: number;
  /** Host step, s (default 1/60). */
  hostDt?: number;
  /**
   * Rim inertia with the wheel fitted, kg·m² (default 0.03, the order of a
   * direct-drive base with a 300 mm rim [VERIFY on the G PRO]).
   */
  inertia?: number;
  /** Torque at full output, N·m: peak × maxOutput (default 11 × 0.4). */
  fullScale?: number;
  /** Multiplier on the car's column friction and damping (default 1). */
  columnScale?: number;
  /**
   * The device's end stops, rad either side (default 540°, a 1080° wheel):
   * a stiff spring past them, as the firmware's bump stop.
   */
  endStop?: number;
  /** Scaler options over the defaults (gain, smoothing, slew). */
  scaler?: FfbScalerOptions;
}

export interface ReleaseTrace {
  /** Time after the release of each host step, s. */
  time: number[];
  /** Rim angle at each host step, rad. */
  angle: number[];
  /** Rim speed at each host step, rad/s. */
  rate: number[];
  /** The car's yaw rate at each host step, rad/s. */
  yawRate: number[];
}

const RIM_DT = 1 / 1000;
/** Bump stop stiffness, N·m/rad, and damping, N·m·s/rad, past the end stop. */
const END_STOP_RATE = 50;
const END_STOP_DAMPING = 1;

/**
 * Bring the car to `speed` in a straight line, then let the wheel go from
 * `releaseAngle` and record the rim.
 */
export function releaseWheel(
  sp: Skidpad,
  partial: PartialVehicleDefinition,
  o: ReleaseOptions,
): ReleaseTrace {
  const def = sp.completeDefinition(partial);
  const hostDt = o.hostDt ?? 1 / 60;
  const lockRad = (def.steering.ratio * def.steering.maxWheelAngleDeg * Math.PI) / 180;
  const world = sp.createWorld(1);
  const car = world.addVehicle(def);
  // Up to speed with the path follower on a straight line, then hold it
  // with a throttle that only knows the speed error.
  if (o.speed > 0) {
    world.setAi(
      car,
      [
        [0, 0],
        [5000, 0],
      ],
      { maxSpeed: o.speed, closed: false },
    );
    for (let k = 0; k < 60 / hostDt && world.read(car, "Speed") < o.speed - 0.3; k++) {
      world.step(hostDt);
    }
    world.clearAi(car);
  }
  const holdThrottle = () =>
    o.speed > 0 ? Math.max(0, Math.min(1, 0.3 + 0.5 * (o.speed - world.read(car, "Speed")))) : 0;

  const scaler = new FfbScaler({ maxTorque: o.fullScale ?? 11 * 0.4, ...o.scaler });
  const inertia = o.inertia ?? 0.03;
  const col = o.columnScale ?? 1;
  const damping = scaler.gain * col * def.steering.columnDamping;
  const friction = scaler.gain * col * def.steering.columnFriction;
  const endStop = o.endStop ?? (540 * Math.PI) / 180;
  let angle = o.releaseAngle ?? Math.PI / 2;
  let rate = 0;
  let motor = 0;
  const trace: ReleaseTrace = { time: [], angle: [], rate: [], yawRate: [] };
  const read = (c: string) => world.read(car, c as "Speed");
  const substeps = Math.max(1, Math.round(hostDt / RIM_DT));
  for (let k = 0; k < (o.seconds ?? 4) / hostDt; k++) {
    // The host reads the wheel, steps the car and updates the motor.
    world.setInput(car, {
      steer: Math.max(-1, Math.min(1, angle / lockRad)),
      throttle: holdThrottle(),
    });
    world.step(hostDt);
    const frame = ffbFrameFromTelemetry(read, def.steering, (angle * 180) / Math.PI);
    scaler.scale(frame.torque, hostDt, frame.wheelAngle);
    motor = scaler.sent;
    // The rim between host steps, the motor held.
    const h = hostDt / substeps;
    for (let s = 0; s < substeps; s++) {
      // Past the end stop, a stiff damped spring.
      const over = Math.abs(angle) - endStop;
      const stop =
        over > 0 ? -Math.sign(angle) * END_STOP_RATE * over - END_STOP_DAMPING * rate : 0;
      let v = rate + (h * (motor + stop - damping * rate)) / inertia;
      const stick = (h * friction) / inertia;
      v = Math.abs(v) <= stick ? 0 : v - Math.sign(v) * stick;
      rate = v;
      angle += h * rate;
    }
    trace.yawRate.push(world.read(car, "YawRate"));
    trace.time.push((k + 1) * hostDt);
    trace.angle.push(angle);
    trace.rate.push(rate);
  }
  world.free();
  return trace;
}

/**
 * The successive peaks of |angle| between zero crossings (one per half
 * cycle); a release that settles has them shrinking.
 */
export function halfCyclePeaks(angle: readonly number[]): number[] {
  const peaks: number[] = [];
  let peak = 0;
  let sign = Math.sign(angle[0] ?? 0);
  for (const a of angle) {
    const s = Math.sign(a);
    if (s !== 0 && sign !== 0 && s !== sign) {
      peaks.push(peak);
      peak = 0;
    }
    if (s !== 0) sign = s;
    peak = Math.max(peak, Math.abs(a));
  }
  peaks.push(peak);
  return peaks;
}

/** How a release ended: settled, still moving, or swinging wider each half cycle. */
export type ReleaseVerdict = "settled" | "moving" | "growing";

/**
 * A release grows when any half-cycle peak exceeds the one before by more
 * than 2 %, and has settled when the rim is at rest at the end.
 */
export function releaseVerdict(trace: ReleaseTrace): ReleaseVerdict {
  const p = halfCyclePeaks(trace.angle);
  if (p.some((x, i) => i > 0 && x > 1.02 * p[i - 1]!)) return "growing";
  return Math.abs(trace.rate.at(-1) ?? 0) < 0.05 ? "settled" : "moving";
}
