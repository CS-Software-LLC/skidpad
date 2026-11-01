/**
 * Skidpad's Taurus against VRTC's measurements (SAE 970563): the 33 m/s,
 * 6 m/s² J-turn in the time domain and the 22 m/s pulse-steer frequency
 * response.
 *
 * The J-turn is driven with the measured hand-wheel angle (the mean of ten
 * repeats, figure 10) while a PI controller follows the measured speed
 * (figure 11), in fourth gear. Its lateral acceleration is one run
 * (V0RCX06, figure 7), zeroed by its mean before the steer: the
 * accelerometer reads about 0.16 m/s² on the straight.
 *
 * VRTC computed the frequency response from pulse steers of about 0.57 rad
 * of hand wheel at 22.8 m/s (maneuver PD). Skidpad is driven instead with a
 * sine of hand-wheel angle at each of the plotted frequencies and the
 * response read from the settled cycles by Fourier projection, which for a
 * linear response is the same quantity. The amplitude, 0.2 rad, keeps the
 * lateral acceleration under about 1 m/s², inside the linear range, as the
 * pulse's spectrum is at each frequency.
 *
 * Tolerances were set before the first run and are not moved to fit a
 * result. The frequency points are judged only where VRTC's coherence is at
 * least 0.8; below it, the paper's confidence on the mean widens and the
 * point is shown but not judged.
 */
import type { PartialVehicleDefinition, Skidpad } from "@skidpad/core";
import { loadTrace, sample, TAURUS_DIR, type Trace } from "./reference.js";
import { SpeedController } from "./run.js";
import { fordTaurus, TAURUS_ESTIMATED, taurusSteerInput, type TaurusTunable } from "./taurus.js";

const STEP = 1e-3;
const DEG = 180 / Math.PI;
const G = 9.81;
const load = (name: string): Trace => loadTrace(name, TAURUS_DIR);

/** One sample, SAE axes. */
export interface TaurusRow {
  t: number;
  handwheel: number; // deg
  ay: number; // m/s², road plane
  yawRate: number; // rad/s
  speed: number; // m/s
}

export const JTURN = { start: -2.0, end: 5.1, gear: 4, speed: 33.46 };
export const FRF = { speed: 22.8, gear: 4, amplitudeRad: 0.2 };

/** The measured J-turn at 100 Hz, lateral acceleration zeroed before the steer. */
export function measuredJTurn(): TaurusRow[] {
  const hw = load("jturn33_handwheel_exp");
  const ay = load("jturn33_ay_exp");
  const v = load("jturn33_speed_exp");
  const pre = ay.filter(([t]) => t < -0.2);
  const offset = pre.reduce((s, [, y]) => s + y, 0) / pre.length;
  const rows: TaurusRow[] = [];
  for (let k = 0; JTURN.start + k * 0.01 <= JTURN.end + 1e-9; k++) {
    const t = Math.round((JTURN.start + k * 0.01) * 100) / 100;
    rows.push({
      t,
      handwheel: sample(hw, t),
      ay: sample(ay, t) - offset,
      yawRate: NaN,
      speed: sample(v, t),
    });
  }
  return rows;
}

function newCar(
  sp: Skidpad,
  tunable: TaurusTunable,
  definition: PartialVehicleDefinition | undefined,
  speed: number,
  gear: number,
  steer0 = 0,
) {
  const world = sp.createWorld(1);
  const def = structuredClone(definition ?? fordTaurus(tunable));
  def.drivetrain!.transmission!.mode = "manual";
  const car = world.addVehicle(def);
  const read = (ch: Parameters<typeof world.read>[1]) => world.read(car, ch);
  const pre = new SpeedController(speed, 2.0, 2.0);
  let g = 1;
  let t = 0;
  while (read("VelX") < speed - 0.01) {
    if (g < gear && read("EngineRpm") > 3000) g++;
    const [throttle, brake] = pre.update(read("VelX"), STEP);
    world.setInput(car, { throttle, brake, steer: 0, gear: g });
    world.step(STEP);
    t += STEP;
    if (t > 120) throw new Error(`never reached ${speed} m/s`);
  }
  const settle = new SpeedController(speed, 2.0, 2.0);
  for (let k = 0; k < 3000; k++) {
    const [throttle, brake] = settle.update(read("VelX"), STEP);
    world.setInput(car, { throttle, brake, steer: steer0, gear });
    world.step(STEP);
  }
  // Road-plane lateral acceleration and yaw rate, SAE.
  const ay = () => -read("LatAccel") + G * Math.sin(read("Roll"));
  const yaw = () => -read("YawRate");
  return { world, car, read, ay, yaw };
}

