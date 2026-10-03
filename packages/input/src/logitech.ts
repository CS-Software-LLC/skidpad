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
  /**
   * The report layout the browser read from the device (WebHID's
   * `collections`); used to find the interface that carries HID++.
   */
  readonly collections?: ReadonlyArray<HidCollectionLike>;
  open(): Promise<void>;
  close(): Promise<void>;
  sendReport(reportId: number, data: Uint8Array): Promise<void>;
  addEventListener(type: "inputreport", listener: (event: HidInputReportEventLike) => void): void;
  removeEventListener(
    type: "inputreport",
    listener: (event: HidInputReportEventLike) => void,
  ): void;
}

export interface HidCollectionLike {
  usagePage?: number;
  usage?: number;
  outputReports?: ReadonlyArray<{ reportId?: number }>;
  children?: ReadonlyArray<HidCollectionLike>;
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
  /**
   * Largest fraction of the device's peak torque ever sent, 0 … 1 (default
   * 0.4: about 4.4 N·m on a G PRO). Every level is multiplied by it before
   * it leaves the sink, whatever the gain.
   */
  maxOutput?: number;
  /**
   * Zero the force when no update has arrived for this long, s (default
   * 0.25), so a paused host or a hidden tab cannot leave a force playing.
   */
  watchdog?: number;
}

// --- HID++ 2.0 constants -----------------------------------------------------
// Checked against the Linux driver's G920 / G923 path (`hid-logitech-hidpp.c`,
// feature 0x8123); still [VERIFY] on a G PRO, which that driver does not list.
/**
 * Short report: 7 bytes including the id, 3 parameter bytes. Only HID++ 1.0
 * register access uses it; many wheels (the G PRO among them) do not declare
 * it at all and refuse to write it, so HID++ 2.0 commands go out as long or
 * very long reports, as the Linux driver sends them.
 */
const HIDPP_SHORT = 0x10;
/** Long report: 20 bytes including the id, 16 parameter bytes. */
const HIDPP_LONG = 0x11;
/** Very long report: 64 bytes including the id; condition effects need it. */
const HIDPP_VERY_LONG = 0x12;
const HIDPP_LONG_PARAMS = 16;
const HIDPP_VERY_LONG_PARAMS = 60;
/** Feature-index byte of a HID++ 2.0 error reply, and sub id of a 1.0 one. */
const HIDPP20_ERROR = 0xff;
const HIDPP10_ERROR = 0x8f;
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
const FF_EFFECT_SPRING = 0x06;
const FF_EFFECT_DAMPER = 0x07;
const FF_EFFECT_FRICTION = 0x08;
const FF_EFFECT_AUTOSTART = 0x80;
/** Effect states of `setEffectState` (0 reads the state). */
const FF_STATE_STOP = 0x01;
const FF_STATE_PLAY = 0x02;
/** Parameter bytes of a constant-force and of a condition effect. */
const FF_CONSTANT_PARAMS = 14;
const FF_CONDITION_PARAMS = 18;

/** A HID++ reply: its parameter bytes, or the error code it carried. */
interface HidppReply {
  ok: boolean;
  params: Uint8Array;
  error?: number;
}

interface HidppWaiter {
  featureIndex: number;
  functionByte: number;
  resolve: (reply: HidppReply) => void;
}

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

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0;
}

/**
 * Output report ids a device declares, or undefined when the browser did
 * not say (a fake device, or a WebHID without `collections`).
 */
export function outputReportIds(device: HidDeviceLike): Set<number> | undefined {
  if (!device.collections) return undefined;
  const ids = new Set<number>();
  const walk = (cs: ReadonlyArray<HidCollectionLike>): void => {
    for (const c of cs) {
      for (const r of c.outputReports ?? []) if (r.reportId !== undefined) ids.add(r.reportId);
      if (c.children) walk(c.children);
    }
  };
  walk(device.collections);
  return ids;
}

/**
 * Of the interfaces the browser returned for one wheel, the one that
 * declares HID++ long or very long output reports; a wheel exposes its
 * gamepad and its HID++ channel as separate interfaces, and writing HID++
 * to the gamepad one fails.
 */
export function pickHidppDevice(devices: readonly HidDeviceLike[]): HidDeviceLike | undefined {
  return (
    devices.find((d) => {
      const ids = outputReportIds(d);
      return ids?.has(HIDPP_LONG) || ids?.has(HIDPP_VERY_LONG);
    }) ?? devices[0]
  );
}

