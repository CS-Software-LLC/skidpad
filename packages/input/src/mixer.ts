/**
 * Several devices at once: the mixer reads every source each frame (so
 * their filters keep running) and passes on the one the player touched
 * last. Give the devices one shared {@link GearSelector} and the gear
 * follows the car whichever device shifted.
 */
import type { InputFrame } from "./index.js";
import type { GearSelector } from "./gears.js";

/** One device as the mixer sees it. */
export interface InputSource {
  /** A name for the HUD ("keyboard", "gamepad", "wheel", "touch"). */
  readonly name: string;
  /** This frame's input, or undefined when the device is absent. */
  read(dt: number): InputFrame | undefined;
}

export interface InputMixerOptions {
  /**
   * How far from rest an input must be for its device to take over
   * (default 0.15): a device takes over when one of its inputs is beyond
   * this and changing, or its gear changed. A wheel left turned but still,
   * or a pedal resting a little above zero, does not steal control.
   */
  threshold?: number;
  /** The shared gear; its value goes out in every frame. */
  gears?: GearSelector;
}

const AXES = ["steer", "throttle", "brake", "handbrake", "clutch"] as const;

/** Switches to the last device that moved. */
export class InputMixer {
  private readonly last = new Map<string, InputFrame>();
  private activeName: string | undefined;
  private readonly threshold: number;
  private readonly gears: GearSelector | undefined;

  constructor(
    private readonly sources: readonly InputSource[],
    options: InputMixerOptions = {},
  ) {
    this.threshold = options.threshold ?? 0.15;
    this.gears = options.gears;
  }

  /** The source whose input goes out, if any. */
  get active(): string | undefined {
    return this.activeName;
  }

  /** Read every source and return the active one's frame (all zeros without one). */
  update(dt: number): InputFrame {
    let chosen: InputFrame | undefined;
    let firstPresent: { name: string; frame: InputFrame } | undefined;
    const frames = new Map<string, InputFrame>();
    for (const s of this.sources) {
      const f = s.read(dt);
      if (!f) {
        this.last.delete(s.name);
        continue;
      }
      frames.set(s.name, f);
      firstPresent ??= { name: s.name, frame: f };
      const before = this.last.get(s.name);
      this.last.set(s.name, { ...f });
      if (before && this.moved(before, f) && s.name !== this.activeName) {
        this.activeName = s.name;
      }
    }
    if (this.activeName !== undefined) chosen = frames.get(this.activeName);
    if (!chosen && firstPresent) {
      // The active device went away (or none was chosen yet).
      this.activeName = firstPresent.name;
      chosen = firstPresent.frame;
    }
    if (!chosen) this.activeName = undefined;
    const out: InputFrame = chosen
      ? { ...chosen }
      : { steer: 0, throttle: 0, brake: 0, handbrake: 0, clutch: 0, gear: 0 };
    if (this.gears) out.gear = this.gears.gear;
    return out;
  }

  private moved(a: InputFrame, b: InputFrame): boolean {
    if (a.gear !== b.gear) return true;
    return AXES.some((k) => Math.abs(b[k]) > this.threshold && b[k] !== a[k]);
  }
}
