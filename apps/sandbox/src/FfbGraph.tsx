import { useEffect, useRef } from "react";
import { FFB_PARTS, type FfbTrace } from "./ffbTrace.js";

const PART_COLORS = ["#ffb454", "#8ab4ff", "#4fd1c5", "#9be7a1", "#f6a6c1"];

/**
 * Requested versus sent torque at the rim, with clipped frames marked and
 * the device's full scale as dashed lines, plus the car torque by source
 * (thin), like BeamNG's FFB graph. The scale follows the larger of the
 * full scale and the peak on screen.
 */
export function FfbGraph({ trace }: { trace: FfbTrace }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    const draw = () => {
      const px = devicePixelRatio;
      const w = (canvas.width = canvas.clientWidth * px);
      const h = (canvas.height = canvas.clientHeight * px);
      ctx.clearRect(0, 0, w, h);
      const n = Math.min(trace.count, trace.capacity);
      let span = Math.max(trace.fullScale, 0.5);
      for (let k = 0; k < n; k++) span = Math.max(span, Math.abs(trace.requested[trace.at(k, n)]!));
      span *= 1.1;
      const x = (k: number) => ((k + trace.capacity - n) / trace.capacity) * w;
      const y = (v: number) => h / 2 - (v / span) * (h / 2);
      ctx.strokeStyle = "#3a4152";
      ctx.lineWidth = px;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      if (trace.fullScale > 0) {
        ctx.setLineDash([4 * px, 4 * px]);
        ctx.strokeStyle = "#6b7385";
        for (const s of [1, -1]) {
          ctx.beginPath();
          ctx.moveTo(0, y(s * trace.fullScale));
          ctx.lineTo(w, y(s * trace.fullScale));
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
      // Clipped frames as red bars along the bottom.
      ctx.fillStyle = "rgba(255, 90, 90, 0.8)";
      for (let k = 0; k < n; k++) {
        if (trace.clipped[trace.at(k, n)])
          ctx.fillRect(x(k), h - 4 * px, Math.max(px, w / trace.capacity), 4 * px);
      }
      const line = (data: Float64Array, color: string, width: number) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width * px;
        ctx.beginPath();
        for (let k = 0; k < n; k++) {
          const v = data[trace.at(k, n)]!;
          if (k === 0) ctx.moveTo(x(k), y(v));
          else ctx.lineTo(x(k), y(v));
        }
        ctx.stroke();
      };
      trace.parts.forEach((d, i) => line(d, PART_COLORS[i]!, 0.75));
      line(trace.requested, "#c3a6ff", 1.5);
      line(trace.sent, "#ffffff", 1.5);
      ctx.font = `${11 * px}px system-ui`;
      const labels: Array<[string, string]> = [
        ["#c3a6ff", "requested"],
        ["#ffffff", "sent"],
        ...FFB_PARTS.map(([, label], i): [string, string] => [PART_COLORS[i]!, label]),
        ["#ff5a5a", "clipped"],
      ];
      let lx = 6 * px;
      for (const [color, label] of labels) {
        ctx.fillStyle = color;
        ctx.fillText(label, lx, 13 * px);
        lx += ctx.measureText(label).width + 10 * px;
      }
      ctx.fillStyle = "#9aa3b5";
      ctx.fillText(`±${(span / 1.1).toFixed(1)} N·m`, w - 70 * px, h - 8 * px);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [trace]);
  return <canvas ref={ref} className="ffb-graph" />;
}