export function runJTurn(
  sp: Skidpad,
  tunable: TaurusTunable = TAURUS_ESTIMATED,
  definition?: PartialVehicleDefinition,
): TaurusRow[] {
  const hw = load("jturn33_handwheel_exp");
  const v = load("jturn33_speed_exp");
  const { world, car, read, ay, yaw } = newCar(
    sp,
    tunable,
    definition,
    sample(v, JTURN.start),
    JTURN.gear,
    taurusSteerInput(sample(hw, JTURN.start), tunable),
  );
  try {
    const hold = new SpeedController(sample(v, JTURN.start));
    const rows: TaurusRow[] = [];
    const steps = Math.round((JTURN.end - JTURN.start) / STEP);
    for (let k = 0; k < steps; k++) {
      const tm = JTURN.start + k * STEP;
      hold.target = sample(v, tm);
      const [throttle, brake] = hold.update(read("VelX"), STEP);
      world.setInput(car, {
        throttle,
        brake,
        steer: taurusSteerInput(sample(hw, tm), tunable),
        gear: JTURN.gear,
      });
      world.step(STEP);
      if ((k + 1) % 10 !== 0) continue;
      const ts = Math.round((tm + STEP) * 100) / 100;
      rows.push({
        t: ts,
        handwheel: sample(hw, ts),
        ay: ay(),
        yawRate: yaw(),
        speed: read("VelX"),
      });
    }
    return rows;
  } finally {
    world.free();
  }
}

export interface FrfPoint {
  omega: number; // rad/s
  yawMag: number; // (rad/s) per rad of hand wheel
  yawPhase: number; // deg
  ayMag: number; // (m/s²) per rad of hand wheel
  ayPhase: number; // deg
}

/** VRTC's 22 m/s frequency response, with each point's coherence. */
export function measuredFrf(): Array<FrfPoint & { yawCoherence: number; ayCoherence: number }> {
  const col = (name: string) => load(`frf22_${name}`).map(([, y]) => y);
  const omegas = load("frf22_yawrate_mag").map(([w]) => w);
  const [ym, yp, yc, am, ap, ac] = [
    "yawrate_mag",
    "yawrate_phase",
    "yawrate_coherence",
    "ay_mag",
    "ay_phase",
    "ay_coherence",
  ].map(col);
  return omegas.map((omega, i) => ({
    omega,
    yawMag: ym![i]!,
    yawPhase: yp![i]!,
    yawCoherence: yc![i]!,
    ayMag: am![i]!,
    ayPhase: ap![i]!,
    ayCoherence: ac![i]!,
  }));
}

/** Phase in (−270°, 90°], the range VRTC plots lags in. */
const wrap = (deg: number) => {
  let d = deg;
  while (d > 90) d -= 360;
  while (d <= -270) d += 360;
  return d;
};

