/**
 * Regression guard on the comparison with NHTSA VRTC's measured 1994 Ford
 * Taurus GL (docs/validation/nhtsa-ford-taurus.md). The digitised traces
 * are committed, so this needs nothing outside the repository.
 *
 * Every result within tolerance today must stay within it. The known gaps
 * are outside it for the reasons the report gives; when a change brings one
 * inside, take it off the list here and update the report.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { init, validateDefinition, type Skidpad } from "@skidpad/core";
import { fordTaurus, TAURUS_ESTIMATED, type TaurusTunable } from "./taurus.js";
import {
  evaluateTaurus,
  fitRatioOnJTurn,
  measuredFrf,
  measuredJTurn,
  runFrf,
  runJTurn,
  steadyAy,
  type Judged,
} from "./taurusRun.js";

const GAIN =
  "the gain at 22.8 m/s is high: the J-turn sets the ratio at 0.6 g, where the estimated tires are nearer their limit than the car's";
const LAG =
  "the car's yaw rate lags the hand wheel past −90°, which the kinematic steering and estimated tire lag do not reach";
const yawPhase = (w: string) => ({ [`FRF ${w} rad/s: yaw-rate phase`]: LAG });

/** Estimated build (steering ratio 16): label → why it is outside tolerance. */
const ESTIMATED_GAPS: Record<string, string> = {
  ...Object.fromEntries(
    ["2.5", "4.9", "7.4", "9.8", "12.3", "14.7", "17.2"].map((w) => [
      `FRF ${w} rad/s: yaw-rate gain`,
      GAIN,
    ]),
  ),
  "FRF 2.5 rad/s: lateral acceleration gain": GAIN,
  "FRF 4.9 rad/s: lateral acceleration gain": GAIN,
  "FRF 7.4 rad/s: lateral acceleration gain": GAIN,
  ...yawPhase("7.4"),
  ...yawPhase("9.8"),
  ...yawPhase("12.3"),
  ...yawPhase("14.7"),
  ...yawPhase("17.2"),
};

/** Steering ratio fitted on the J-turn's steady lateral acceleration. */
const FITTED_GAPS: Record<string, string> = {
  "J-turn: lateral acceleration peak over steady":
    "0.056 under the measured overshoot against ±0.05: the estimated build has less yaw lag to overshoot with",
  "FRF 2.5 rad/s: yaw-rate gain": GAIN,
  "FRF 2.5 rad/s: lateral acceleration gain": GAIN,
  "FRF 4.9 rad/s: yaw-rate gain": GAIN,
  "FRF 14.7 rad/s: yaw-rate gain": GAIN,
  ...yawPhase("7.4"),
  ...yawPhase("9.8"),
  ...yawPhase("12.3"),
  ...yawPhase("14.7"),
  ...yawPhase("17.2"),
};

function check(results: Judged[], gaps: Record<string, string>) {
  const outside = results.filter((j) => j.pass === false).map((j) => j.label);
  expect(outside.filter((k) => !(k in gaps))).toEqual([]);
  expect(Object.keys(gaps).filter((k) => !outside.includes(k))).toEqual([]);
}

describe("Skidpad against NHTSA VRTC's measured Ford Taurus", () => {
  let sp: Skidpad;
  const run = (t: TaurusTunable) => evaluateTaurus(measuredJTurn(), runJTurn(sp, t), runFrf(sp, t));

  beforeAll(async () => {
    sp = await init();
  });

  it("reads the measured values the report quotes", () => {
    const j = measuredJTurn();
    // VRTC: 6.11 m/s² raw mean over 2–5 s, with the 0.16 m/s² straight-line offset in it.
    expect(steadyAy(j)).toBeCloseTo(5.96, 1);
    const f = measuredFrf();
    expect(f).toHaveLength(7);
    expect(f[0]!.yawMag).toBeCloseTo(0.22, 2);
    expect(f[6]!.yawPhase).toBeCloseTo(-143, 0);
    expect(f.every((p) => p.yawCoherence > 0.9)).toBe(true);
  });

  it("builds a valid definition", () => {
    expect(validateDefinition(fordTaurus()).ok).toBe(true);
  });

  it("estimated build: within tolerance outside the known gaps", () => {
    check(run(TAURUS_ESTIMATED), ESTIMATED_GAPS);
  });

  it("fitted steering ratio: within tolerance outside the known gaps", () => {
    const t = fitRatioOnJTurn(sp);
    expect(t.steeringRatio).toBeGreaterThan(17.5);
    expect(t.steeringRatio).toBeLessThan(20);
    check(run(t), FITTED_GAPS);
  });
});
