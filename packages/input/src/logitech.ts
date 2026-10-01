/**
 * Logitech wheels over WebHID (Chromium-based browsers only).
 *
 * Two protocols, both reconstructed from the public open-source drivers
 * (the Linux `hid-logitech-hidpp` force-feedback feature and `lg4ff`) rather
 * than from Logitech documentation. Every constant below is marked
 * [VERIFY] until it has been exercised on hardware; the sink keeps a
 * diagnostics log of every report sent and received so a test session can
 * report exactly what happened.
 *
 * - `hidpp`: HID++ 2.0 feature 0x8123 (force feedback), the path of the
 *   G PRO, G923 and G920. A constant-force effect is downloaded once and
 *   then updated every host step.
 * - `classic`: the 7-byte command protocol of the G29 / G27 / G25 and of the
 *   G923 in its compatibility mode, where a constant force is a single
 *   output report.
 *
 * The browser only exposes a device after `requestDevice()` from a user
 * gesture, and only report collections the page is allowed to use; the
 * wheel's gamepad collection stays with the Gamepad API.
 */
import type { FfbFrame, FfbSink } from "./ffb.js";
import { FfbScaler, type FfbScalerOptions } from "./ffb.js";

/** The parts of WebHID this module uses; typed locally to avoid a lib dependency. */
export interface HidDeviceLike {
  readonly opened: boolean;
  readonly vendorId: number;
  readonly productId: number;
  readonly productName: string;
  open(): Promise<void>;
  close(): Promise<void>;
  sendReport(reportId: number, data: Uint8Array): Promise<void>;
  addEventListener(type: "inputreport", listener: (event: HidInputReportEventLike) => void): void;
  removeEventListener(
    type: "inputreport",
    listener: (event: HidInputReportEventLike) => void,
  ): void;
}

export interface HidInputReportEventLike {
  reportId: number;
  data: DataView;
}

export interface HidLike {
  requestDevice(options: {
    filters: Array<{ vendorId?: number; productId?: number; usagePage?: number; usage?: number }>;
  }): Promise<HidDeviceLike[]>;
  getDevices(): Promise<HidDeviceLike[]>;
}

export const LOGITECH_VENDOR_ID = 0x046d;

/** `navigator.hid` when the browser has WebHID, else undefined. */
export function webHid(): HidLike | undefined {
  const nav = globalThis.navigator as (Navigator & { hid?: HidLike }) | undefined;
  return nav?.hid;
}

export type LogitechProtocol = "hidpp" | "classic";

export interface LogitechSinkOptions extends FfbScalerOptions {
  protocol?: LogitechProtocol;
  /** Rotation to ask the wheel for, degrees lock to lock. */
  rotationDeg?: number;
  /**
   * How a running constant force is changed over HID++: `modify` re-sends
   * the download command with the effect's slot id, `recreate` destroys and
   * downloads a fresh effect every update [VERIFY which the firmware wants].
   */
  updateMode?: "modify" | "recreate";
  /** Called with each diagnostics line. */
  log?: (line: string) => void;
  /** Lowest interval between output reports, s (the device's rate). */
  minInterval?: number;
}

// --- HID++ 2.0 constants [VERIFY] -------------------------------------------
/** Short report: 7 bytes including the id. */
const HIDPP_SHORT = 0x10;
/** Long report: 20 bytes including the id. */
const HIDPP_LONG = 0x11;
/** Device index of a directly attached (wired) device. */
const HIDPP_DEVICE_INDEX = 0xff;
/** Software id in the low nibble of the function byte; any non-zero value. */
const HIDPP_SOFTWARE_ID = 0x0a;
/** Root feature: index 0, function 0 = getFeature(featureId). */
const HIDPP_ROOT_INDEX = 0x00;
const HIDPP_FEATURE_FORCE_FEEDBACK = 0x8123;
/** Function indices of feature 0x8123. */
const FF_GET_INFO = 0;
const FF_RESET_ALL = 1;
const FF_DOWNLOAD_EFFECT = 2;
const FF_SET_EFFECT_STATE = 3;
const FF_DESTROY_EFFECT = 4;
const FF_SET_APERTURE = 6;
const FF_SET_GLOBAL_GAINS = 8;
/** Effect types. */
const FF_EFFECT_CONSTANT = 0x00;
const FF_EFFECT_DAMPER = 0x07;
const FF_EFFECT_FRICTION = 0x08;
const FF_EFFECT_AUTOSTART = 0x80;
const FF_STATE_PLAY = 0x01;
const FF_STATE_STOP = 0x00;

// --- classic protocol constants [VERIFY] -------------------------------------
/** Report id of the 7-byte command reports. */
const CLASSIC_REPORT_ID = 0x00;
/** Command: download and play a force in slot 1. */
const CLASSIC_SLOT1_PLAY = 0x11;
/** Force type: constant. */
const CLASSIC_FORCE_CONSTANT = 0x08;
/** Extended command prefix and the set-range sub-command. */
const CLASSIC_EXTENDED = 0xf8;
const CLASSIC_SET_RANGE = 0x81;
/** Autocentre off. */
const CLASSIC_AUTOCENTER_OFF = 0xf5;
/** Stop slot 1. */
const CLASSIC_SLOT1_STOP = 0x13;

