/**
 * Synthesised engine and tire-slip sound for the sandbox, built on Web Audio.
 *
 * Sound only. The core has no engine model (`drive` is a torque-versus-wheel-
 * speed curve with no gears), so the engine note comes from a virtual gearbox
 * driven by the driven-axle wheel speed: a handful of geometrically spaced
 * ratios with the top gear reaching redline at `drive.maxWheelSpeed`, and an
 * automatic shift with hysteresis. Tire squeal is band-passed noise whose
 * level follows how far each wheel is past its force peak, in combined slip,
 * which is the same quantity the per-wheel HUD shows as κ and α. Nothing here
 * feeds back into the simulation, so replays and hashes are unaffected.
 */
import type { VehicleDefinition } from "@skidpad/core";

/** Telemetry reader: channel name to current value. */
export type ChannelReader = (name: string) => number;

const AXLES = ["F", "R"] as const;
const WHEELS = ["FL", "FR", "RL", "RR"] as const;
const G = 9.80665;

/** Virtual engine figures. One set for every preset; only the gearing scales. */
const IDLE_RPM = 900;
const REDLINE_RPM = 7000;
const GEARS = 5;
/** First-gear overall ratio divided by top-gear ratio. */
const RATIO_SPAN = 3.6;
const UPSHIFT_RPM = 0.93 * REDLINE_RPM;
const DOWNSHIFT_RPM = 0.4 * REDLINE_RPM;
/** Core default for the feel tire's `peakSlipRatio`. */
const DEFAULT_PEAK_SLIP_RATIO = 0.12;
const DEFAULT_PEAK_SLIP_ANGLE_DEG = 7;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export class SandboxAudio {
  private ctx: AudioContext | undefined;
  private master!: GainNode;
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private oscillators: OscillatorNode[] = [];
  private squealGain!: GainNode;
  private squealFilters: BiquadFilterNode[] = [];
  private noise!: AudioBufferSourceNode;

  private _volume = 0.5;
  /** Overall gear ratios, first gear first, rad/s of wheel to rad/s of engine. */
  private ratios: number[] = [];
  private gear = 0;
  private rpm = IDLE_RPM;
  private squeal = 0;
  /** Last engine rpm and gear, for the HUD. */
  get engineRpm(): number {
    return this.rpm;
  }
  get currentGear(): number {
    return this.gear + 1;
  }
  get squealLevel(): number {
    return this.squeal;
  }

  /** True while the context exists and is running. */
  get enabled(): boolean {
    return this.ctx !== undefined && this.ctx.state === "running";
  }

  get volume(): number {
    return this._volume;
  }
  set volume(v: number) {
    this._volume = clamp01(v);
    if (this.ctx) {
      this.master.gain.setTargetAtTime(this._volume, this.ctx.currentTime, 0.02);
    }
  }

  /**
   * Create the context and start the sources. Must be called from a user
   * gesture (click, key press) or the browser keeps the context suspended.
   */
  async enable(): Promise<void> {
    if (!this.ctx) this.build();
    await this.ctx!.resume();
  }

  async disable(): Promise<void> {
    await this.ctx?.suspend();
  }

  async toggle(): Promise<boolean> {
    if (this.enabled) await this.disable();
    else await this.enable();
    return this.enabled;
  }

  /** Re-derive the gearing when the preset changes, and drop to first gear. */
  setDefinition(def: VehicleDefinition): void {
    const redlineRad = (REDLINE_RPM * 2 * Math.PI) / 60;
    // Top gear reaches redline a little past the speed where drive torque fades out.
    const top = redlineRad / (def.drive.maxWheelSpeed * 1.05);
    const step = Math.pow(RATIO_SPAN, 1 / (GEARS - 1));
    this.ratios = [];
    for (let i = 0; i < GEARS; i++) this.ratios.push(top * Math.pow(step, GEARS - 1 - i));
    this.gear = 0;
    this.rpm = IDLE_RPM;
  }

  /** Call once per animation frame with the wall-clock delta in seconds. */
  update(dt: number, read: ChannelReader, def: VehicleDefinition): void {
    this.updateEngine(dt, read, def);
    this.updateSqueal(dt, read, def);
    if (!this.enabled) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const throttle = clamp01(read("Throttle"));
    // A four-stroke four: two firings per revolution.
    const firing = this.rpm / 30;
    this.oscillators[0]!.frequency.setTargetAtTime(firing, t, 0.03);
    this.oscillators[1]!.frequency.setTargetAtTime(firing / 2, t, 0.03);
    this.oscillators[2]!.frequency.setTargetAtTime(firing * 2, t, 0.03);
    const rpmFrac = (this.rpm - IDLE_RPM) / (REDLINE_RPM - IDLE_RPM);
    // Louder and brighter under load; quieter and duller on the overrun.
    this.engineFilter.frequency.setTargetAtTime(300 + 900 * rpmFrac + 1800 * throttle, t, 0.05);
    this.engineGain.gain.setTargetAtTime(0.12 + 0.1 * rpmFrac + 0.28 * throttle, t, 0.05);

    const s = this.squeal;
    this.squealGain.gain.setTargetAtTime(0.9 * Math.pow(s, 1.4), t, 0.03);
    // Squeal pitch climbs with how hard the tire is sliding.
    const centre = 650 + 1100 * s;
    this.squealFilters[0]!.frequency.setTargetAtTime(centre, t, 0.05);
    this.squealFilters[1]!.frequency.setTargetAtTime(centre * 2.3, t, 0.05);
  }

  private updateEngine(dt: number, read: ChannelReader, def: VehicleDefinition): void {
    if (this.ratios.length === 0) this.setDefinition(def);
    let omega = 0;
    let driven = 0;
    def.axles.forEach((axle, i) => {
      if (!axle.driven) return;
      omega += Math.abs(read(`WheelSpeed_${AXLES[i] ?? "F"}`));
      driven++;
    });
    omega = driven > 0 ? omega / driven : 0;
    const toRpm = 60 / (2 * Math.PI);
    let target = omega * this.ratios[this.gear]! * toRpm;
    if (target > UPSHIFT_RPM && this.gear < GEARS - 1) {
      this.gear++;
      target = omega * this.ratios[this.gear]! * toRpm;
    } else if (target < DOWNSHIFT_RPM && this.gear > 0) {
      this.gear--;
      target = omega * this.ratios[this.gear]! * toRpm;
    }
    target = Math.min(REDLINE_RPM, Math.max(IDLE_RPM, target));
    // Slew so a shift reads as a drop in the note instead of a click.
    this.rpm += (target - this.rpm) * Math.min(1, dt / 0.08);
  }

  private updateSqueal(dt: number, read: ChannelReader, def: VehicleDefinition): void {
    const speed = Math.abs(read("Speed"));
    const staticLoad = (def.chassis.mass * G) / 4;
    let total = 0;
    WHEELS.forEach((w, i) => {
      if (read(`WheelContact_${w}`) < 0.5) return;
      const axle = def.axles[i < 2 ? 0 : 1];
      const tire = axle?.tire;
      const feel = tire?.model === "feel" ? tire : undefined;
      const radius = (feel?.radius ?? 0.3) as number;
      const kappaPeak = feel?.peakSlipRatio ?? DEFAULT_PEAK_SLIP_RATIO;
      const alphaPeak = ((feel?.peakSlipAngleDeg ?? DEFAULT_PEAK_SLIP_ANGLE_DEG) * Math.PI) / 180;
      const kappa = read(`SlipRatio_${w}`) / kappaPeak;
      const alpha = read(`SlipAngle_${w}`) / alphaPeak;
      // Combined slip relative to the force peak: 1 at the peak, beyond it the tire slides.
      const slip = Math.sqrt(kappa * kappa + alpha * alpha);
      const excess = clamp01((slip - 0.85) / 0.75);
      const load = clamp01(read(`TireLoad_${w}`) / staticLoad);
      // No squeal at a crawl, but a spinning wheel on a standing car counts.
      const sliding = Math.max(speed, Math.abs(read(`WheelSpeed_${w}`)) * radius);
      const gate = clamp01((sliding - 0.8) / 3);
      total += excess * load * gate;
    });
    total = clamp01(total);
    const tau = total > this.squeal ? 0.05 : 0.15;
    this.squeal += (total - this.squeal) * Math.min(1, dt / tau);
  }

  private build(): void {
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this._volume;
    this.master.connect(ctx.destination);

    // Engine: three detuned oscillators into a low-pass, so the note gets
    // brighter as the throttle opens.
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.Q.value = 1.2;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter.connect(this.engineGain).connect(this.master);
    const voices: Array<[OscillatorType, number, number]> = [
      ["sawtooth", 1, 0.5],
      ["square", 0.5, 0.3],
      ["sawtooth", 2, 0.15],
    ];
    this.oscillators = voices.map(([type, mult, level], i) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = (IDLE_RPM / 30) * mult;
      osc.detune.value = (i - 1) * 6;
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g).connect(this.engineFilter);
      osc.start();
      return osc;
    });

    // Squeal: looped white noise through two band-passes in parallel, a
    // narrow one for the tone and a wider one an octave-and-a-bit up for bite.
    const seconds = 2;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = ctx.createBufferSource();
    this.noise.buffer = buffer;
    this.noise.loop = true;
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    this.squealGain.connect(this.master);
    this.squealFilters = [
      [8, 1],
      [3, 0.35],
    ].map(([q, level]) => {
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.Q.value = q!;
      f.frequency.value = 650;
      const g = ctx.createGain();
      g.gain.value = level!;
      this.noise.connect(f).connect(g).connect(this.squealGain);
      return f;
    });
    this.noise.start();
  }

  dispose(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.ctx = undefined;
    for (const o of this.oscillators) o.stop();
    this.noise.stop();
    void ctx.close();
  }
}