/** Skidpad's response to a hand-wheel sine at `omega`, from whole settled cycles. */
export function frfAt(
  sp: Skidpad,
  omega: number,
  tunable: TaurusTunable = TAURUS_ESTIMATED,
  definition?: PartialVehicleDefinition,
): FrfPoint {
  const { world, car, read, ay, yaw } = newCar(sp, tunable, definition, FRF.speed, FRF.gear);
  try {
    const hold = new SpeedController(FRF.speed);
    const period = (2 * Math.PI) / omega;
    // Settle for at least 3 s and two cycles, then read whole cycles over at least 4 s.
    const settleCycles = Math.max(2, Math.ceil(3 / period));
    const cycles = Math.max(3, Math.ceil(4 / period));
    const steps = Math.round(((settleCycles + cycles) * period) / STEP);
    const from = Math.round((settleCycles * period) / STEP);
    const acc = { uc: 0, us: 0, yc: 0, ys: 0, ac: 0, as: 0 };
    for (let k = 0; k < steps; k++) {
      const t = k * STEP;
      const hwRad = FRF.amplitudeRad * Math.sin(omega * t);
      const [throttle, brake] = hold.update(read("VelX"), STEP);
      world.setInput(car, {
        throttle,
        brake,
        steer: taurusSteerInput(hwRad * DEG, tunable),
        gear: FRF.gear,
      });
      world.step(STEP);
      if (k < from) continue;
      const te = t + STEP;
      const c = Math.cos(omega * te);
      const s = Math.sin(omega * te);
      const u = FRF.amplitudeRad * Math.sin(omega * te);
      const y = yaw();
      const a = ay();
      acc.uc += u * c;
      acc.us += u * s;
      acc.yc += y * c;
      acc.ys += y * s;
      acc.ac += a * c;
      acc.as += a * s;
    }
    // Complex amplitude X = Σ x·e^{-iωt}: re = Σx·cos, im = −Σx·sin.
    const ratio = (rc: number, rs: number) => {
      const [ur, ui] = [acc.uc, -acc.us];
      const [yr, yi] = [rc, -rs];
      const d = ur * ur + ui * ui;
      const re = (yr * ur + yi * ui) / d;
      const im = (yi * ur - yr * ui) / d;
      return [Math.hypot(re, im), wrap(Math.atan2(im, re) * DEG)] as const;
    };
    const [yawMag, yawPhase] = ratio(acc.yc, acc.ys);
    const [ayMag, ayPhase] = ratio(acc.ac, acc.as);
    return { omega, yawMag, yawPhase, ayMag, ayPhase };
  } finally {
    world.free();
  }
}

export function runFrf(
  sp: Skidpad,
  tunable: TaurusTunable = TAURUS_ESTIMATED,
  definition?: PartialVehicleDefinition,
): FrfPoint[] {
  return measuredFrf().map((p) => frfAt(sp, p.omega, tunable, definition));
}

// ---- metrics -----------------------------------------------------------

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const between = (rows: TaurusRow[], t0: number, t1: number) =>
  rows.filter((r) => r.t >= t0 && r.t <= t1);

export const steadyAy = (rows: TaurusRow[]) => mean(between(rows, 2, 5).map((r) => r.ay));

/** Time from the hand wheel's 50 % to the lateral acceleration's 90 %, of their 2–5 s means. */
export function ayResponseTime(rows: TaurusRow[]): number {
  const hw = mean(between(rows, 2, 5).map((r) => r.handwheel));
  const ay = steadyAy(rows);
  const t50 = rows.find((r) => r.t >= -0.5 && r.handwheel >= 0.5 * hw)?.t ?? NaN;
  const t90 = rows.find((r) => r.t >= t50 && r.ay >= 0.9 * ay)?.t ?? NaN;
  return t90 - t50;
}

/** Peak lateral acceleration, 0.2 s mean, over its 2–5 s mean. */
export function ayOvershoot(rows: TaurusRow[]): number {
  let best = -Infinity;
  for (let i = 0; i + 20 <= rows.length; i++)
    best = Math.max(best, mean(rows.slice(i, i + 20).map((r) => r.ay)));
  return best / steadyAy(rows);
}

/** RMS difference of lateral acceleration over the window, over the measured range. */
export function ayNrmse(measured: TaurusRow[], sim: TaurusRow[]): number {
  const byT = new Map(sim.map((r) => [r.t, r.ay]));
  let se = 0;
  let n = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of measured) {
    const s = byT.get(r.t);
    if (s === undefined) continue;
    se += (s - r.ay) ** 2;
    n++;
    lo = Math.min(lo, r.ay);
    hi = Math.max(hi, r.ay);
  }
  return Math.sqrt(se / n) / (hi - lo);
}

export interface Judged {
  label: string;
  unit: string;
  measured: number;
  skidpad: number;
  difference: number;
  tolerance: { kind: "relative" | "absolute"; value: number };
  /** Undefined where the point is shown but not judged (low coherence). */
  pass?: boolean | undefined;
}