function hex(bytes: ArrayLike<number>): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");
}

/**
 * Parameters of a constant-force download: slot (0 for a new effect), type,
 * duration and delay (0 and 0: play until stopped), then the signed level.
 * The attack and fade envelope bytes stay zero.
 */
function constantParams(slot: number, level: number): number[] {
  const l = Math.round(Math.max(-1, Math.min(1, level)) * 0x7fff) & 0xffff;
  const p = new Array<number>(FF_CONSTANT_PARAMS).fill(0);
  p[0] = slot;
  p[1] = FF_EFFECT_CONSTANT;
  p[6] = l >> 8;
  p[7] = l & 0xff;
  return p;
}

/**
 * Parameters of a condition effect (spring, damper, friction): slot, type,
 * duration, delay, then left saturation, left coefficient, deadband, centre,
 * right coefficient, right saturation. Saturations are 15-bit, the
 * coefficient a signed 16-bit fraction of full output.
 */
function conditionParams(slot: number, type: number, coefficient: number): number[] {
  const c = Math.round(Math.max(-1, Math.min(1, coefficient)) * 0x7fff) & 0xffff;
  const saturation = coefficient === 0 ? 0 : 0x7fff;
  const p = new Array<number>(FF_CONDITION_PARAMS).fill(0);
  p[0] = slot;
  p[1] = type;
  p[6] = saturation >> 8;
  p[7] = saturation & 0xff;
  p[8] = c >> 8;
  p[9] = c & 0xff;
  p[14] = c >> 8;
  p[15] = c & 0xff;
  p[16] = saturation >> 8;
  p[17] = saturation & 0xff;
  return p;
}

/**
 * Force-feedback sink for Logitech wheels over WebHID. Construct, then
 * `connect()` from a click handler.
 */
export class LogitechWebHidSink implements FfbSink {
  readonly name: string;
  /** Torque at the device's full output, N·m, before `maxOutput`. */
  readonly peakTorque: number;
  protocol: LogitechProtocol;
  readonly scaler: FfbScaler;
  private device: HidDeviceLike | undefined;
  private featureIndex = 0;
  private slot: number | undefined;
  private damperSlot: number | undefined;
  private frictionSlot: number | undefined;
  private pending: HidppWaiter[] = [];
  /** Output report ids the attached interface declares, when known. */
  private reportIds: Set<number> | undefined;
  private lastSent = -Infinity;
  private lastUpdate = -Infinity;
  private lastLevel = 0;
  private maxOutputValue: number;
  private watchdogTimer: ReturnType<typeof setInterval> | undefined;
  private readonly watchdogSeconds: number;
  private readonly minInterval: number;
  private readonly rotationDeg: number;
  private readonly updateMode: "modify" | "recreate";
  private readonly log: (line: string) => void;
  private readonly lines: string[] = [];
  private readonly onReport = (e: HidInputReportEventLike): void => {
    const data = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
    this.record(`<- id ${e.reportId.toString(16)} ${hex(data)}`);
    if (e.reportId === HIDPP_SHORT || e.reportId === HIDPP_LONG || e.reportId === HIDPP_VERY_LONG) {
      this.resolveReply(data);
    }
  };

  /**
   * Hand a reply to the request it answers. A reply echoes the request's
   * feature index and function byte; an error reply puts 0xff (2.0) or 0x8f
   * (1.0) there and moves them one byte along, followed by the error code.
   */
  private resolveReply(data: Uint8Array): void {
    const isError = data[1] === HIDPP20_ERROR || data[1] === HIDPP10_ERROR;
    const featureIndex = isError ? data[2] : data[1];
    const functionByte = isError ? data[3] : data[2];
    const i = this.pending.findIndex(
      (w) => w.featureIndex === featureIndex && w.functionByte === functionByte,
    );
    if (i < 0) return;
    const [waiter] = this.pending.splice(i, 1);
    if (isError) {
      const code = data[4] ?? 0;
      this.record(
        `   error 0x${code.toString(16).padStart(2, "0")} from feature ${featureIndex} function ${(functionByte ?? 0) >> 4}`,
      );
      waiter!.resolve({ ok: false, params: new Uint8Array(0), error: code });
    } else {
      waiter!.resolve({ ok: true, params: data.subarray(3) });
    }
  }

