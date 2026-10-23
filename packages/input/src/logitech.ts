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
import { FfbScaler, TorquePlayout, type FfbScalerOptions } from "./ffb.js";

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

/** A Logitech wheel the sink knows by product id. */
export interface LogitechWheelModel {
  productId: number;
  name: string;
  /** The force-feedback protocol the wheel speaks in this mode. */
  protocol: LogitechProtocol;
  /** Torque at full output, N·m (approximate; belt and gear wheels 2 to 3). */
  peakTorque: number;
  /** Widest rotation the wheel can be set to, degrees lock to lock (default 900). */
  maxRotationDeg?: number;
  /** A direct-drive base: no belt or gear lag, so it can take a fast slew. */
  directDrive?: boolean;
}

/**
 * Scaler settings for a direct-drive base (polish item 2): zero to full
 * output in 20 ms and 3 ms smoothing, against 0.2 s and 10 ms for gear and
 * belt wheels. Simucube leaves its slew limit off by default; the runaway
 * guard and `maxOutput` stay as the safety layer. [VERIFY] on the G PRO
 * before it becomes the default.
 */
export const DIRECT_DRIVE_SCALER = { slewRate: 50, smoothing: 0.003 } as const;

/**
 * Wheels known by USB product id, with the protocol the Linux drivers use
 * for each (`hid-ids.h`; `lg4ff` for the classic ones,
 * `hid-logitech-hidpp` for HID++). Ids marked [VERIFY] are not in those
 * drivers. A wheel switched to another mode (a G923 in compatibility mode)
 * enumerates with another id.
 */
export const LOGITECH_WHEELS: readonly LogitechWheelModel[] = [
  { productId: 0xc293, name: "WingMan Formula Force GP", protocol: "classic", peakTorque: 2 },
  { productId: 0xc294, name: "Driving Force / Formula EX", protocol: "classic", peakTorque: 2 },
  { productId: 0xc295, name: "MOMO Force", protocol: "classic", peakTorque: 2 },
  { productId: 0xc298, name: "Driving Force Pro", protocol: "classic", peakTorque: 2 },
  { productId: 0xc299, name: "G25", protocol: "classic", peakTorque: 2.5 },
  { productId: 0xc29a, name: "Driving Force GT", protocol: "classic", peakTorque: 2 },
  { productId: 0xc29b, name: "G27", protocol: "classic", peakTorque: 2.5 },
  { productId: 0xc24f, name: "G29", protocol: "classic", peakTorque: 2.5 },
  { productId: 0xca03, name: "MOMO Racing", protocol: "classic", peakTorque: 2 },
  { productId: 0xc262, name: "G920", protocol: "hidpp", peakTorque: 2.5 },
  { productId: 0xc26e, name: "G923 (Xbox / PC)", protocol: "hidpp", peakTorque: 2.5 },
  {
    productId: 0xc272,
    name: "G PRO (Xbox / PC)",
    protocol: "hidpp",
    peakTorque: 11,
    maxRotationDeg: 1080,
    directDrive: true,
  },
  // [VERIFY] not in the Linux drivers.
  {
    productId: 0xc268,
    name: "G PRO (PlayStation / PC)",
    protocol: "hidpp",
    peakTorque: 11,
    maxRotationDeg: 1080,
    directDrive: true,
  },
];

/** The known wheel with this product id, if any. */
export function logitechWheel(productId: number): LogitechWheelModel | undefined {
  return LOGITECH_WHEELS.find((w) => w.productId === productId);
}

/** Peak torque assumed for a wheel the table does not know, by protocol. */
function defaultPeakTorque(protocol: LogitechProtocol): number {
  // A direct-drive G PRO peaks at about 11 N·m; belt wheels 2 to 3.
  return protocol === "hidpp" ? 11 : 2.5;
}

