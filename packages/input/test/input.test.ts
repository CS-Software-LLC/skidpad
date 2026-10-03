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
    expect(f2.clutch).toBe(0);
    expect(f2.gear).toBe(0);
    expect(k.attach(undefined)).toBeTypeOf("function");
  });

  it("shifts one gear per press and holds the clutch while pressed", () => {
    const k = new KeyboardInput();
    k.keyDown("KeyE");
    k.keyDown("KeyE"); // key repeat: still one shift
    expect(k.update(0.1).gear).toBe(1);
    k.keyUp("KeyE");
    k.keyDown("KeyE");
    expect(k.update(0.1).gear).toBe(2);
    k.keyUp("KeyE");
    for (let i = 0; i < 4; i++) {
      k.keyDown("KeyQ");
      k.keyUp("KeyQ");
    }
    expect(k.update(0.1).gear).toBe(-1);
    k.keyDown("KeyQ");
    k.keyUp("KeyQ");
    expect(k.update(0.1).gear).toBe(-1);
    k.keyDown("KeyC");
    expect(k.update(0.1).clutch).toBe(1);
    k.keyUp("KeyC");
    expect(k.update(0.1).clutch).toBe(0);
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

describe("calibration", () => {
  it("maps a centred axis through its dead zone and inversion", async () => {
    const { calibrateCentred, defaultCentredCalibration } = await import("../src/index.js");
    const c = { ...defaultCentredCalibration(), min: -0.9, max: 0.8, center: -0.05, deadzone: 0.1 };
    expect(calibrateCentred(-0.05, c)).toBe(0);
    expect(calibrateCentred(0.8, c)).toBeCloseTo(1);
    expect(calibrateCentred(-0.9, c)).toBeCloseTo(-1);
    expect(calibrateCentred(0.0, c)).toBe(0); // inside the dead zone
    expect(calibrateCentred(0.8, { ...c, invert: true })).toBeCloseTo(-1);
  });

  it("maps a pedal from rest to full travel and learns an inverted one", async () => {
    const { calibratePedal, AxisCalibrator } = await import("../src/index.js");
    const cal = new AxisCalibrator(false);
    cal.rest(0.95);
    for (const v of [0.95, 0.5, -0.9, -0.95]) cal.sample(v);
    const c = cal.result()!;
    expect(c.invert).toBe(true);
    expect(calibratePedal(0.95, c)).toBe(0);
    expect(calibratePedal(-0.95, c)).toBeCloseTo(1);
    expect(new AxisCalibrator(true).result()).toBeUndefined();
  });

  it("round-trips profiles through storage", async () => {
    const { builtinProfiles, loadProfiles, saveProfiles } = await import("../src/index.js");
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    expect(loadProfiles(storage)).toEqual([]);
    saveProfiles(storage, builtinProfiles());
    expect(loadProfiles(storage).map((p) => p.id)).toEqual(builtinProfiles().map((p) => p.id));
  });
});

describe("WheelInput", () => {
  const pads = (steer: number, throttle: number, brake: number, paddle = false) => [
    {
      id: "Logitech G PRO Racing Wheel (Vendor: 046d Product: 2111)",
      index: 0,
      connected: true,
      axes: [steer, 0, 0, 0],
      buttons: Array.from({ length: 8 }, (_, i) => ({ value: 0, pressed: paddle && i === 5 })),
    },
    {
      id: "Logitech PRO Racing Pedals (Vendor: 046d Product: 2112)",
      index: 1,
      connected: true,
      axes: [throttle, brake, -1],
      buttons: [],
    },
  ];

  it("matches the G PRO profile across the two devices and scales steering by the car's lock", async () => {
    const { WheelInput } = await import("../src/index.js");
    const w = new WheelInput({ steeringLockDeg: 14 * 35 });
    w.match(pads(0.5, 1, -1));
    expect(w.status.profile?.id).toBe("logitech-g-pro");
    expect(w.status.pedals?.index).toBe(1);
    const f = w.map()!;
    // Half of a 900° wheel, less the 2 % dead zone, over a 490° lock.
    const angle = ((0.5 - 0.02) / 0.98) * 450;
    expect(w.status.wheelAngleDeg).toBeCloseTo(angle);
    expect(f.steer).toBeCloseTo(angle / 490);
    expect(f.throttle).toBeCloseTo(1);
    expect(f.brake).toBe(0);
    expect(f.gear).toBe(0);
  });

  it("shifts on the paddle's rising edge only", async () => {
    const { WheelInput } = await import("../src/index.js");
    const w = new WheelInput();
    w.match(pads(0, -1, -1, true));
    expect(w.map()!.gear).toBe(1);
    expect(w.map()!.gear).toBe(1);
    w.match(pads(0, -1, -1, false));
    w.map();
    w.match(pads(0, -1, -1, true));
    expect(w.map()!.gear).toBe(2);
  });

  it("finds the axis the user is moving", async () => {
    const { AxisFinder } = await import("../src/index.js");
    const f = new AxisFinder();
    const pad = { id: "x", index: 0, connected: true, axes: [0, -1, 0], buttons: [] };
    f.sample("pedals", pad);
    f.sample("pedals", { ...pad, axes: [0.05, 0.9, 0] });
    expect(f.result()).toEqual({ device: "pedals", axis: 1, travel: 1.9, min: -1, max: 0.9 });
  });

  it("leaves out assigned axes and calibrates the one it finds", async () => {
    const { AxisFinder, calibratePedal } = await import("../src/index.js");
    const f = new AxisFinder();
    const pad = { id: "x", index: 0, connected: true, axes: [-1, 1, 0], buttons: [] };
    f.sample("pedals", pad);
    // The brake (axis 1, reads high at rest) goes all the way; the throttle
    // (axis 0, already assigned) is brushed even further by accident.
    f.sample("pedals", { ...pad, axes: [1, -0.9, 0] });
    expect(f.result()?.axis).toBe(0);
    const found = f.result(0.5, [{ device: "pedals", axis: 0 }])!;
    expect(found.axis).toBe(1);
    const brake = f.binding(found, false, 1);
    expect(brake.calibration.invert).toBe(true);
    expect(calibratePedal(1, brake.calibration)).toBe(0);
    expect(calibratePedal(-0.9, brake.calibration)).toBe(1);
  });

  it("leaves standard-mapping gamepads to GamepadInput", async () => {
    const { WheelInput } = await import("../src/index.js");
    const w = new WheelInput();
    const f310 = {
      id: "Logitech Gamepad F310 (STANDARD GAMEPAD Vendor: 046d Product: c21d)",
      index: 0,
      connected: true,
      mapping: "standard",
      axes: [0, 0, 0, 0],
      buttons: [],
    };
    expect(w.match([f310]).profile).toBeUndefined();
    expect(new WheelInput({ matchStandardPads: true }).match([f310]).profile?.id).toBe(
      "generic-wheel",
    );
  });

  it("does not take every Logitech device for a G PRO", async () => {
    const { WheelInput } = await import("../src/index.js");
    const pad = (id: string) => ({ id, index: 0, connected: true, axes: [0], buttons: [] });
    const profileOf = (id: string) => new WheelInput().match([pad(id)]).profile?.id;
    expect(profileOf("G29 Driving Force Racing Wheel (Vendor: 046d Product: c24f)")).toBe(
      "logitech-g29-g923",
    );
    expect(profileOf("PRO Racing Wheel for Xbox/PC (Vendor: 046d Product: c272)")).toBe(
      "logitech-g-pro",
    );
    expect(profileOf("Logitech Racing Wheel (Vendor: 046d Product: c272)")).toBe("logitech-g-pro");
  });
});

describe("gears", () => {
  it("keeps an automatic between reverse and drive", async () => {
    const { GearSelector, KeyboardInput } = await import("../src/index.js");
    const gears = new GearSelector({ mode: "automatic" });
    const k = new KeyboardInput({ gears });
    for (let i = 0; i < 5; i++) {
      k.keyDown("KeyE");
      k.keyUp("KeyE");
    }
    expect(k.update(1 / 60).gear).toBe(0);
    // One press of Q selects reverse, one of E drive again.
    k.keyDown("KeyQ");
    k.keyUp("KeyQ");
    expect(k.update(1 / 60).gear).toBe(-1);
    k.keyDown("KeyE");
    expect(gears.gear).toBe(0);
    // A manual counts gears up to its top gear.
    gears.mode = "manual";
    gears.maxGear = 3;
    for (let i = 0; i < 5; i++) gears.up();
    expect(gears.gear).toBe(3);
    gears.mode = "automatic";
    expect(gears.gear).toBe(0);
    gears.toggleReverse();
    expect(gears.gear).toBe(-1);
    gears.toggleReverse();
    expect(gears.gear).toBe(0);
  });

  it("shifts a gamepad with the bumpers and toggles reverse", async () => {
    const { GamepadInput, GearSelector } = await import("../src/index.js");
    const gears = new GearSelector({ mode: "automatic" });
    const g = new GamepadInput({ gears });
    const buttons = (...down: number[]) =>
      Array.from({ length: 16 }, (_, i) => ({ value: 0, pressed: down.includes(i) }));
    expect(g.map([0, 0], buttons(3)).gear).toBe(-1);
    expect(g.map([0, 0], buttons(3)).gear).toBe(-1); // held: one toggle
    expect(g.map([0, 0], buttons()).gear).toBe(-1);
    expect(g.map([0, 0], buttons(5)).gear).toBe(0);
    const manual = new GamepadInput();
    manual.map([0, 0], buttons(5));
    manual.map([0, 0], buttons());
    expect(manual.map([0, 0], buttons(5)).gear).toBe(2);
  });

  it("polls a standard gamepad, not the wheel, and says which", async () => {
    const { GamepadInput } = await import("../src/index.js");
    const pad = (id: string, mapping: string, steer: number) => ({
      id,
      index: 0,
      connected: true,
      mapping,
      axes: [steer, 0],
      buttons: [],
    });
    const wheel = pad("G29 Driving Force Racing Wheel", "", 0.9);
    const gamepad = pad("Xbox controller", "standard", -0.6);
    const nav = globalThis.navigator as unknown as Record<string, unknown> | undefined;
    const saved = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", {
      value: { ...nav, getGamepads: () => [wheel, gamepad] },
      configurable: true,
    });
    try {
      const g = new GamepadInput({ deadzone: 0, steerExponent: 1 });
      expect(g.poll()?.steer).toBeCloseTo(-0.6);
      expect(g.lastPad).toBe(gamepad);
    } finally {
      if (saved) Object.defineProperty(globalThis, "navigator", saved);
    }
  });
});