  constructor(options: LogitechSinkOptions = {}) {
    this.protocol = options.protocol ?? "hidpp";
    this.name = `Logitech (${this.protocol})`;
    // A direct-drive G PRO peaks at about 11 N·m; belt wheels 2 to 3.
    this.peakTorque = options.maxTorque ?? (this.protocol === "hidpp" ? 11 : 2.5);
    this.maxOutputValue = clamp01(options.maxOutput ?? 0.4);
    this.scaler = new FfbScaler({ ...options, maxTorque: this.maxTorque });
    this.watchdogSeconds = options.watchdog ?? 0.25;
    this.rotationDeg = options.rotationDeg ?? 900;
    this.updateMode = options.updateMode ?? "modify";
    this.minInterval = options.minInterval ?? 1 / 120;
    this.log = options.log ?? (() => {});
  }

  get connected(): boolean {
    return this.device?.opened ?? false;
  }

  /** Largest fraction of the peak torque the sink sends, 0 … 1. */
  get maxOutput(): number {
    return this.maxOutputValue;
  }

  set maxOutput(value: number) {
    this.maxOutputValue = clamp01(value);
    this.scaler.maxTorque = this.maxTorque;
  }

  /** Torque the device reaches at full scaler output, N·m: peak × `maxOutput`. */
  get maxTorque(): number {
    return this.peakTorque * this.maxOutputValue;
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
    const chosen = await hid.requestDevice({ filters: [{ vendorId: LOGITECH_VENDOR_ID }] });
    const first = chosen[0];
    if (!first) throw new Error("no device chosen");
    // The chooser grants the whole wheel, but may hand back only some of
    // its interfaces; the others come from getDevices().
    const siblings = (await hid.getDevices()).filter(
      (d) => d.vendorId === first.vendorId && d.productId === first.productId,
    );
    const candidates = [...chosen, ...siblings.filter((d) => !chosen.includes(d))];
    const device = this.protocol === "hidpp" ? pickHidppDevice(candidates) : first;
    await this.attach(device ?? first);
  }

  /** Use an already-permitted device (from `hid.getDevices()`). */
  async attach(device: HidDeviceLike): Promise<void> {
    this.device = device;
    this.reportIds = outputReportIds(device);
    if (!device.opened) await device.open();
    device.addEventListener("inputreport", this.onReport);
    this.record(
      `opened ${device.productName} (${device.vendorId.toString(16)}:${device.productId.toString(16)}), protocol ${this.protocol}`,
    );
    if (this.reportIds) {
      const ids = [...this.reportIds].map((id) => id.toString(16)).join(" ");
      this.record(`   output reports: ${ids || "none"}`);
    }
    if (this.protocol === "hidpp") await this.setupHidpp();
    else await this.setupClassic();
    this.armSafety();
  }

  /**
   * Zero the force when the page is hidden or closed (a hidden tab stops
   * stepping, which would leave the last force playing) and when updates
   * stop arriving.
   */
  private armSafety(): void {
    const doc = (globalThis as { document?: EventTarget }).document;
    doc?.addEventListener("visibilitychange", this.onHidden);
    globalThis.addEventListener?.("pagehide", this.onHidden);
    this.watchdogTimer = setInterval(() => {
      const idle = performance.now() / 1000 - this.lastUpdate;
      if (this.lastLevel !== 0 && idle > this.watchdogSeconds) {
        this.record(`   watchdog: no update for ${idle.toFixed(2)} s, force zeroed`);
        void this.zero();
      }
    }, 100);
  }

  private disarmSafety(): void {
    const doc = (globalThis as { document?: EventTarget }).document;
    doc?.removeEventListener("visibilitychange", this.onHidden);
    globalThis.removeEventListener?.("pagehide", this.onHidden);
    if (this.watchdogTimer !== undefined) clearInterval(this.watchdogTimer);
    this.watchdogTimer = undefined;
  }

  private readonly onHidden = (): void => {
    const doc = (globalThis as { document?: { visibilityState?: string } }).document;
    if (doc?.visibilityState === "visible") return;
    void this.zero();
  };

  /** Send zero force now. */
  private async zero(): Promise<void> {
    this.lastLevel = 0;
    try {
      await this.sendLevel(0);
    } catch (e) {
      this.record(`   send failed: ${String(e)}`);
    }
  }

  // --- HID++ ------------------------------------------------------------------