export interface LogitechSinkOptions extends FfbScalerOptions {
  /**
   * Which protocol to speak. `auto` (the default) picks it from the
   * device's product id ({@link LOGITECH_WHEELS}) when the device is
   * attached, and falls back to `hidpp` for a wheel it does not know.
   */
  protocol?: LogitechProtocol | "auto";
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
   * Play each host step's torque slices (`FfbFrame.samples`) out at this
   * rate, Hz, one host step behind with linear interpolation, instead of
   * one level per host step (ADR-0032). 0 (the default) is off. A report
   * still in flight when the next is due is skipped, so the real rate is
   * what the device answers at [VERIFY on the G PRO; try 250 to 500].
   * Overrides `minInterval` while it runs.
   */
  playoutRate?: number;
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
  /**
   * Multiplier on the definition's column friction and damping before they
   * go to the wheel's friction and damper effects (default 1). They are
   * scaled by `gain` too, so the column keeps its share of the torque.
   */
  columnScale?: number;
  /**
   * Hand-wheel rate at which a damper coefficient of 1 gives the device's
   * full output, rad/s (default 10) [VERIFY]. The firmware's velocity unit
   * is not documented; a larger value gives less damping for the same
   * definition.
   */
  damperRate?: number;
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
/** Friction and damper both at zero, as set-up downloads them. */
const COLUMN_OFF = "off";

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
 * coefficient a signed 16-bit fraction of full output. The saturation caps
 * the effect's force, so it defaults to full output for a non-zero
 * coefficient and zero otherwise.
 */

/**
 * Coefficients of the wheel's friction and damper effects, as fractions of
 * the device's peak torque, and the saturation that caps both.
 */
export interface ColumnEffects {
  friction: number;
  damper: number;
  saturation: number;
}

/**
 * The column's friction (N·m) and damping (N·m per rad/s) at the hand wheel
 * as condition-effect coefficients: each scaled by `gain × columnScale`,
 * over the device's peak torque, the damping through `damperRate` (the
 * hand-wheel rate of full damper output per unit coefficient). Both are
 * clamped to `0 … maxOutput`, and the saturation is `maxOutput`, so the
 * firmware never pushes harder than the sink's own limit. Negative inputs
 * give zero: a negative damper would push the wheel along, not resist it.
 */
export function columnEffects(
  friction: number,
  damping: number,
  o: {
    gain: number;
    columnScale: number;
    damperRate: number;
    peakTorque: number;
    maxOutput: number;
  },
): ColumnEffects {
  const limit = clamp01(o.maxOutput);
  const k = (Math.max(0, o.gain) * Math.max(0, o.columnScale)) / Math.max(o.peakTorque, 1e-6);
  const fit = (x: number): number => (Number.isFinite(x) ? Math.max(0, Math.min(limit, x)) : 0);
  return {
    friction: fit(k * friction),
    damper: fit(k * damping * Math.max(0, o.damperRate)),
    saturation: limit,
  };
}
/** One constant-force run of the damper measurement. */
export interface DamperRun {
  /** Constant torque applied, N·m. */
  torque: number;
  /** Terminal hand-wheel speed it reached, rad/s. */
  speed: number;
}

export interface DamperFit {
  /** Damping the firmware applied, N·m per rad/s. */
  damping: number;
  /** Torque lost to friction (the rim's own and the firmware's), N·m. */
  friction: number;
  /**
   * The wheel speed at which a damper coefficient of 1 gives the device's
   * peak torque, rad/s: the sink's `damperRate`.
   */
  damperRate: number;
  /**
   * How well the runs agree with one damping line through the friction,
   * |residual| over torque, worst run (0 is exact).
   */
  spread: number;
}

/**
 * Fit the firmware's damper from constant-force runs at a known damper
 * coefficient (polish item 4): at terminal speed `T = c·ω + f`, so two or
 * more runs give the damping `c` and the friction `f` by least squares, and
 * the coefficient's scale follows as `damperRate = coefficient · peak / c`.
 * Undefined when the speeds do not grow with the torque.
 */
export function fitDamper(
  runs: readonly DamperRun[],
  coefficient: number,
  peakTorque: number,
): DamperFit | undefined {
  const pts = runs.filter((r) => Number.isFinite(r.speed) && Math.abs(r.speed) > 1e-3);
  if (pts.length < 2) return undefined;
  const n = pts.length;
  const xs = pts.map((r) => Math.abs(r.speed));
  const ys = pts.map((r) => Math.abs(r.torque));
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
  }
  if (!(sxx > 0)) return undefined;
  const damping = sxy / sxx;
  if (!(damping > 0)) return undefined;
  const friction = Math.max(0, my - damping * mx);
  let spread = 0;
  for (let i = 0; i < n; i++) {
    spread = Math.max(spread, Math.abs(ys[i]! - (damping * xs[i]! + friction)) / ys[i]!);
  }
  return { damping, friction, damperRate: (coefficient * peakTorque) / damping, spread };
}

