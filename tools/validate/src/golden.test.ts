import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { init } from "@skidpad/core";
import { preset, type PresetId } from "@skidpad/presets";
import { compare, DEFAULT_TOLERANCE, runAll, type ValidationReport } from "./scenarios.js";

describe("validation scenarios", () => {
  let report: ValidationReport;
  beforeAll(async () => {
    const sp = await init();
    report = runAll(sp);
  }, 120_000);

  it("match the golden results within tolerance", () => {
    const golden = JSON.parse(
      readFileSync(fileURLToPath(new URL("../golden/results.json", import.meta.url)), "utf8"),
    ) as ValidationReport;
    const diffs = compare(golden, report, DEFAULT_TOLERANCE);
    expect(
      diffs,
      diffs.map((d) => `${d.path}: ${String(d.golden)} -> ${String(d.current)}`).join("\n"),
    ).toEqual([]);
  });

  it("every preset stays put at rest and parked on slopes", () => {
    for (const [id, v] of Object.entries(report.vehicles)) {
      for (const [name, c] of Object.entries(v.parked)) {
        if (c === null) continue;
        expect(
          c.holds,
          `${id} ${name}: creep ${c.creepSpeed.toExponential(2)} m/s, rms ${c.velocityRms.toExponential(2)} m/s`,
        ).toBe(true);
      }
    }
  });

  it("every preset locks its brakes once, without chatter, and stops cleanly", () => {
    for (const [id, v] of Object.entries(report.vehicles)) {
      const s = v.straightLine;
      expect(s.wheelLocked, id).toBe(true);
      expect(s.lockReleases, `${id}: lock chatter`).toBe(0);
      expect(s.lockedDecelRipple, `${id}: deceleration ripple`).toBeLessThan(0.01);
      expect(s.restSpeed, `${id}: spring-back`).toBeLessThan(0.5);
      expect(s.settledSpeed, `${id}: not at rest after the stop`).toBeLessThan(1e-4);
    }
  });

  it("every preset is stable across the timestep sweep", () => {
    for (const [id, v] of Object.entries(report.vehicles)) {
      const s = v.timestepSweep;
      expect(s.allFinite, `${id}: non-finite cell`).toBe(true);
      expect(s.allHold, `${id}: a cell crept while parked`).toBe(true);
      expect(s.cleanStops, `${id}: a cell chattered or did not come to rest`).toBe(true);
      expect(s.gradientSpreadDegPerG, `${id}: gradient spread`).toBeLessThan(0.05);
      expect(s.brakingDistanceSpread, `${id}: braking distance spread`).toBeLessThan(0.01);
      expect(s.stable, id).toBe(true);
    }
  });

  it("every preset answers the step steer promptly and finishes the lane change", () => {
    for (const [id, v] of Object.entries(report.vehicles)) {
      const s = v.stepSteer;
      expect(s.completed, `${id}: step steer did not complete`).toBe(true);
      // A spool (the kart) pushes well short of the 4 m/s² the linear
      // steer angle aims for; everything else lands near it.
      expect(s.latAccel, `${id}: lat accel ${s.latAccel}`).toBeGreaterThan(1.5);
      expect(s.latAccel, `${id}: lat accel ${s.latAccel}`).toBeLessThan(6);
      expect(s.yawRateResponseTime, `${id}: no yaw response`).not.toBeNull();
      expect(s.yawRateResponseTime!, `${id}: response ${s.yawRateResponseTime}`).toBeLessThan(0.8);
      expect(s.yawRateOvershoot, `${id}: overshoot ${s.yawRateOvershoot}`).toBeLessThan(0.5);
      const l = v.laneChange;
      // Every road car clears the ISO 3888-1 course at 60 km/h; a kart's
      // narrow lanes and a truck's roll need not reach 80.
      const sixty = l.attempts.find((a) => Math.abs(a.entrySpeed * 3.6 - 60) < 1);
      expect(sixty?.passed, `${id}: failed the lane change at 60 km/h`).toBe(true);
      expect(l.maxPassingSpeed, id).not.toBeNull();
    }
  });

  it("every preset stops cleanly on every surface, further the less grip it has", () => {
    for (const [id, v] of Object.entries(report.vehicles)) {
      // A vehicle with rear brakes only (the kart) swaps ends once the
      // surface is slippery enough; that is reported, not failed.
      const rearBrakesOnly = preset(id as PresetId).axles?.[0]?.maxBrakeTorque === 0;
      let last = v.straightLine.brakingDistance;
      for (const [name, s] of Object.entries(v.surfaces)) {
        if (s.spun) {
          expect(rearBrakesOnly, `${id} spun on ${name}`).toBe(true);
          continue;
        }
        expect(s.cleanStop, `${id} on ${name}: chatter or no rest`).toBe(true);
        expect(s.brakingDistance, `${id} on ${name}`).toBeGreaterThan(last);
        expect(s.brakingDistanceAbs, `${id} on ${name}: ABS`).toBeLessThan(s.brakingDistance);
        last = s.brakingDistance;
      }
    }
  });

  it("every preset understeers mildly and agrees with linear theory", () => {
    for (const [id, v] of Object.entries(report.vehicles)) {
      expect(v.model, id).toBe("fourWheel");
      // A spool (the kart's locked rear differential) pushes at low speed
      // and the push eases as the inner wheel unloads, so its fitted
      // gradient is slightly negative; every other preset understeers.
      const spool = preset(id as PresetId).drivetrain?.rear?.kind === "locked";
      expect(v.understeer.gradientDegPerG, id).toBeGreaterThan(spool ? -1 : 0);
      expect(v.understeer.gradientDegPerG, id).toBeLessThan(8);
      // The single-track model has no lateral load transfer and sits on the
      // linear theory; the four-wheel model adds the load-sensitivity effect
      // of transferring load across each axle, a fraction of a degree per g.
      const single = Math.abs(
        v.understeerSingleTrack.gradientDegPerG - v.understeer.analyticGradientDegPerG,
      );
      expect(
        single,
        `${id}: single-track ${v.understeerSingleTrack.gradientDegPerG} vs linear theory ${v.understeer.analyticGradientDegPerG} deg/g`,
      ).toBeLessThan(0.3);
      const four = Math.abs(v.understeer.gradientDegPerG - v.understeerSingleTrack.gradientDegPerG);
      expect(
        four,
        `${id}: four-wheel ${v.understeer.gradientDegPerG} vs single-track ${v.understeerSingleTrack.gradientDegPerG} deg/g`,
      ).toBeLessThan(0.6);
    }
  });
});
