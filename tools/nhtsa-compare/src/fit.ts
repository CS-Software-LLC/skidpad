/**
 * The fitted build: the three values the estimated build knows least,
 * identified from the slowly increasing steer alone, so the step steer and
 * both lane changes stay predictions.
 *
 *   steering ratio   ← lateral acceleration gain in the linear range
 *                      (stands in for the steering compliance and the tire's
 *                      cornering stiffness, which this test cannot separate)
 *   front anti-roll  ← roll gradient in the linear range
 *   peak friction    ← maximum lateral acceleration
 *
 * Each value moves its own metric far more than the others do, so a few
 * rounds of one-dimensional secant steps settle them.
 */
import type { Skidpad } from "@skidpad/core";
import { METRICS } from "./compare.js";
import { ESTIMATED, type Tunable } from "./jeep.js";
import type { Row } from "./reference.js";
import { runManoeuvre } from "./run.js";

const metric = (label: string) => {
  const m = METRICS.find((x) => x.maneuver === "sis" && x.label.startsWith(label));
  if (!m) throw new Error(`no sis metric ${label}`);
  return m.fn;
};

type Pair = { key: keyof Tunable; fn: (r: Row[]) => number; lo: number; hi: number };
const RATIO: Pair = {
  key: "steeringRatio",
  fn: metric("lateral acceleration gain"),
  lo: 8,
  hi: 30,
};
const COMPLIANCE: Pair = {
  key: "compliance",
  fn: metric("lateral acceleration gain"),
  lo: 0,
  hi: 60,
};
const CORE: Pair = {
  key: "alignTorqueCompliance",
  fn: metric("lateral acceleration gain"),
  lo: 0,
  hi: 30,
};
const OTHERS: Pair[] = [
  { key: "frontAntiRoll", fn: metric("roll gradient"), lo: 0, hi: 120000 },
  { key: "peakFriction", fn: metric("maximum lateral acceleration"), lo: 0.5, hi: 1.3 },
];

/**
 * What stands in for the steering's give, fitted to the lateral acceleration
 * gain: `"ratio"` an effective steering ratio; `"harness"` a compliance per
 * m/s² of lateral acceleration the harness takes off the hand wheel, at the
 * published ratio of 14; `"core"` the core's aligning-torque compliance steer
 * (ADR-0027), at the published ratio.
 */
export type FitMode = "ratio" | "harness" | "core";

export function fitOnSis(
  sp: Skidpad,
  measuredSis: Row[],
  log: (s: string) => void = () => {},
  bodyFixedAy = false,
  mode: FitMode = "ratio",
): Tunable {
  const PAIRS = [{ ratio: RATIO, harness: COMPLIANCE, core: CORE }[mode], ...OTHERS];
  const t: Tunable = { ...ESTIMATED };
  const run = (x: Tunable) => runManoeuvre(sp, "sis", { tunable: x, bodyFixedAy });
  for (let round = 0; round < 3; round++) {
    for (const p of PAIRS) {
      const target = p.fn(measuredSis);
      const at = (v: number) => p.fn(run({ ...t, [p.key]: v })) - target;
      const tol = 1e-3 * Math.abs(target);
      let x0 = t[p.key];
      let f0 = at(x0);
      let x1 = x0;
      let f1 = f0;
      if (Math.abs(f0) > tol) {
        x1 = x0 === 0 ? (p.key === "frontAntiRoll" ? 5000 : 5) : x0 * 1.02;
        f1 = at(x1);
        for (let k = 0; k < 8 && Math.abs(f1) > tol && f1 !== f0; k++) {
          const x2 = Math.min(p.hi, Math.max(p.lo, x1 - (f1 * (x1 - x0)) / (f1 - f0)));
          x0 = x1;
          f0 = f1;
          x1 = x2;
          f1 = at(x1);
        }
      }
      t[p.key] = Number(x1.toPrecision(4));
      log(`round ${round + 1}: ${p.key} = ${t[p.key]} (metric off by ${f1.toPrecision(3)})`);
    }
  }
  return t;
}