function hex(bytes: ArrayLike<number>): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");
}

/**
 * Force-feedback sink for Logitech wheels over WebHID. Construct, then
 * `connect()` from a click handler.
 */
export class LogitechWebHidSink implements FfbSink {
  readonly name: string;
  readonly maxTorque: number;
  protocol: LogitechProtocol;
  readonly scaler: FfbScaler;
  private device: HidDeviceLike | undefined;
  private featureIndex = 0;
  private slot: number | undefined;
  private damperSlot: number | undefined;
  private frictionSlot: number | undefined;
  private pending: Array<(data: Uint8Array) => void> = [];
  private lastSent = -Infinity;
  private readonly minInterval: number;
  private readonly rotationDeg: number;
  private readonly updateMode: "modify" | "recreate";
  private readonly log: (line: string) => void;
  private readonly lines: string[] = [];
  private readonly onReport = (e: HidInputReportEventLike): void => {
    const data = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
    this.record(`<- id ${e.reportId.toString(16)} ${hex(data)}`);
    if (e.reportId === HIDPP_SHORT || e.reportId === HIDPP_LONG) {
      const waiter = this.pending.shift();
      waiter?.(data);
    }
  };

  constructor(options: LogitechSinkOptions = {}) {
    this.protocol = options.protocol ?? "hidpp";
    this.name = `Logitech (${this.protocol})`;
    // A direct-drive G PRO peaks at about 11 N·m; belt wheels 2 to 3.
    this.maxTorque = options.maxTorque ?? (this.protocol === "hidpp" ? 11 : 2.5);
    this.scaler = new FfbScaler({ ...options, maxTorque: this.maxTorque });
    this.rotationDeg = options.rotationDeg ?? 900;
    this.updateMode = options.updateMode ?? "modify";
    this.minInterval = options.minInterval ?? 1 / 120;
    this.log = options.log ?? (() => {});
  }

  get connected(): boolean {
    return this.device?.opened ?? false;
  }

  /** The diagnostics log, newest last (at most 400 lines kept). */
  get diagnostics(): readonly string[] {
    return this.lines;
  }

  private record(line: string): void {
    this.lines.push(line);
    if (this.lines.length > 400) this.lines.shift();
    this.log(line);
  }

  /**
   * Ask the browser for a Logitech device (a permission prompt; must run
   * inside a user gesture), open it and prepare the force effects.
   */
  async connect(hid: HidLike | undefined = webHid()): Promise<void> {
    if (!hid) throw new Error("WebHID is not available in this browser (Chromium only)");
    const devices = await hid.requestDevice({ filters: [{ vendorId: LOGITECH_VENDOR_ID }] });
    const device = devices[0];
    if (!device) throw new Error("no device chosen");
    await this.attach(device);
  }

  /** Use an already-permitted device (from `hid.getDevices()`). */
  async attach(device: HidDeviceLike): Promise<void> {
    this.device = device;
    if (!device.opened) await device.open();
    device.addEventListener("inputreport", this.onReport);
    this.record(
      `opened ${device.productName} (${device.vendorId.toString(16)}:${device.productId.toString(16)}), protocol ${this.protocol}`,
    );
    if (this.protocol === "hidpp") await this.setupHidpp();
    else await this.setupClassic();
  }

  // --- HID++ ------------------------------------------------------------------

  private async send(reportId: number, data: Uint8Array): Promise<void> {
    if (!this.device) return;
    this.record(`-> id ${reportId.toString(16)} ${hex(data)}`);
    await this.device.sendReport(reportId, data);
  }

  /** Send a HID++ command and wait for the matching response (or time out). */
  private async hidpp(featureIndex: number, func: number, params: number[]): Promise<Uint8Array> {
    const long = params.length > 3;
    const data = new Uint8Array(long ? 19 : 6);
    data[0] = HIDPP_DEVICE_INDEX;
    data[1] = featureIndex;
    data[2] = ((func & 0x0f) << 4) | HIDPP_SOFTWARE_ID;
    params.forEach((p, i) => {
      data[3 + i] = p & 0xff;
    });
    const response = new Promise<Uint8Array>((resolve) => {
      const timer = setTimeout(() => {
        const i = this.pending.indexOf(resolve);
        if (i >= 0) this.pending.splice(i, 1);
        this.record("   (no response within 250 ms)");
        resolve(new Uint8Array(0));
      }, 250);
      this.pending.push((d) => {
        clearTimeout(timer);
        resolve(d);
      });
    });
    await this.send(long ? HIDPP_LONG : HIDPP_SHORT, data);
    return response;
  }