function conditionParams(
  slot: number,
  type: number,
  coefficient: number,
  saturationLevel = coefficient === 0 ? 0 : 1,
): number[] {
  const c = Math.round(Math.max(-1, Math.min(1, coefficient)) * 0x7fff) & 0xffff;
  const saturation = Math.round(clamp01(saturationLevel) * 0x7fff);
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
  readonly scaler: FfbScaler;
  private requested: LogitechProtocol | "auto";
  private resolved: LogitechProtocol | undefined;
  private model: LogitechWheelModel | undefined;
  private readonly torqueOverride: number | undefined;
  private readyValue = false;
  private device: HidDeviceLike | undefined;
  private featureIndex = 0;
  private slot: number | undefined;
  private damperSlot: number | undefined;
  private frictionSlot: number | undefined;
  /** Friction and damper coefficients last sent, as quantised report bytes. */
  private lastColumn: string | undefined;
  private classicColumnNoted = false;
  /** Multiplier on the definition's column friction and damping. */
  columnScale: number;
  /** Hand-wheel rate of full damper output per unit coefficient, rad/s [VERIFY]. */
  damperRate: number;
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
  /** Playout rate, Hz (0 off); see the option. */
  playoutRate: number;
  private readonly playout = new TorquePlayout();
  private playoutTimer: ReturnType<typeof setInterval> | undefined;
  private playoutHz = 0;
  private lastTick = 0;
  private sending = false;
  /** Per-report lines in the log; off while the playout runs, which would flood it. */
  private reportLines = true;
  private measuring = false;
  private rotationDeg: number;
  private readonly updateMode: "modify" | "recreate";
  private readonly log: (line: string) => void;
  private readonly lines: string[] = [];
  private readonly onReport = (e: HidInputReportEventLike): void => {
    const data = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
    if (this.reportLines) this.record(`<- id ${e.reportId.toString(16)} ${hex(data)}`);
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
    this.requested = options.protocol ?? "auto";
    this.torqueOverride = options.maxTorque;
    this.maxOutputValue = clamp01(options.maxOutput ?? 0.4);
    this.scaler = new FfbScaler({ ...options, maxTorque: this.maxTorque });
    this.watchdogSeconds = options.watchdog ?? 0.25;
    this.rotationDeg = options.rotationDeg ?? 900;
    this.updateMode = options.updateMode ?? "modify";
    this.minInterval = options.minInterval ?? 1 / 120;
    this.playoutRate = Math.max(0, options.playoutRate ?? 0);
    this.log = options.log ?? (() => {});
    this.columnScale = options.columnScale ?? 1;
    this.damperRate = options.damperRate ?? 10;
  }

  /**
   * The protocol in use: the one asked for, or once a device is attached
   * with `auto`, the one its product id calls for. Before attaching with
   * `auto` this reads `hidpp`, the fallback. Set it before `attach()` to
   * force a protocol; `peakTorque` follows.
   */
  get protocol(): LogitechProtocol {
    return this.resolved ?? (this.requested === "auto" ? "hidpp" : this.requested);
  }

  set protocol(value: LogitechProtocol | "auto") {
    this.requested = value;
    this.resolved = undefined;
    this.scaler.maxTorque = this.maxTorque;
  }

  get name(): string {
    return `Logitech ${this.model?.name ?? ""}${this.model ? " " : ""}(${this.protocol})`;
  }

  /** The attached wheel, when its product id is in {@link LOGITECH_WHEELS}. */
  get wheel(): LogitechWheelModel | undefined {
    return this.model;
  }

  /**
   * Torque at the device's full output, N·m, before `maxOutput`: the
   * `maxTorque` option if given, else the attached wheel's from
   * {@link LOGITECH_WHEELS}, else the default of the protocol in use.
   */
  get peakTorque(): number {
    return this.torqueOverride ?? this.model?.peakTorque ?? defaultPeakTorque(this.protocol);
  }

  /** The device is open (it may still be unable to play forces; see {@link ready}). */
  get connected(): boolean {
    return this.device?.opened ?? false;
  }

  /**
   * The device is open and the force path was set up: the HID++ feature
   * answered and the constant-force effect has a slot, or the classic
   * set-up reports went out. `update()` sends nothing while this is false.
   */
  get ready(): boolean {
    return this.connected && this.readyValue;
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
    const protocol = this.resolveFor(first.productId);
    const device = protocol === "hidpp" ? pickHidppDevice(candidates) : first;
    await this.attach(device ?? first);
  }

  /** The protocol for a product id under the requested one; also picks the model. */
  private resolveFor(productId: number): LogitechProtocol {
    this.model = logitechWheel(productId);
    this.resolved = this.requested === "auto" ? (this.model?.protocol ?? "hidpp") : this.requested;
    this.scaler.maxTorque = this.maxTorque;
    return this.resolved;
  }

  /**
   * Use an already-permitted device (from `hid.getDevices()`). Rejects,
   * with the device closed again, when the force path cannot be set up
   * (the HID++ feature does not answer, or the classic reports cannot be
   * written); the diagnostics log says why.
   */
  async attach(device: HidDeviceLike): Promise<void> {
    if (this.device) await this.disconnect();
    const protocol = this.resolveFor(device.productId);
    this.device = device;
    this.readyValue = false;
    this.featureIndex = 0;
    this.slot = this.damperSlot = this.frictionSlot = undefined;
    this.lastColumn = undefined;
    this.reportIds = outputReportIds(device);
    if (!device.opened) await device.open();
    device.addEventListener("inputreport", this.onReport);
    this.record(
      `opened ${device.productName} (${device.vendorId.toString(16)}:${device.productId.toString(16)}), ` +
        `protocol ${protocol}${this.requested === "auto" ? (this.model ? ` (${this.model.name})` : " (unknown wheel, default)") : ""}, ` +
        `peak ${this.peakTorque} N·m`,
    );
    if (this.reportIds) {
      const ids = [...this.reportIds].map((id) => id.toString(16)).join(" ");
      this.record(`   output reports: ${ids || "none"}`);
    }
    let failure: string | undefined;
    try {
      failure = protocol === "hidpp" ? await this.setupHidpp() : await this.setupClassic();
    } catch (e) {
      failure = `set-up failed: ${String(e)}`;
    }
    if (failure !== undefined) {
      this.record(`   no force path: ${failure}`);
      try {
        await this.disconnect();
      } catch (e) {
        this.record(`   close failed: ${String(e)}`);
      }
      throw new Error(`Logitech force feedback unavailable (${protocol}): ${failure}`);
    }
    this.readyValue = true;
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
    if (this.reportLines) this.record(`-> id ${reportId.toString(16)} ${hex(data)}`);
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
  private async setupHidpp(): Promise<string | undefined> {
    const r = await this.hidpp(HIDPP_ROOT_INDEX, 0, [
      HIDPP_FEATURE_FORCE_FEEDBACK >> 8,
      HIDPP_FEATURE_FORCE_FEEDBACK & 0xff,
    ]);
    // Reply params: [featureIndex, featureType, featureVersion].
    this.featureIndex = r.ok ? (r.params[0] ?? 0) : 0;
    if (this.featureIndex === 0) {
      const ids = this.reportIds;
      const why =
        ids && !ids.has(HIDPP_LONG) && !ids.has(HIDPP_VERY_LONG)
          ? "this interface has no HID++ output reports; reconnect and pick the wheel's other entry in the chooser"
          : "force-feedback feature 0x8123 not reported; the wheel may be in a different mode or need the classic protocol";
      this.record(why);
      return why;
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
    const aperture = Math.round(Math.max(40, Math.min(this.maxRotationDeg, this.rotationDeg)));
    await this.hidpp(this.featureIndex, FF_SET_APERTURE, [aperture >> 8, aperture & 0xff]);
    // Gain, then boost: full gain, no boost, as the Linux driver sends.
    await this.hidpp(this.featureIndex, FF_SET_GLOBAL_GAINS, [0xff, 0xff, 0, 0]);
    this.slot = await this.download(constantParams(0, 0));
    this.damperSlot = await this.download(conditionParams(0, FF_EFFECT_DAMPER, 0));
    this.frictionSlot = await this.download(conditionParams(0, FF_EFFECT_FRICTION, 0));
    this.lastColumn = COLUMN_OFF;
    return this.slot === undefined ? "the wheel did not accept a constant-force effect" : undefined;
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

  private async setupClassic(): Promise<undefined> {
    await this.send(CLASSIC_REPORT_ID, new Uint8Array([CLASSIC_AUTOCENTER_OFF, 0, 0, 0, 0, 0, 0]));
    const range = Math.max(40, Math.min(this.maxRotationDeg, Math.round(this.rotationDeg)));
    await this.send(
      CLASSIC_REPORT_ID,
      new Uint8Array([CLASSIC_EXTENDED, CLASSIC_SET_RANGE, range & 0xff, range >> 8, 0, 0, 0]),
    );
    return undefined;
  }

  // --- frames -------------------------------------------------------------------

  async update(frame: FfbFrame, dt: number): Promise<void> {
    // The damper measurement owns the force while it runs.
    if (!this.ready || this.measuring) return;
    if (this.playoutRate > 0 && frame.samples && frame.samples.length > 0) {
      await this.updatePlayout(frame, dt);
      return;
    }
    this.stopPlayout();
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
    await this.sendColumn(frame);
  }

  /**
   * Playout mode: the host step only feeds the runaway guard and queues
   * the slices; a timer shapes and sends the interpolated torque.
   */
  private async updatePlayout(frame: FfbFrame, dt: number): Promise<void> {
    const wasTripped = this.scaler.tripped;
    this.scaler.watch(dt, frame.wheelAngle);
    if (!wasTripped && this.scaler.tripped) {
      this.record(`   runaway guard: ${this.scaler.tripped}; force off until re-armed`);
    }
    const now = performance.now() / 1000;
    this.lastUpdate = now;
    this.playout.push(frame.samples!, dt, now);
    if (this.playoutHz !== this.playoutRate) this.startPlayout();
    await this.sendColumn(frame);
  }

  private startPlayout(): void {
    this.stopPlayout();
    this.playoutHz = this.playoutRate;
    this.lastTick = performance.now() / 1000;
    this.reportLines = false;
    this.record(`   playout at ${this.playoutHz} Hz; per-report log lines paused`);
    this.playoutTimer = setInterval(() => this.tick(), 1000 / this.playoutHz);
  }

  private stopPlayout(): void {
    if (this.playoutTimer === undefined) return;
    clearInterval(this.playoutTimer);
    this.playoutTimer = undefined;
    this.playoutHz = 0;
    this.playout.reset();
    this.reportLines = true;
  }

  /** One playout report: skipped while the last is in flight or updates stopped. */
  private tick(): void {
    const now = performance.now() / 1000;
    const dt = now - this.lastTick;
    this.lastTick = now;
    if (this.sending || now - this.lastUpdate > this.watchdogSeconds) return;
    const level = this.scaler.shape(this.playout.at(now), dt);
    this.lastSent = now;
    this.lastLevel = level;
    this.sending = true;
    this.sendLevel(level)
      .catch((e: unknown) => this.record(`   send failed: ${String(e)}`))
      .finally(() => {
        this.sending = false;
      });
  }

  /**
   * Set the wheel's rotation, degrees lock to lock, clamped to what the
   * device allows (polish item 3: match the car's lock, so the wheel's
   * bump stop is the rack's). The wheel's axis then spans the new range
   * [VERIFY on hardware], so the input's rotation must follow it.
   * Returns the rotation set.
   */
  async setRotation(deg: number): Promise<number> {
    const r = Math.round(Math.max(40, Math.min(this.maxRotationDeg, deg)));
    this.rotationDeg = r;
    if (!this.ready) return r;
    if (this.protocol === "classic") {
      await this.send(
        CLASSIC_REPORT_ID,
        new Uint8Array([CLASSIC_EXTENDED, CLASSIC_SET_RANGE, r & 0xff, r >> 8, 0, 0, 0]),
      );
    } else if (this.featureIndex !== 0) {
      await this.hidpp(this.featureIndex, FF_SET_APERTURE, [r >> 8, r & 0xff]);
    }
    this.record(`   rotation set to ${r}°`);
    return r;
  }

  /** Widest rotation the attached wheel takes, degrees (900 when unknown). */
  get maxRotationDeg(): number {
    return this.model?.maxRotationDeg ?? 900;
  }

  /** Whether the attached wheel is a direct-drive base. */
  get directDrive(): boolean {
    return this.model?.directDrive ?? false;
  }

  /**
   * The column's friction and damping, on the wheel's own friction and
   * damper effects: the firmware applies them at its own rate, far above
   * the host's, which a damper needs to stay stable. They resist motion
   * and never drive it, so they stay on when the runaway guard or the
   * watchdog cuts the constant force. Sent only when a coefficient
   * changes (the gain, `maxOutput`, `columnScale` or the car).
   */
  private async sendColumn(frame: FfbFrame): Promise<void> {
    if (this.protocol === "classic") {
      if (!this.classicColumnNoted && (frame.friction > 0 || frame.damping > 0)) {
        this.classicColumnNoted = true;
        this.record("   column friction and damping are not sent over the classic protocol yet");
      }
      return;
    }
    if (this.featureIndex === 0) return;
    const c = columnEffects(frame.friction, frame.damping, {
      gain: this.scaler.gain,
      columnScale: this.columnScale,
      damperRate: this.damperRate,
      peakTorque: this.peakTorque,
      maxOutput: this.maxOutputValue,
    });
    const q = (x: number): number => Math.round(x * 0x7fff);
    // The damper in steps of about 5 %: with speed-sensitive damping
    // (ADR-0033) it moves every frame, and each change costs reports.
    const qd = q(c.damper) === 0 ? 0 : Math.round(Math.log(c.damper) / Math.log(1.05));
    // Both off is one state whatever the saturation, as set-up leaves them.
    const key =
      q(c.friction) === 0 && q(c.damper) === 0
        ? COLUMN_OFF
        : `${q(c.friction)} ${qd} ${q(c.saturation)}`;
    if (key === this.lastColumn) return;
    this.lastColumn = key;
    this.record(
      `   column: friction ${(c.friction * this.peakTorque).toFixed(2)} N·m, ` +
        `damper ${c.damper.toFixed(3)} of full output at ${this.damperRate} rad/s`,
    );
    this.frictionSlot = await this.setCondition(
      this.frictionSlot,
      FF_EFFECT_FRICTION,
      c.friction,
      c.saturation,
    );
    this.damperSlot = await this.setCondition(
      this.damperSlot,
      FF_EFFECT_DAMPER,
      c.damper,
      c.saturation,
    );
  }

  /** Change a condition effect in place, or re-create it; its slot. */
  private async setCondition(
    slot: number | undefined,
    type: number,
    coefficient: number,
    saturation: number,
  ): Promise<number | undefined> {
    if (this.updateMode === "modify" && slot !== undefined) {
      await this.hidpp(
        this.featureIndex,
        FF_DOWNLOAD_EFFECT,
        conditionParams(slot, type, coefficient, saturation),
      );
      return slot;
    }
    if (slot !== undefined) await this.hidpp(this.featureIndex, FF_DESTROY_EFFECT, [slot]);
    return this.download(conditionParams(0, type, coefficient, saturation));
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
   * Measure the firmware damper's units (polish item 4). With the hands
   * off, the damper at `coefficient` and friction off, a constant torque
   * spins the rim to its terminal speed, read from `readAngleDeg` (the
   * hand-wheel angle, degrees, positive right); this repeats at each of
   * `torques` (N·m, alternating direction), then `fitDamper` gives the
   * damping and `damperRate`. Each run stops early near the end stop or if
   * the rim runs faster than `maxSpeed`. The force is zeroed after; the
   * next `update()` restores the column effects. With two torques the
   * second run also shows whether changing a playing constant force works
   * in this `updateMode` [VERIFY]: if it does not, the speeds do not grow
   * and the fit fails.
   */
  async measureDamper(
    readAngleDeg: () => number,
    o: {
      torques?: readonly number[];
      coefficient?: number;
      settle?: number;
      window?: number;
      maxAngleDeg?: number;
      maxSpeed?: number;
    } = {},
  ): Promise<{ runs: DamperRun[]; fit: DamperFit | undefined }> {
    const torques = o.torques ?? [0.3, 0.5, 0.7];
    const coefficient = o.coefficient ?? 0.4;
    const settle = o.settle ?? 0.6;
    const window = o.window ?? 0.4;
    const maxAngle = o.maxAngleDeg ?? 0.5 * this.rotationDeg - 60;
    const maxSpeed = o.maxSpeed ?? 15;
    const runs: DamperRun[] = [];
    if (!this.ready || this.protocol === "classic" || this.featureIndex === 0) {
      return { runs, fit: undefined };
    }
    this.stopPlayout();
    const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
    const now = () => performance.now() / 1000;
    this.record(`   measuring the damper at coefficient ${coefficient}`);
    this.measuring = true;
    try {
      this.frictionSlot = await this.setCondition(this.frictionSlot, FF_EFFECT_FRICTION, 0, 0);
      this.damperSlot = await this.setCondition(
        this.damperSlot,
        FF_EFFECT_DAMPER,
        coefficient,
        this.maxOutputValue,
      );
      this.lastColumn = undefined;
      for (const [i, torque] of torques.entries()) {
        const sign = i % 2 === 0 ? 1 : -1;
        const level = (sign * torque) / Math.max(this.peakTorque * this.maxOutputValue, 1e-6);
        this.lastUpdate = now();
        this.lastLevel = level;
        await this.sendLevel(Math.max(-1, Math.min(1, level)));
        const t0 = now();
        const samples: Array<[number, number]> = [];
        let stopped = false;
        while (now() - t0 < settle + window) {
          await sleep(0.01);
          this.lastUpdate = now();
          const a = readAngleDeg();
          const t = now();
          const last = samples.at(-1);
          const rate = last ? ((a - last[1]) * Math.PI) / 180 / Math.max(t - last[0], 1e-3) : 0;
          if (Math.abs(a) > maxAngle || Math.abs(rate) > maxSpeed) {
            stopped = true;
            break;
          }
          if (t - t0 >= settle) samples.push([t, a]);
        }
        await this.sendLevel(0);
        this.lastLevel = 0;
        // The window's mean speed, and its two halves to check it settled.
        const speedOf = (p: Array<[number, number]>): number =>
          p.length < 2
            ? NaN
            : ((p.at(-1)![1] - p[0]![1]) * Math.PI) / 180 / Math.max(p.at(-1)![0] - p[0]![0], 1e-3);
        const half = Math.floor(samples.length / 2);
        const speed = speedOf(samples);
        const early = speedOf(samples.slice(0, half + 1));
        const late = speedOf(samples.slice(half));
        const steady = Math.abs(late - early) <= 0.05 * Math.abs(speed);
        if (!stopped && samples.length >= 4 && steady) {
          runs.push({ torque: sign * torque, speed });
          this.record(
            `   run ${i + 1}: ${torque.toFixed(2)} N·m -> ${((Math.abs(speed) * 180) / Math.PI).toFixed(0)}°/s`,
          );
        } else {
          const why = stopped ? "stopped at the angle or speed limit" : "speed still changing";
          this.record(`   run ${i + 1}: ${torque.toFixed(2)} N·m, ${why}; not used`);
        }
        // Back toward centre before the next run, which goes the other way.
        await sleep(0.3);
      }
    } finally {
      this.measuring = false;
      await this.zero();
    }
    const fit = fitDamper(runs, coefficient, this.peakTorque);
    this.record(
      fit
        ? `   damper: ${fit.damping.toFixed(3)} N·m·s/rad, friction ${fit.friction.toFixed(2)} N·m, damperRate ${fit.damperRate.toFixed(1)} rad/s (spread ${(100 * fit.spread).toFixed(0)} %)`
        : "   damper: no fit; the speed did not grow with the torque (try the other update mode)",
    );
    return { runs, fit };
  }

  /**
   * Send a short, gentle pulse for the setup panel's "test" button. A
   * positive level should turn the wheel right; if it turns left, set the
   * scaler's `invert`.
   */
  async pulse(level = 0.25, ms = 250): Promise<void> {
    if (!this.ready) return;
    const sign = this.scaler.invert ? -1 : 1;
    this.lastUpdate = performance.now() / 1000;
    this.lastLevel = level;
    await this.sendLevel(sign * level);
    await new Promise((r) => setTimeout(r, ms));
    this.lastSent = -Infinity;
    await this.zero();
  }

  async stop(): Promise<void> {
    this.stopPlayout();
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
    this.readyValue = false;
  }
}
