/**
 * Hands-off stability of the force-feedback loop (polish item 6): release
 * the rim and check it comes back without a growing oscillation. The
 * cases asserted here are the ones that hold with today's defaults; the
 * full matrix, including the ones that do not yet, is in
 * docs/validation/ffb-hands-off.md (set FFB_REPORT=1 to print it).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { init, type Skidpad } from "@skidpad/core";
import { preset, presetIds } from "@skidpad/presets";
import { halfCyclePeaks, releaseVerdict, releaseWheel } from "./ffbLoop.js";

let sp: Skidpad;
beforeAll(async () => {
  sp = await init();
});

const deg = (d: number) => (d * Math.PI) / 180;

describe("hands-off force feedback", () => {
  it("lets every preset's wheel settle when parked", () => {
    for (const id of presetIds) {
      const tr = releaseWheel(sp, preset(id), { speed: 0 });
      expect(releaseVerdict(tr), id).toBe("settled");
      // Never further out than where it was let go.
      expect(Math.max(...halfCyclePeaks(tr.angle)), id).toBeLessThanOrEqual(deg(90.5));
    }
  });

  it("returns a parked wheel to centre on the cars with kingpin inclination", () => {
    for (const id of ["hatchbackFwd", "crossoverEv"] as const) {
      const tr = releaseWheel(sp, preset(id), { speed: 0 });
      expect(Math.abs(tr.angle.at(-1)!), id).toBeLessThan(deg(25));
    }
  });

  it("settles from 90° at 30 km/h on the hatchback, crossover and open-wheeler", () => {
    for (const id of ["hatchbackFwd", "crossoverEv", "openWheeler"] as const) {
      const tr = releaseWheel(sp, preset(id), { speed: 30 / 3.6 });
      expect(releaseVerdict(tr), id).toBe("settled");
      expect(Math.abs(tr.angle.at(-1)!), id).toBeLessThan(deg(5));
    }
  });

  it("catches the oscillation when the column damping and friction are taken away", () => {
    // The harness's own check: without the firmware's damper the parked
    // wheel's swing grows through the 60 Hz loop.
    const tr = releaseWheel(sp, preset("hatchbackFwd"), { speed: 0, columnScale: 0 });
    expect(releaseVerdict(tr)).toBe("growing");
  });
});

describe.runIf(process.env.FFB_REPORT)("hands-off report", () => {
  it("prints the release matrix", () => {
    const scalers = {
      today: {},
      "slew 50, smoothing 3 ms": { slewRate: 50, smoothing: 0.003 },
    };
    for (const [label, scaler] of Object.entries(scalers)) {
      for (const columnScale of [1, 2, 4]) {
        const rows = presetIds.map((id) => {
          const cells = [0, 30, 100].map((kmh) =>
            releaseVerdict(
              releaseWheel(sp, preset(id), {
                speed: kmh / 3.6,
                releaseAngle: deg(kmh === 100 ? 30 : 90),
                columnScale,
                scaler,
              }),
            ),
          );
          return `| ${id} | ${cells.join(" | ")} |`;
        });
        console.log(`\n${label}, column ×${columnScale}\n${rows.join("\n")}`);
      }
    }
  }, 300_000);
});
