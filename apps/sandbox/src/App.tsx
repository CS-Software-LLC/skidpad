import { useEffect, useRef, useState } from "react";
import { Scene } from "./Scene.js";
import { Graph } from "./Graph.js";
import { Sim, presetIds, type PresetId } from "./sim.js";
import { ClipRecorder, download } from "./record.js";

interface HudState {
  speedKmh: number;
  latG: number;
  longG: number;
  slipF: number;
  slipR: number;
  ratioR: number;
  steerDeg: number;
  torque: number;
  lockedF: boolean;
  lockedR: boolean;
  stepMs: number;
  hash: string;
}

export function App() {
  const [sim, setSim] = useState<Sim | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [presetId, setPresetId] = useState<PresetId>("hatchbackFwd");
  const [hud, setHud] = useState<HudState | null>(null);
  const [recording, setRecording] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const clip = useRef(new ClipRecorder());

  useEffect(() => {
    // StrictMode runs effects twice; only the surviving instance may publish
    // itself and attach input listeners.
    let cancelled = false;
    const s = new Sim();
    s.load()
      .then(() => {
        if (cancelled) s.dispose();
        else setSim(s);
      })
      .catch((e: unknown) => setError(String(e)));
    return () => {
      cancelled = true;
      s.dispose();
    };
  }, []);

  useEffect(() => {
    if (!sim) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "KeyR" && !e.repeat) sim.reset();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sim]);

  useEffect(() => {
    if (!sim) return;
    const id = setInterval(() => {
      const w = sim.world;
      const v = sim.vehicle;
      setHud({
        speedKmh: w.read(v, "Speed") * 3.6,
        latG: w.read(v, "LatAccel") / 9.81,
        longG: w.read(v, "LongAccel") / 9.81,
        slipF: (w.read(v, "SlipAngle_F") * 180) / Math.PI,
        slipR: (w.read(v, "SlipAngle_R") * 180) / Math.PI,
        ratioR: w.read(v, "SlipRatio_R"),
        steerDeg: (w.read(v, "SteeringWheelAngle") * 180) / Math.PI,
        torque: w.read(v, "SteeringTorque"),
        lockedF: w.read(v, "WheelLocked_F") > 0.5,
        lockedR: w.read(v, "WheelLocked_R") > 0.5,
        stepMs: sim.stepCostMs,
        hash: w.stateHash(v),
      });
    }, 100);
    return () => clearInterval(id);
  }, [sim]);

  if (error) return <div className="error">Failed to load the core:\n{error}</div>;
  if (!sim)
    return (
      <div className="error" style={{ color: "#9aa4b5" }}>
        Loading Contact Patch…
      </div>
    );

  return (
    <>
      <Scene sim={sim} canvasRef={canvasRef} />
      <div className="hud">
        <h1>Contact Patch sandbox · {sim.definition.name}</h1>
        {hud && (
          <>
            <div className="big">{hud.speedKmh.toFixed(0)} km/h</div>
            <table>
              <tbody>
                <tr>
                  <td>Lat / long accel</td>
                  <td>
                    {hud.latG.toFixed(2)} g / {hud.longG.toFixed(2)} g
                  </td>
                </tr>
                <tr>
                  <td>Slip angle F / R</td>
                  <td>
                    {hud.slipF.toFixed(1)}° / {hud.slipR.toFixed(1)}°
                  </td>
                </tr>
                <tr>
                  <td>Slip ratio R</td>
                  <td>
                    {hud.ratioR.toFixed(3)}
                    {hud.lockedR ? " (locked)" : ""}
                    {hud.lockedF ? " F locked" : ""}
                  </td>
                </tr>
                <tr>
                  <td>Steering wheel</td>
                  <td>
                    {hud.steerDeg.toFixed(0)}° · {hud.torque.toFixed(1)} N·m
                  </td>
                </tr>
                <tr>
                  <td>Step cost</td>
                  <td>{hud.stepMs.toFixed(3)} ms / 60 Hz step</td>
                </tr>
                <tr>
                  <td>State hash</td>
                  <td style={{ fontFamily: "monospace" }}>{hud.hash}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}
      </div>
      <div className="controls">
        <select
          value={presetId}
          onChange={(e) => {
            const id = e.target.value as PresetId;
            setPresetId(id);
            sim.setPreset(id);
          }}
        >
          {presetIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        <button onClick={() => sim.reset()}>Reset (R)</button>
        <button
          onClick={() => {
            const csv = sim.recorder.toCSV();
            download(new Blob([csv], { type: "text/csv" }), `contactpatch-${presetId}.csv`);
          }}
        >
          Export telemetry CSV
        </button>
        <button
          onClick={async () => {
            if (!canvasRef.current) return;
            if (clip.current.recording) {
              const blob = await clip.current.stop();
              download(blob, `contactpatch-${presetId}.webm`);
              setRecording(false);
            } else {
              clip.current.start(canvasRef.current);
              setRecording(true);
            }
          }}
        >
          {recording ? "Stop recording" : "Record clip (WebM)"}
        </button>
      </div>
      <div className="help">WASD / arrows to drive · Space handbrake · gamepad supported</div>
      <Graph recorder={sim.recorder} />
    </>
  );
}
