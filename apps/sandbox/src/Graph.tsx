import { useEffect, useRef } from "react";
import type { TelemetryRecorder } from "@contactpatch/telemetry";

const SERIES: Array<{ channel: string; color: string; scale: number; label: string }> = [
  { channel: "SlipAngle_F", color: "#ffb454", scale: 0.2, label: "Slip angle F (±0.2 rad)" },
  { channel: "SlipAngle_R", color: "#ff6b6b", scale: 0.2, label: "Slip angle R" },
  { channel: "SlipRatio_R", color: "#4fd1c5", scale: 1, label: "Slip ratio R (±1)" },
  { channel: "LatAccel", color: "#8ab4ff", scale: 12, label: "Lat accel (±12 m/s²)" },
  { channel: "SteeringTorque", color: "#c3a6ff", scale: 20, label: "Steering torque (±20 N·m)" },
];

/** Scrolling multi-channel graph drawn straight from the ring buffer. */
export function Graph({ recorder }: { recorder: TelemetryRecorder }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    const buf = new Float64Array(recorder.capacity);
    const draw = () => {
      const w = (canvas.width = canvas.clientWidth * devicePixelRatio);
      const h = (canvas.height = canvas.clientHeight * devicePixelRatio);
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = "#3a4152";
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      const n = recorder.length;
      const window = Math.min(n, 600);
      SERIES.forEach((s, si) => {
        const data = recorder.series(s.channel, buf);
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1.5 * devicePixelRatio;
        ctx.beginPath();
        for (let i = 0; i < window; i++) {
          const v = data[n - window + i] ?? 0;
          const x = (i / 600) * w;
          const y = h / 2 - (v / s.scale) * (h / 2) * 0.9;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.fillStyle = s.color;
        ctx.font = `${11 * devicePixelRatio}px system-ui`;
        ctx.fillText(s.label, 8 * devicePixelRatio, (14 + si * 13) * devicePixelRatio);
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [recorder]);
  return <canvas ref={ref} className="graph" />;
}