  private async setupHidpp(): Promise<void> {
    const r = await this.hidpp(HIDPP_ROOT_INDEX, 0, [
      HIDPP_FEATURE_FORCE_FEEDBACK >> 8,
      HIDPP_FEATURE_FORCE_FEEDBACK & 0xff,
    ]);
    // Response params: [featureIndex, featureType, featureVersion].
    this.featureIndex = r[3] ?? 0;
    if (this.featureIndex === 0) {
      this.record(
        "force-feedback feature 0x8123 not reported; the wheel may be in a different mode or need the classic protocol",
      );
      return;
    }
    this.record(`feature 0x8123 at index ${this.featureIndex}`);
    await this.hidpp(this.featureIndex, FF_GET_INFO, []);
    await this.hidpp(this.featureIndex, FF_RESET_ALL, []);
    await this.hidpp(this.featureIndex, FF_SET_APERTURE, [
      this.rotationDeg >> 8,
      this.rotationDeg & 0xff,
    ]);
    await this.hidpp(this.featureIndex, FF_SET_GLOBAL_GAINS, [0xff, 0xff, 0xff, 0xff]);
    this.slot = await this.download(FF_EFFECT_CONSTANT, 0);
    this.damperSlot = await this.download(FF_EFFECT_DAMPER, 0);
    this.frictionSlot = await this.download(FF_EFFECT_FRICTION, 0);
  }

  /** Effect parameters: type, duration (0 = infinite), delay, then level. */
  private effectParams(type: number, level: number, slot?: number): number[] {
    const l = Math.round(Math.max(-1, Math.min(1, level)) * 0x7fff) & 0xffff;
    const head = slot === undefined ? type | FF_EFFECT_AUTOSTART : slot;
    return [head, 0, 0, 0, 0, l >> 8, l & 0xff, 0, 0, 0, 0, 0, 0, 0, 0];
  }

  private async download(type: number, level: number): Promise<number | undefined> {
    const r = await this.hidpp(
      this.featureIndex,
      FF_DOWNLOAD_EFFECT,
      this.effectParams(type, level),
    );
    const slot = r[3];
    this.record(`effect type ${type.toString(16)} -> slot ${slot ?? "?"}`);
    return slot;
  }

  // --- classic -----------------------------------------------------------------

  private async setupClassic(): Promise<void> {
    await this.send(CLASSIC_REPORT_ID, new Uint8Array([CLASSIC_AUTOCENTER_OFF, 0, 0, 0, 0, 0, 0]));
    const range = Math.max(40, Math.min(900, Math.round(this.rotationDeg)));
    await this.send(
      CLASSIC_REPORT_ID,
      new Uint8Array([CLASSIC_EXTENDED, CLASSIC_SET_RANGE, range & 0xff, range >> 8, 0, 0, 0]),
    );
  }

  // --- frames -------------------------------------------------------------------

  async update(frame: FfbFrame, dt: number): Promise<void> {
    if (!this.device?.opened) return;
    const level = this.scaler.scale(frame.torque, dt);
    const now = performance.now() / 1000;
    if (now - this.lastSent < this.minInterval) return;
    this.lastSent = now;
    if (this.protocol === "classic") {
      // 0x80 is zero force; the sign convention is [VERIFY].
      const x = Math.round(0x80 - level * 0x7f) & 0xff;
      await this.send(
        CLASSIC_REPORT_ID,
        new Uint8Array([CLASSIC_SLOT1_PLAY, CLASSIC_FORCE_CONSTANT, x, 0x80, 0, 0, 0]),
      );
      return;
    }
    if (this.featureIndex === 0) return;
    if (this.updateMode === "modify" && this.slot !== undefined) {
      await this.hidpp(
        this.featureIndex,
        FF_DOWNLOAD_EFFECT,
        this.effectParams(FF_EFFECT_CONSTANT, level, this.slot),
      );
    } else {
      if (this.slot !== undefined) {
        await this.hidpp(this.featureIndex, FF_DESTROY_EFFECT, [this.slot]);
      }
      this.slot = await this.download(FF_EFFECT_CONSTANT, level);
    }
    // Damping and friction scale with the definition's column values.
    void frame.damping;
    void frame.friction;
  }

  /** Send a short pulse for the setup panel's "test" button. */
  async pulse(level = 0.3, ms = 300): Promise<void> {
    await this.update({ torque: level * this.maxTorque, damping: 0, friction: 0 }, 1);
    await new Promise((r) => setTimeout(r, ms));
    this.lastSent = -Infinity;
    await this.update({ torque: 0, damping: 0, friction: 0 }, 1);
  }

  async stop(): Promise<void> {
    if (!this.device?.opened) return;
    this.lastSent = -Infinity;
    if (this.protocol === "classic") {
      await this.send(CLASSIC_REPORT_ID, new Uint8Array([CLASSIC_SLOT1_STOP, 0, 0, 0, 0, 0, 0]));
    } else if (this.featureIndex !== 0) {
      for (const slot of [this.slot, this.damperSlot, this.frictionSlot]) {
        if (slot !== undefined) {
          await this.hidpp(this.featureIndex, FF_SET_EFFECT_STATE, [slot, FF_STATE_STOP]);
        }
      }
      void FF_STATE_PLAY;
    }
  }

  async disconnect(): Promise<void> {
    await this.stop();
    if (this.device) {
      this.device.removeEventListener("inputreport", this.onReport);
      if (this.device.opened) await this.device.close();
    }
    this.device = undefined;
  }
}