describe("InputMixer", () => {
  it("follows the device the player touched last, with one gear", async () => {
    const { InputMixer, GearSelector, KeyboardInput, TouchInput } = await import("../src/index.js");
    const gears = new GearSelector({ mode: "automatic" });
    const keyboard = new KeyboardInput({ gears });
    const touch = new TouchInput();
    const mixer = new InputMixer(
      [
        { name: "keyboard", read: (dt) => keyboard.update(dt) },
        { name: "touch", read: (dt) => touch.update(dt) },
      ],
      { gears },
    );
    mixer.update(1 / 60);
    expect(mixer.active).toBe("keyboard");
    // Touch the throttle: touch takes over once its pedal moves.
    touch.pointerDown(1, 0.8, 0.2);
    for (let i = 0; i < 10; i++) mixer.update(1 / 60);
    expect(mixer.active).toBe("touch");
    expect(mixer.update(1 / 60).throttle).toBeGreaterThan(0.5);
    // Holding it still does not lose it; the keyboard takes over when used.
    touch.pointerUp(1);
    keyboard.keyDown("ArrowLeft");
    for (let i = 0; i < 30; i++) mixer.update(1 / 60);
    expect(mixer.active).toBe("keyboard");
    expect(mixer.update(1 / 60).steer).toBeLessThan(-0.5);
    // A shift from any device is the car's gear.
    keyboard.keyDown("KeyQ");
    expect(mixer.update(1 / 60).gear).toBe(-1);
  });
});

