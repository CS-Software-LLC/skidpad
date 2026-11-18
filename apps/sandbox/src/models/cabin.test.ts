/**
 * Cockpit view layout: every preset's eye point sits inside its own
 * bodywork, the road cars' steering wheel is in reach and above the floor,
 * and the tub cut stays clear of the wheel arches.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { init, type Skidpad } from "@skidpad/core";
import { preset, presetIds } from "@skidpad/presets";
import { cabinFrame, cabinPoint, cockpitLayout, modelDimensions, notchProfile } from "./cabin.js";

let sp: Skidpad;
beforeAll(async () => {
  sp = await init();
});

const dims = (id: (typeof presetIds)[number]) =>
  modelDimensions(sp.completeDefinition(preset(id)), id);

describe("cockpit layout", () => {
  it("puts each road car's eyes inside the greenhouse, on the driver's (left) side", () => {
    for (const id of presetIds) {
      const d = dims(id);
      const f = cabinFrame(id, d);
      if (!f) continue;
      const { eye } = cockpitLayout(id, d);
      expect(eye[1], id).toBeGreaterThan(f.belt + 0.15);
      expect(eye[1], id).toBeLessThan(f.roof - 0.12);
      expect(eye[0], id).toBeLessThan(f.frontTop);
      expect(eye[0], id).toBeGreaterThan(f.rearTop);
      expect(eye[2], id).toBeLessThan(-0.25);
      // Inside the side glass at eye height.
      const v = (eye[1] - f.belt) / (f.roof - f.belt);
      expect(Math.abs(eye[2]), id).toBeLessThan(Math.abs(cabinPoint(f, 0.5, v, 1)[2]) - 0.15);
    }
  });

  it("puts the road cars' steering wheel ahead of the eyes, above the floor, behind the dash", () => {
    for (const id of presetIds) {
      const d = dims(id);
      const f = cabinFrame(id, d);
      if (!f) continue;
      const { eye, wheel } = cockpitLayout(id, d);
      expect(wheel, id).not.toBeNull();
      const floor = f.tub?.floor ?? f.belt - 0.44;
      expect(wheel!.center[0] - eye[0], id).toBeGreaterThan(0.35);
      expect(wheel!.center[0], id).toBeLessThan(f.frontBase - 0.3);
      expect(wheel!.center[1] - wheel!.radius, id).toBeGreaterThan(floor + 0.15);
    }
  });

  it("keeps the eyes of the kart and single-seater above their seats", () => {
    for (const id of ["kart", "openWheeler"] as const) {
      const d = dims(id);
      const { eye } = cockpitLayout(id, d);
      expect(eye[0]).toBeLessThan(d.frontAxle);
      expect(eye[0]).toBeGreaterThan(d.rearAxle);
      expect(eye[1]).toBeGreaterThan(0.6);
      expect(eye[2]).toBe(0);
    }
  });

  it("cuts the tub between the wheel arches", () => {
    for (const id of presetIds) {
      const d = dims(id);
      const tub = cabinFrame(id, d)?.tub;
      if (!tub) continue;
      // Arches are radius + 0.12 m; the bevel adds 0.025 m.
      expect(tub.front, id).toBeLessThan(d.frontAxle - d.frontRadius - 0.15);
      expect(tub.rear, id).toBeGreaterThan(d.rearAxle + d.rearRadius + 0.15);
      expect(tub.front, id).toBeGreaterThan(tub.rear + 1);
    }
  });
});

describe("notchProfile", () => {
  it("cuts a tub across segments and keeps the rest of the profile", () => {
    const top: Array<[number, number]> = [
      [-2, 0.6],
      [-1.8, 0.8],
      [0.5, 0.8],
      [1, 0.7],
      [2, 0.5],
    ];
    expect(notchProfile(top, { floor: 0.3, rear: -1, front: 0.75 })).toEqual([
      [-2, 0.6],
      [-1.8, 0.8],
      [-1, 0.8],
      [-1, 0.3],
      [0.75, 0.3],
      [0.75, 0.75],
      [1, 0.7],
      [2, 0.5],
    ]);
  });
});