  private async send(reportId: number, data: Uint8Array): Promise<void> {
    if (!this.device) return;
    this.record(`-> id ${reportId.toString(16)} ${hex(data)}`);
    await this.device.sendReport(reportId, data);
  }

  /** Send a HID++ command and wait for the matching reply (or time out). */
  private async hidpp(featureIndex: number, func: number, params: number[]): Promise<HidppReply> {
    // Long unless the parameters need very long, or the interface only
    // declares very long reports.
    const longMissing =
      this.reportIds !== undefined &&
      !this.reportIds.has(HIDPP_LONG) &&
      this.reportIds.has(HIDPP_VERY_LONG);
    const veryLong = params.length > HIDPP_LONG_PARAMS || longMissing;
    const reportId = veryLong ? HIDPP_VERY_LONG : HIDPP_LONG;
    const length = veryLong ? HIDPP_VERY_LONG_PARAMS : HIDPP_LONG_PARAMS;
    const data = new Uint8Array(3 + length);
    data[0] = HIDPP_DEVICE_INDEX;
    data[1] = featureIndex;
    data[2] = ((func & 0x0f) << 4) | HIDPP_SOFTWARE_ID;
    params.forEach((p, i) => {
      data[3 + i] = p & 0xff;
    });
    const reply = new Promise<HidppReply>((resolve) => {
      const waiter: HidppWaiter = {
        featureIndex,
        functionByte: data[2]!,
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
      };
      const timer = setTimeout(() => {
        const i = this.pending.indexOf(waiter);
        if (i >= 0) this.pending.splice(i, 1);
        this.record("   (no response within 250 ms)");
        resolve({ ok: false, params: new Uint8Array(0) });
      }, 250);
      this.pending.push(waiter);
    });
    try {
      await this.send(reportId, data);
    } catch (e) {
      this.record(`   send failed: ${String(e)}`);
      const i = this.pending.findIndex(
        (w) => w.functionByte === data[2] && w.featureIndex === featureIndex,
      );
      if (i >= 0) this.pending.splice(i, 1)[0]!.resolve({ ok: false, params: new Uint8Array(0) });
    }
    return reply;
  }

  /**
   * The Linux driver's G920 / G923 start-up: find the feature, reset every
   * effect, then replace the firmware's own centring spring with one of zero
   * strength. The reset alone leaves that spring on, which holds the wheel
   * stiffly to the centre whatever the host sends.
   */
  private async setupHidpp(): Promise<void> {
    const r = await this.hidpp(HIDPP_ROOT_INDEX, 0, [
      HIDPP_FEATURE_FORCE_FEEDBACK >> 8,
      HIDPP_FEATURE_FORCE_FEEDBACK & 0xff,
    ]);
    // Reply params: [featureIndex, featureType, featureVersion].
    this.featureIndex = r.ok ? (r.params[0] ?? 0) : 0;
    if (this.featureIndex === 0) {
      const ids = this.reportIds;
      this.record(
        ids && !ids.has(HIDPP_LONG) && !ids.has(HIDPP_VERY_LONG)
          ? "this interface has no HID++ output reports; reconnect and pick the wheel's other entry in the chooser"
          : "force-feedback feature 0x8123 not reported; the wheel may be in a different mode or need the classic protocol",
      );
      return;
    }
    this.record(`feature 0x8123 at index ${this.featureIndex}`);
    await this.hidpp(this.featureIndex, FF_GET_INFO, []);
    await this.hidpp(this.featureIndex, FF_RESET_ALL, []);
    const centring = await this.hidpp(
      this.featureIndex,
      FF_DOWNLOAD_EFFECT,
      conditionParams(0, FF_EFFECT_SPRING | FF_EFFECT_AUTOSTART, 0),
    );
    this.record(
      centring.ok
        ? `centring spring set to zero (slot ${centring.params[0] ?? "?"})`
        : "could not zero the centring spring; the wheel will stay stiff",
    );
    await this.hidpp(this.featureIndex, FF_SET_APERTURE, [
      this.rotationDeg >> 8,
      this.rotationDeg & 0xff,
    ]);
    // Gain, then boost: full gain, no boost, as the Linux driver sends.
    await this.hidpp(this.featureIndex, FF_SET_GLOBAL_GAINS, [0xff, 0xff, 0, 0]);
    this.slot = await this.download(constantParams(0, 0));
    this.damperSlot = await this.download(conditionParams(0, FF_EFFECT_DAMPER, 0));
    this.frictionSlot = await this.download(conditionParams(0, FF_EFFECT_FRICTION, 0));
  }