describe("TouchInput", () => {
  it("steers from the strip and reads pedals from the column", async () => {
    const { TouchInput } = await import("../src/index.js");
    const t = new TouchInput();
    t.pointerDown(1, 0.25, 0.5);
    t.pointerMove(1, 0.35, 0.5); // 0.1 of a 0.2 travel
    t.pointerDown(2, 0.8, 0.2); // upper pedal column: throttle
    let f = t.update(1 / 60);
    expect(f.steer).toBeCloseTo(0.5);
    expect(f.throttle).toBeGreaterThan(0.5);
    expect(f.brake).toBe(0);
    t.pointerMove(2, 0.8, 0.9);
    f = t.update(1 / 60);
    expect(f.throttle).toBe(0);
    expect(f.brake).toBeGreaterThan(0.7);
    t.pointerUp(1);
    t.pointerUp(2);
    f = t.update(1 / 60);
    expect(Math.abs(f.steer)).toBeLessThan(0.5);
    for (let i = 0; i < 60; i++) f = t.update(1 / 60);
    expect(f.steer).toBe(0);
    expect(f.throttle).toBe(0);
  });
});

describe("force feedback", () => {
  it("scales torque to the device range with smoothing and clip statistics", async () => {
    const { FfbScaler } = await import("../src/index.js");
    const s = new FfbScaler({ maxTorque: 10, smoothing: 0, gain: 1, slewRate: Infinity });
    expect(s.scale(5, 1 / 60)).toBeCloseTo(0.5);
    expect(s.scale(-20, 1 / 60)).toBe(-1);
    expect(s.clipFraction).toBeCloseTo(0.5);
    s.invert = true;
    expect(s.scale(5, 1 / 60)).toBeCloseTo(-0.5);
    const smooth = new FfbScaler({ maxTorque: 10, smoothing: 0.1, gain: 1, slewRate: Infinity });
    expect(smooth.scale(10, 0.01)).toBeCloseTo(0.1);
  });

  it("defaults to half gain, limits the output and its rate of change", async () => {
    const { FfbScaler } = await import("../src/index.js");
    const s = new FfbScaler({ maxTorque: 10, smoothing: 0 });
    expect(s.gain).toBe(0.5);
    // Full-scale demand is reached no faster than 5 full scales per second.
    expect(s.scale(100, 0.1)).toBeCloseTo(0.5);
    expect(s.scale(100, 0.1)).toBeCloseTo(1);
    const capped = new FfbScaler({ maxTorque: 10, smoothing: 0, slewRate: Infinity, limit: 0.3 });
    expect(capped.scale(100, 1 / 60)).toBeCloseTo(0.3);
    expect(capped.clipFraction).toBe(1);
  });

  it("latches the output at zero when the wheel runs away under force", async () => {
    const { FfbScaler } = await import("../src/index.js");
    const dt = 1 / 120;
    const s = new FfbScaler({ maxTorque: 10, smoothing: 0, slewRate: Infinity });
    // The wheel spins away from the centre at 20 rad/s while being pushed.
    let angle = 0.2;
    let out = 0;
    for (let i = 0; i < 30; i++) {
      out = s.scale(5, dt, angle);
      angle += 20 * dt;
    }
    expect(s.tripped).toMatch(/ran away/);
    expect(out).toBe(0);
    s.rearm();
    expect(s.tripped).toBeUndefined();
    expect(s.scale(5, dt, 0)).toBeCloseTo(0.25);
    // A fast return to the centre (hands off, self-centring) does not trip.
    const r = new FfbScaler({ maxTorque: 10, smoothing: 0, slewRate: Infinity });
    angle = 3;
    for (let i = 0; i < 30; i++) {
      r.scale(-5, dt, angle);
      angle -= 20 * dt;
    }
    expect(r.tripped).toBeUndefined();
    // Nor does a fast outward move with no force on the wheel.
    const z = new FfbScaler({ maxTorque: 10, smoothing: 0, slewRate: Infinity });
    angle = 0.2;
    for (let i = 0; i < 30; i++) {
      z.scale(0, dt, angle);
      angle += 20 * dt;
    }
    expect(z.tripped).toBeUndefined();
  });

  it("drives a Logitech device over a fake WebHID and logs the exchange", async () => {
    const { LogitechWebHidSink } = await import("../src/index.js");
    const sent: Array<{ id: number; data: number[] }> = [];
    let listener: ((e: { reportId: number; data: DataView }) => void) | undefined;
    const device = {
      opened: false,
      vendorId: 0x046d,
      productId: 0x2111,
      productName: "PRO Racing Wheel",
      async open() {
        this.opened = true;
      },
      async close() {
        this.opened = false;
      },
      async sendReport(id: number, data: Uint8Array) {
        const bytes = Array.from(data);
        sent.push({ id, data: bytes });
        // Answer HID++ requests: feature index 3 for the root query, slot
        // ids 1, 2, 3, 4 for downloads, echo otherwise.
        const reply = new Uint8Array(19);
        reply[0] = 0xff;
        reply[1] = bytes[1]!;
        reply[2] = bytes[2]!;
        if (bytes[1] === 0 && bytes[2]! >> 4 === 0) reply[3] = 3;
        else if (bytes[1] === 3 && bytes[2]! >> 4 === 2)
          reply[3] = sent.filter((s) => s.data[1] === 3 && s.data[2]! >> 4 === 2).length;
        queueMicrotask(() => listener?.({ reportId: 0x11, data: new DataView(reply.buffer) }));
      },
      addEventListener(_t: "inputreport", l: typeof listener) {
        listener = l;
      },
      removeEventListener() {
        listener = undefined;
      },
    };
    const lines: string[] = [];
    const defaults = new LogitechWebHidSink();
    expect(defaults.maxOutput).toBe(0.4);
    expect(defaults.maxTorque).toBeCloseTo(4.4); // 40 % of a G PRO's 11 N·m
    const sink = new LogitechWebHidSink({
      log: (l) => lines.push(l),
      minInterval: 0,
      gain: 1,
      maxOutput: 1,
      watchdog: 0.05,
    });
    await sink.attach(device);
    expect(sink.connected).toBe(true);
    expect(lines.some((l) => l.includes("feature 0x8123 at index 3"))).toBe(true);
    const ff = (func: number) => sent.filter((s) => s.data[1] === 3 && s.data[2]! >> 4 === func);
    // Root query, get info, reset, zero centring spring, aperture, gains,
    // then three effects, each downloaded and started.
    expect(sent.length).toBe(12);
    // The first download replaces the firmware's centring spring with a
    // zero-strength one, autostarted, in a very long report (18 params).
    const spring = ff(2)[0]!;
    expect(spring.id).toBe(0x12);
    expect(spring.data[3]).toBe(0); // new slot
    expect(spring.data[4]).toBe(0x86); // spring | autostart
    expect(spring.data.slice(9, 21).every((b) => b === 0)).toBe(true); // zero coefficients
    expect(lines.some((l) => l.includes("centring spring set to zero"))).toBe(true);
    // Full gain, no boost.
    expect(ff(8)[0]!.data.slice(3, 7)).toEqual([0xff, 0xff, 0, 0]);
    // Each new effect is started with the play state, 0x02.
    expect(ff(3).map((s) => s.data.slice(3, 5))).toEqual([
      [2, 2],
      [3, 2],
      [4, 2],
    ]);
    await sink.update({ torque: 5.5, damping: 0, friction: 0 }, 1);
    const last = sent[sent.length - 1]!;
    expect(last.id).toBe(0x11);
    expect(last.data[1]).toBe(3); // feature index
    expect(last.data[2] >> 4).toBe(2); // download effect
    expect(last.data[3]).toBe(2); // slot of the constant effect
    expect(last.data[4]).toBe(0); // constant force
    // Half of full output to the right is a negative HID++ level on a G PRO.
    const level = (((last.data[9]! << 8) | last.data[10]!) << 16) >> 16;
    expect(level).toBeCloseTo(-0x7fff / 2, -2);
    // With no further updates the watchdog zeroes the force.
    await new Promise((r) => setTimeout(r, 300));
    expect(lines.some((l) => l.includes("watchdog"))).toBe(true);
    const zeroed = sent[sent.length - 1]!;
    expect(zeroed.data[9]).toBe(0);
    expect(zeroed.data[10]).toBe(0);
    // A HID++ 2.0 error reply resolves the request it names and is logged.
    listener?.({
      reportId: 0x11,
      data: new DataView(
        new Uint8Array([0xff, 0xff, 3, 0x2a, 0x02, ...new Array(14).fill(0)]).buffer,
      ),
    });
    await sink.stop();
    expect(
      ff(3)
        .slice(-3)
        .map((s) => s.data.slice(3, 5)),
    ).toEqual([
      [2, 1],
      [3, 1],
      [4, 1],
    ]);
    await sink.disconnect();
    expect(device.opened).toBe(false);
    // HID++ 2.0 commands never use the short report, which a G PRO refuses.
    expect(sent.some((s) => s.id === 0x10)).toBe(false);
  });

  it("picks the wheel interface that declares HID++ reports", async () => {
    const { LogitechWebHidSink, pickHidppDevice } = await import("../src/index.js");
    const iface = (reports: number[], usagePage: number) => {
      const sent: number[] = [];
      return {
        sent,
        opened: false,
        vendorId: 0x046d,
        productId: 0xc272,
        productName: "PRO Racing Wheel for Xbox/PC",
        collections: [{ usagePage, outputReports: reports.map((reportId) => ({ reportId })) }],
        async open() {
          this.opened = true;
        },
        async close() {
          this.opened = false;
        },
        async sendReport(id: number) {
          sent.push(id);
          if (!reports.includes(id)) throw new Error("NotAllowedError");
        },
        addEventListener() {},
        removeEventListener() {},
      };
    };
    const gamepad = iface([], 0x01);
    const hidpp = iface([0x12], 0xff43);
    expect(pickHidppDevice([gamepad, hidpp])).toBe(hidpp);
    const lines: string[] = [];
    const sink = new LogitechWebHidSink({ log: (l) => lines.push(l) });
    // The fake never answers, so the force path cannot be set up and the
    // sink says so rather than reporting a connected wheel that does nothing.
    await expect(
      sink.connect({
        requestDevice: async () => [gamepad],
        getDevices: async () => [gamepad, hidpp],
      }),
    ).rejects.toThrow(/feature 0x8123 not reported/);
    expect(sink.connected).toBe(false);
    expect(sink.ready).toBe(false);
    expect(gamepad.sent).toEqual([]);
    // Only very long declared: everything goes out as 0x12.
    expect(hidpp.sent).toEqual([0x12]);
    expect(lines.some((l) => l.includes("output reports: 12"))).toBe(true);
    expect(lines.some((l) => l.includes("no force path"))).toBe(true);
  });

  it("picks the protocol and peak torque from the product id", async () => {
    const { LogitechWebHidSink, logitechWheel } = await import("../src/index.js");
    const fake = (productId: number) => {
      const sent: { id: number; data: number[] }[] = [];
      return {
        sent,
        opened: false,
        vendorId: 0x046d,
        productId,
        productName: "wheel",
        async open() {
          this.opened = true;
        },
        async close() {
          this.opened = false;
        },
        async sendReport(id: number, data: Uint8Array) {
          sent.push({ id, data: Array.from(data) });
        },
        addEventListener() {},
        removeEventListener() {},
      };
    };
    expect(logitechWheel(0xc24f)?.protocol).toBe("classic");
    expect(logitechWheel(0xc272)?.protocol).toBe("hidpp");

    // A G29 speaks the classic protocol and peaks at 2.5 N·m, not 11.
    const g29 = fake(0xc24f);
    const sink = new LogitechWebHidSink({ minInterval: 0, gain: 1, maxOutput: 1 });
    expect(sink.protocol).toBe("hidpp"); // the fallback, before a device is known
    await sink.attach(g29);
    expect(sink.protocol).toBe("classic");
    expect(sink.wheel?.name).toBe("G29");
    expect(sink.peakTorque).toBe(2.5);
    expect(sink.maxTorque).toBe(2.5);
    expect(sink.scaler.maxTorque).toBe(2.5);
    expect(sink.ready).toBe(true);
    expect(g29.sent.every((s) => s.id === 0)).toBe(true);
    // Half the peak is half the classic range, whatever the HID++ peak is.
    await sink.update({ torque: 1.25, damping: 0, friction: 0 }, 1);
    const last = g29.sent[g29.sent.length - 1]!;
    expect(last.data.slice(0, 2)).toEqual([0x11, 0x08]);
    expect(Math.abs(last.data[2]! - 0x80)).toBeCloseTo(0x7f / 2, -0.5);
    await sink.disconnect();
    expect(sink.ready).toBe(false);

    // Forcing a protocol is still possible, and the torque follows it.
    const forced = new LogitechWebHidSink({ protocol: "classic" });
    expect(forced.peakTorque).toBe(2.5);
    forced.protocol = "hidpp";
    expect(forced.peakTorque).toBe(11);
    expect(forced.scaler.maxTorque).toBeCloseTo(4.4);
  });
});