const judge = (
  label: string,
  unit: string,
  measured: number,
  skidpad: number,
  tolerance: Judged["tolerance"],
  judged = true,
): Judged => {
  const difference = tolerance.kind === "relative" ? skidpad / measured - 1 : skidpad - measured;
  return {
    label,
    unit,
    measured,
    skidpad,
    difference,
    tolerance,
    pass: judged ? Math.abs(difference) <= tolerance.value : undefined,
  };
};

export const COHERENCE_FLOOR = 0.8;

export function evaluateTaurus(
  jMeasured: TaurusRow[],
  jSim: TaurusRow[],
  frf: FrfPoint[],
): Judged[] {
  const out: Judged[] = [
    judge(
      "J-turn: steady lateral acceleration, 2–5 s",
      "m/s²",
      steadyAy(jMeasured),
      steadyAy(jSim),
      {
        kind: "relative",
        value: 0.1,
      },
    ),
    judge(
      "J-turn: response time, 50 % wheel to 90 % lateral acceleration",
      "s",
      ayResponseTime(jMeasured),
      ayResponseTime(jSim),
      { kind: "absolute", value: 0.1 },
    ),
    judge(
      "J-turn: lateral acceleration peak over steady",
      "",
      ayOvershoot(jMeasured),
      ayOvershoot(jSim),
      {
        kind: "absolute",
        value: 0.05,
      },
    ),
  ];
  const nr = ayNrmse(jMeasured, jSim);
  out.push({
    label: "J-turn: lateral acceleration trace, RMS difference / measured range",
    unit: "",
    measured: NaN,
    skidpad: nr,
    difference: nr,
    tolerance: { kind: "absolute", value: 0.1 },
    pass: nr <= 0.1,
  });
  const m = measuredFrf();
  frf.forEach((p, i) => {
    const r = m[i]!;
    const w = r.omega.toFixed(1);
    const yawOk = r.yawCoherence >= COHERENCE_FLOOR;
    const ayOk = r.ayCoherence >= COHERENCE_FLOOR;
    out.push(
      judge(
        `FRF ${w} rad/s: yaw-rate gain`,
        "1/s",
        r.yawMag,
        p.yawMag,
        { kind: "relative", value: 0.2 },
        yawOk,
      ),
      judge(
        `FRF ${w} rad/s: yaw-rate phase`,
        "deg",
        r.yawPhase,
        p.yawPhase,
        { kind: "absolute", value: 15 },
        yawOk,
      ),
      judge(
        `FRF ${w} rad/s: lateral acceleration gain`,
        "m/s²",
        r.ayMag,
        p.ayMag,
        { kind: "relative", value: 0.2 },
        ayOk,
      ),
      judge(
        `FRF ${w} rad/s: lateral acceleration phase`,
        "deg",
        r.ayPhase,
        p.ayPhase,
        { kind: "absolute", value: 15 },
        ayOk,
      ),
    );
  });
  return out;
}

/**
 * The fitted build: the steering ratio that matches the J-turn's steady
 * lateral acceleration. It stands in for everything between the hand wheel
 * and the tires' lateral force that the estimated build cannot separate
 * (steering compliance, tire cornering stiffness, understeer), so the
 * frequency response at another speed is a prediction.
 */
export function fitRatioOnJTurn(sp: Skidpad, log: (s: string) => void = () => {}): TaurusTunable {
  const target = steadyAy(measuredJTurn());
  const at = (ratio: number) => steadyAy(runJTurn(sp, { steeringRatio: ratio })) - target;
  let x0 = TAURUS_ESTIMATED.steeringRatio;
  let f0 = at(x0);
  let x1 = x0 * 1.05;
  let f1 = at(x1);
  for (let k = 0; k < 10 && Math.abs(f1) > 1e-3 * target && f1 !== f0; k++) {
    const x2 = Math.min(40, Math.max(8, x1 - (f1 * (x1 - x0)) / (f1 - f0)));
    [x0, f0, x1] = [x1, f1, x2];
    f1 = at(x1);
    log(`steering ratio ${x1.toFixed(3)}: steady ay off by ${f1.toFixed(4)} m/s²`);
  }
  return { steeringRatio: Number(x1.toPrecision(4)) };
}