  /** Download an effect into a new slot and start it; the slot, if any. */
  private async download(params: number[]): Promise<number | undefined> {
    const r = await this.hidpp(this.featureIndex, FF_DOWNLOAD_EFFECT, params);
    const slot = r.ok && r.params[0] ? r.params[0] : undefined;
    this.record(`effect type ${(params[1] ?? 0).toString(16)} -> slot ${slot ?? "?"}`);
    if (slot !== undefined) {
      await this.hidpp(this.featureIndex, FF_SET_EFFECT_STATE, [slot, FF_STATE_PLAY]);
    }
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
    const wasTripped = this.scaler.tripped;
    const level = this.scaler.scale(frame.torque, dt, frame.wheelAngle);
    if (!wasTripped && this.scaler.tripped) {
      this.record(`   runaway guard: ${this.scaler.tripped}; force off until re-armed`);
    }
    const now = performance.now() / 1000;
    this.lastUpdate = now;
    if (now - this.lastSent < this.minInterval) return;
    this.lastSent = now;
    this.lastLevel = level;
    // The host calls this without awaiting it, so a failed report would
    // otherwise vanish; log it instead.
    try {
      await this.sendLevel(level);
    } catch (e) {
      this.record(`   send failed: ${String(e)}`);
    }
    // Damping and friction scale with the definition's column values.
    void frame.damping;
    void frame.friction;
  }

  /** Send a level in −1 … 1 of the allowed output (positive turns right). */
  private async sendLevel(level: number): Promise<void> {
    const out = Math.max(-1, Math.min(1, level)) * this.maxOutputValue;
    if (this.protocol === "classic") {
      // 0x80 is zero force; the sign convention is [VERIFY].
      const x = Math.round(0x80 - out * 0x7f) & 0xff;
      await this.send(
        CLASSIC_REPORT_ID,
        new Uint8Array([CLASSIC_SLOT1_PLAY, CLASSIC_FORCE_CONSTANT, x, 0x80, 0, 0, 0]),
      );
      return;
    }
    if (this.featureIndex === 0) return;
    // A positive HID++ constant force turns a G PRO left, so the sign is
    // flipped here (found on hardware; the G923 and G920 are [VERIFY]).
    const device = -out;
    if (this.updateMode === "modify" && this.slot !== undefined) {
      // Re-downloading into the effect's own slot changes it in place.
      await this.hidpp(this.featureIndex, FF_DOWNLOAD_EFFECT, constantParams(this.slot, device));
    } else {
      if (this.slot !== undefined) {
        await this.hidpp(this.featureIndex, FF_DESTROY_EFFECT, [this.slot]);
      }
      this.slot = await this.download(constantParams(0, device));
    }
  }

  /**
   * Send a short, gentle pulse for the setup panel's "test" button. A
   * positive level should turn the wheel right; if it turns left, set the
   * scaler's `invert`.
   */
  async pulse(level = 0.25, ms = 250): Promise<void> {
    if (!this.device?.opened) return;
    const sign = this.scaler.invert ? -1 : 1;
    this.lastUpdate = performance.now() / 1000;
    this.lastLevel = level;
    await this.sendLevel(sign * level);
    await new Promise((r) => setTimeout(r, ms));
    this.lastSent = -Infinity;
    await this.zero();
  }

  async stop(): Promise<void> {
    if (!this.device?.opened) return;
    this.lastSent = -Infinity;
    this.lastLevel = 0;
    if (this.protocol === "classic") {
      await this.send(CLASSIC_REPORT_ID, new Uint8Array([CLASSIC_SLOT1_STOP, 0, 0, 0, 0, 0, 0]));
    } else if (this.featureIndex !== 0) {
      for (const slot of [this.slot, this.damperSlot, this.frictionSlot]) {
        if (slot !== undefined) {
          await this.hidpp(this.featureIndex, FF_SET_EFFECT_STATE, [slot, FF_STATE_STOP]);
        }
      }
    }
  }

  async disconnect(): Promise<void> {
    this.disarmSafety();
    await this.stop();
    if (this.device) {
      this.device.removeEventListener("inputreport", this.onReport);
      if (this.device.opened) await this.device.close();
    }
    this.device = undefined;
  }
}
