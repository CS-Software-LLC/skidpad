import { useEffect, useRef, useState } from "react";
import { Scene } from "./Scene.js";
import { Graph } from "./Graph.js";
import { Sim, presetIds, hostKinds, type HostKind, type PresetId } from "./sim.js";
import { ClipRecorder, download } from "./record.js";

interface WheelHud {
  load: number;
  slipRatio: number;
  slipAngle: number;
  travel: number;
  locked: boolean;
  contact: boolean;
}

interface HudState {
  speedKmh: number;
  latG: number;
  longG: number;
  rollDeg: number;
  pitchDeg: number;
  slipF: number;
  slipR: number;
  steerDeg: number;
  torque: number;
  stepMs: number;
  hash: string;
  wheels: WheelHud[];
  staticLoad: number;
}

const WHEEL_NAMES = ["FL", "FR", "RL", "RR"] as const;

export function App() {
  const [sim, setSim] = useState<Sim | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [presetId, setPresetId] = useState<PresetId>("hatchbackFwd");
  const [hostKind, setHostKind] = useState<HostKind>("builtin");
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

  if (error) return <div className="error">Failed to load the core:\n{error}</div>;
  if (!sim)
    return (
      <div className="error" style={{ color: "#9aa4b5" }}>
        Loading Skidpad…
      </div>
    );

  return (
    <>
      <Scene sim={sim} hostKind={hostKind} canvasRef={canvasRef} />
      <Hud sim={sim} />
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
        <select
          value={hostKind}
          onChange={(e) => {
            const kind = e.target.value as HostKind;
            sim
              .setHost(kind)
              .then(() => setHostKind(kind))
              .catch((err: unknown) => setError(String(err)));
          }}
        >
          {hostKinds.map((k) => (
            <option key={k} value={k}>
              {k === "builtin"
                ? "Host: built-in (flat ground)"
                : "Host: Rapier (bumps, ramp, kerb)"}
            </option>
          ))}
        </select>
        <button onClick={() => sim.reset()}>Reset (R)</button>
        <button
          onClick={() => {
            const csv = sim.recorder.toCSV();
            download(new Blob([csv], { type: "text/csv" }), `skidpad-${presetId}.csv`);
          }}
        >
          Export telemetry CSV
        </button>
        <button
          onClick={async () => {
            if (!canvasRef.current) return;
            if (clip.current.recording) {
              const blob = await clip.current.stop();
              download(blob, `skidpad-${presetId}.webm`);
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
      <div className="help">
        WASD / arrows to drive · Space handbrake · R reset · gamepad supported · the ramp is 70 m
        ahead under the Rapier host
      </div>
      <Graph recorder={sim.recorder} />
    </>
  );
}

/** Live readout. Owns its own 10 Hz state so the scene tree never re-renders. */
function Hud({ sim }: { sim: Sim }) {
  const [hud, setHud] = useState<HudState | null>(null);
  useEffect(() => {
    const id = setInterval(() => {
      const w = sim.world;
      const v = sim.vehicle;
      const deg = 180 / Math.PI;
      setHud({
        speedKmh: w.read(v, "Speed") * 3.6,
        latG: w.read(v, "LatAccel") / 9.81,
        longG: w.read(v, "LongAccel") / 9.81,
        rollDeg: w.read(v, "Roll") * deg,
        pitchDeg: w.read(v, "Pitch") * deg,
        slipF: w.read(v, "SlipAngle_F") * deg,
        slipR: w.read(v, "SlipAngle_R") * deg,
        steerDeg: w.read(v, "SteeringWheelAngle") * deg,
        torque: w.read(v, "SteeringTorque"),
        stepMs: sim.stepCostMs,
        hash: w.stateHash(v),
        staticLoad: (sim.definition.chassis.mass * 9.80665) / 4,
        wheels: WHEEL_NAMES.map((n) => ({
          load: w.read(v, `TireLoad_${n}`),
          slipRatio: w.read(v, `SlipRatio_${n}`),
          slipAngle: w.read(v, `SlipAngle_${n}`) * deg,
          travel: w.read(v, `SuspTravel_${n}`) * 1000,
          locked: w.read(v, `WheelLocked_${n}`) > 0.5,
          contact: w.read(v, `WheelContact_${n}`) > 0.5,
        })),
      });
    }, 100);
    return () => clearInterval(id);
  }, [sim]);
  return (
    <div className="hud">
      <h1>Skidpad sandbox · {sim.definition.name}</h1>
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
                <td>Roll / pitch</td>
                <td>
                  {hud.rollDeg.toFixed(1)}° / {hud.pitchDeg.toFixed(1)}°
                </td>
              </tr>
              <tr>
                <td>Slip angle F / R</td>
                <td>
                  {hud.slipF.toFixed(1)}° / {hud.slipR.toFixed(1)}°
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
          <div className="wheels">
            {hud.wheels.map((wh, i) => (
              <div key={i} className={`wheel${wh.contact ? "" : " airborne"}`}>
                <div className="wheel-name">
                  {WHEEL_NAMES[i]}
                  {wh.locked ? " · locked" : ""}
                  {wh.contact ? "" : " · air"}
                </div>
                <div className="bar">
                  <div
                    className="bar-fill"
                    style={{ width: `${Math.min(100, (wh.load / hud.staticLoad) * 50)}%` }}
                  />
                </div>
                <div className="wheel-row">
                  <span>{wh.load.toFixed(0)} N</span>
                  <span>
                    {wh.travel >= 0 ? "+" : ""}
                    {wh.travel.toFixed(0)} mm
                  </span>
                </div>
                <div className="wheel-row">
                  <span>κ {wh.slipRatio.toFixed(2)}</span>
                  <span>α {wh.slipAngle.toFixed(1)}°</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
