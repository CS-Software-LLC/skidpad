import { describe, expect, it } from "vitest";
import { applyDeadzone, responseCurve, Ramp, KeyboardInput, GamepadInput } from "../src/index.js";

describe("filters", () => {
  it("deadzone rescales to full range", () => {
    expect(applyDeadzone(0.05, 0.1)).toBe(0);
    expect(applyDeadzone(1, 0.1)).toBe(1);
    expect(applyDeadzone(-1, 0.1)).toBe(-1);
    expect(applyDeadzone(0.55, 0.1)).toBeCloseTo(0.5);
  });

  it("response curve keeps sign and endpoints", () => {
    expect(responseCurve(0.5, 2)).toBeCloseTo(0.25);
    expect(responseCurve(-0.5, 2)).toBeCloseTo(-0.25);
    expect(responseCurve(1, 3)).toBe(1);
  });

  it("ramp rises, falls, and crosses zero at the fall rate", () => {
    const r = new Ramp({ riseRate: 2, fallRate: 4 });
    expect(r.update(1, 0.25)).toBeCloseTo(0.5);
    expect(r.update(1, 1)).toBe(1);
    expect(r.update(0, 0.125)).toBeCloseTo(0.5);
    expect(r.update(-1, 0.125)).toBeCloseTo(0);
    expect(r.update(-1, 0.25)).toBeCloseTo(-0.5);
  });
});

describe("KeyboardInput", () => {
  it("produces analog-like frames from held keys", () => {
    const k = new KeyboardInput();
    k.keyDown("ArrowUp");
    k.keyDown("KeyD");
    const f1 = k.update(0.1);
    expect(f1.throttle).toBeGreaterThan(0);
    expect(f1.throttle).toBeLessThan(1);
    expect(f1.steer).toBeGreaterThan(0);
    k.keyUp("ArrowUp");
    k.keyDown("Space");
    const f2 = k.update(1);
    expect(f2.throttle).toBe(0);
    expect(f2.steer).toBe(1);
    expect(f2.handbrake).toBe(1);
    expect(k.attach(undefined)).toBeTypeOf("function");
  });
});

describe("GamepadInput", () => {
  it("maps the standard layout", () => {
    const g = new GamepadInput({ deadzone: 0.1, steerExponent: 1 });
    const buttons = Array.from({ length: 8 }, () => ({ value: 0, pressed: false }));
    buttons[7] = { value: 0.8, pressed: true };
    buttons[0] = { value: 1, pressed: true };
    const f = g.map([0.55, 0, 0, 0], buttons);
    expect(f.steer).toBeCloseTo(0.5);
    expect(f.throttle).toBeCloseTo(0.8);
    expect(f.brake).toBe(0);
    expect(f.handbrake).toBe(1);
  });

  it("supports pedal axes in the −1…1 convention", () => {
    const g = new GamepadInput({ throttleAxis: 2, brakeAxis: 3 });
    const f = g.map([0, 0, 1, -1], []);
    expect(f.throttle).toBe(1);
    expect(f.brake).toBe(0);
    expect(g.poll()).toBeUndefined();
  });
});
