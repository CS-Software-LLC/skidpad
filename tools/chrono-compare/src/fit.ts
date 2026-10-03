/**
 * Fits the anti-roll bar wheel rates, the one set of parameters taken from
 * Chrono's behaviour rather than its data: Chrono's bars act through
 * linkages Skidpad does not model. Targets are Chrono's roll gradient and
 * front share of lateral load transfer on the steering ramp, both over
 * 0.1–0.5 g. Everything else in the comparison is a prediction.
 */
import type { Skidpad } from "@skidpad/core";
import { METRICS } from "./compare.js";
import { runManeuver, loadReference, type Row } from "./run.js";
import { bmwE90, derive, type BuildOptions } from "./vehicle.js";

const pick = (label: string) =>
  METRICS.find((m) => m.maneuver === "rampSteer" && m.label === label)!;
const ROLL = pick("roll gradient");
const LLT = pick("front share of lateral load transfer");

export function fitAntiRoll(
  sp: Skidpad,
  log: (s: string) => void = () => {},
  opts: BuildOptions = {},
) {
  const d = derive();
  const ref = loadReference("rampSteer");
  const target = { roll: ROLL.fn(ref, d.wheelbase), llt: LLT.fn(ref, d.wheelbase) };
  log(
    `target: roll gradient ${target.roll.toFixed(3)} deg/g, front share ${target.llt.toFixed(2)} %`,
  );
  const measure = (front: number, rear: number) => {
    const rows: Row[] = runManeuver(sp, "rampSteer", {
      definition: bmwE90({ front, rear }, d, opts),
    });
    const roll = ROLL.fn(rows, d.wheelbase);
    const llt = LLT.fn(rows, d.wheelbase);
    const cost = ((roll - target.roll) / target.roll) ** 2 + ((llt - target.llt) / target.llt) ** 2;
    return { front, rear, roll, llt, cost };
  };
  let best = measure(0, 0);
  for (const front of [0, 10000, 20000, 30000, 40000, 60000]) {
    for (const rear of [0, 5000, 10000, 20000, 30000]) {
      const m = measure(front, rear);
      if (m.cost < best.cost) best = m;
    }
  }
  for (let step = 4000; step >= 250; step /= 2) {
    let moved = true;
    while (moved) {
      moved = false;
      const moves: [number, number][] = [
        [step, 0],
        [-step, 0],
        [0, step],
        [0, -step],
      ];
      for (const [df, dr] of moves) {
        const m = measure(Math.max(0, best.front + df), Math.max(0, best.rear + dr));
        if (m.cost < best.cost) {
          best = m;
          moved = true;
        }
      }
    }
  }
  log(
    `fitted: front ${best.front} N/m, rear ${best.rear} N/m -> roll gradient ${best.roll.toFixed(3)} deg/g, front share ${best.llt.toFixed(2)} %`,
  );
  return { target, best };
}
