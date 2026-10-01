/**
 * Framework-agnostic tire-curve explorer. Draws lateral and longitudinal
 * curves from the real core (compat build) onto a canvas, with the current
 * load and camber. The Vue wrapper only handles mounting and controls.
 */
import { init, type Tire, type Skidpad, type TireDefinition } from "@skidpad/core/compat";

export interface ExplorerState {
  fz: number;
  camberDeg: number;
  otherSlipRatio: number;
  model: "feel" | "mf";
  peakFriction: number;
  peakSlipAngleDeg: number;
  corneringStiffness: number;
  falloff: number;
}

export const defaultState: ExplorerState = {
  fz: 4000,
  camberDeg: 0,
  otherSlipRatio: 0,
  model: "feel",
  peakFriction: 1.0,
  peakSlipAngleDeg: 7,
  corneringStiffness: 18,
  falloff: 0.85,
};

export class TireExplorer {
  private sp: Skidpad | undefined;
  private tire: Tire | undefined;
  private key = "";

  constructor(private readonly canvas: HTMLCanvasElement) {}

  async load(): Promise<void> {
    this.sp = await init();
  }

  private definition(s: ExplorerState): TireDefinition {
    if (s.model === "mf") return { model: "magicFormula" };
    return {
      model: "feel",
      peakFriction: s.peakFriction,
      peakSlipAngleDeg: s.peakSlipAngleDeg,
      corneringStiffness: s.corneringStiffness,
      falloffLat: s.falloff,
      falloffLong: s.falloff,
    };
  }

  draw(s: ExplorerState): void {
    if (!this.sp) return;
    const key = JSON.stringify(this.definition(s));
    if (key !== this.key) {
      this.tire?.free();
      this.tire = this.sp.createTire(this.definition(s));
      this.key = key;
    }
    const tire = this.tire!;
    const canvas = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = (canvas.width = canvas.clientWidth * dpr);
    const h = (canvas.height = Math.max(240, canvas.clientWidth * 0.5) * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, w, h);
    const pad = 44 * dpr;
    const camber = (s.camberDeg * Math.PI) / 180;
    const n = 200;
    const maxDeg = 20;
    const lat = tire.sweep({
      axis: "slipAngle",
      from: 0,
      to: (maxDeg * Math.PI) / 180,
      n,
      fz: s.fz,
      otherSlip: s.otherSlipRatio,
      camber,
    });
    const latPure = tire.sweep({
      axis: "slipAngle",
      from: 0,
      to: (maxDeg * Math.PI) / 180,
      n,
      fz: s.fz,
      otherSlip: 0,
      camber,
    });
    const lon = tire.sweep({
      axis: "slipRatio",
      from: 0,
      to: 0.5,
      n,
      fz: s.fz,
      otherSlip: 0,
      camber: 0,
    });
    // The aligning moment goes negative past the limit (ADR-0008), so the
    // vertical range reaches a little below zero.
    const yMax = s.fz * 1.6;
    const yMin = -s.fz * 0.25;
    const x = (i: number) => pad + ((w - 2 * pad) * i) / (n - 1);
    const y = (v: number) => h - pad - ((h - 2 * pad) * (v - yMin)) / (yMax - yMin);

    // Axes and friction limit.
    ctx.strokeStyle = "#8884";
    ctx.lineWidth = dpr;
    ctx.beginPath();
    ctx.moveTo(pad, y(0));
    ctx.lineTo(w - pad, y(0));
    ctx.moveTo(pad, pad);
    ctx.lineTo(pad, h - pad);
    ctx.stroke();
    ctx.setLineDash([2 * dpr, 4 * dpr]);
    ctx.beginPath();
    ctx.moveTo(pad, y(yMin));
    ctx.lineTo(w - pad, y(yMin));
    ctx.stroke();
    ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.beginPath();
    ctx.moveTo(pad, y(s.fz));
    ctx.lineTo(w - pad, y(s.fz));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#888";
    ctx.font = `${11 * dpr}px system-ui`;
    ctx.fillText(`Fz = ${s.fz.toFixed(0)} N (μ = 1 line)`, pad + 4 * dpr, y(s.fz) - 4 * dpr);
    ctx.fillText(`slip angle 0 … ${maxDeg}°   |   slip ratio 0 … 0.5`, pad, h - pad + 16 * dpr);

    const series = (data: Float64Array, idx: number, sign: number, color: string, dash = false) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 * dpr;
      if (dash) ctx.setLineDash([6 * dpr, 4 * dpr]);
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const v = sign * (data[i * 8 + idx] ?? 0);
        if (i === 0) ctx.moveTo(x(i), y(v));
        else ctx.lineTo(x(i), y(v));
      }
      ctx.stroke();
      ctx.setLineDash([]);
    };
    series(latPure, 1, -1, "#ffb454", s.otherSlipRatio !== 0);
    if (s.otherSlipRatio !== 0) series(lat, 1, -1, "#ff6b6b");
    series(lon, 0, 1, "#4fd1c5");
    // Aligning moment, scaled ×20 for visibility.
    series(latPure, 2, 20, "#c3a6ff");

    const legend = [
      ["−Fy (lateral)", "#ffb454"],
      ...(s.otherSlipRatio !== 0 ? [[`−Fy with κ = ${s.otherSlipRatio}`, "#ff6b6b"]] : []),
      ["Fx (longitudinal)", "#4fd1c5"],
      ["Mz × 20", "#c3a6ff"],
    ];
    legend.forEach(([label, color], i) => {
      ctx.fillStyle = color!;
      ctx.fillText(label!, w - pad - 150 * dpr, pad + (14 + i * 14) * dpr);
    });
  }

  dispose(): void {
    this.tire?.free();
  }
}
