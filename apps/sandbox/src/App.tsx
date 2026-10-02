import { useEffect, useRef, useState } from "react";
import { Scene, type CameraView } from "./Scene.js";
import { Graph } from "./Graph.js";
import { surfaceId, surfaces, type SurfaceId } from "@skidpad/presets";
import { Sim, presetIds, hostKinds, type HostKind, type PresetId } from "./sim.js";
import { ClipRecorder, download } from "./record.js";
import { WheelPanel } from "./WheelPanel.js";
import { TuningPanel } from "./TuningPanel.js";

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
  engine: boolean;
  rpm: number;
  gear: number;
  clutchSlip: number;
  squeal: number;
  stepMs: number;
  hash: string;
  wheels: WheelHud[];
  staticLoad: number;
  surface: string;
  surfaceGrip: number;
}

const WHEEL_NAMES = ["FL", "FR", "RL", "RR"] as const;
const SOUND_KEY = "skidpad.sandbox.sound";
const VOLUME_KEY = "skidpad.sandbox.volume";

function readStoredVolume(): number {
  const v = Number(localStorage.getItem(VOLUME_KEY));
  return Number.isFinite(v) && localStorage.getItem(VOLUME_KEY) !== null ? v : 0.5;
}

export function App() {
  const [sim, setSim] = useState<Sim | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [presetId, setPresetId] = useState<PresetId>("hatchbackFwd");
  const [hostKind, setHostKind] = useState<HostKind>("builtin");
  const [primitives, setPrimitives] = useState(false);
  const [cameraView, setCameraView] = useState<CameraView>("chase");
  const [recording, setRecording] = useState(false);
  const [sound, setSound] = useState(false);
  const [volume, setVolume] = useState(() => readStoredVolume());
  const [surface, setSurface] = useState<SurfaceId>("asphaltDry");
  // Counts definition changes (preset switches, tuning edits) so the parts
  // of the tree that read `sim.definition` at render pick them up.
  const [revision, setRevision] = useState(0);
  const bump = () => setRevision((r) => r + 1);
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

  // Browsers only start audio from a user gesture. If sound was on last
  // time, resume it on the first key press or click instead of asking again.
  useEffect(() => {
    if (!sim) return;
    sim.audio.volume = volume;
    if (localStorage.getItem(SOUND_KEY) !== "on") return;
    const arm = () => {
      sim.audio
        .enable()
        .then(() => setSound(sim.audio.enabled))
        .catch(() => undefined);
    };
    window.addEventListener("keydown", arm, { once: true });
    window.addEventListener("pointerdown", arm, { once: true });
    return () => {
      window.removeEventListener("keydown", arm);
      window.removeEventListener("pointerdown", arm);
    };
  }, [sim]);

  useEffect(() => {
    if (sim) sim.audio.volume = volume;
    localStorage.setItem(VOLUME_KEY, String(volume));
  }, [sim, volume]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!sim || !canvas) return;
    return sim.attachTouch(canvas);
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
      <Scene
        sim={sim}
        hostKind={hostKind}
        surface={surface}
        revision={revision}
        primitives={primitives}
        cameraView={cameraView}
        canvasRef={canvasRef}
      />
      <Hud sim={sim} />
      <div className="right">
        <div className="panels">
          <WheelPanel sim={sim} />
          <TuningPanel sim={sim} revision={revision} onApplied={bump} />
        </div>
        <div className="controls">
          <select
            value={presetId}
            onChange={(e) => {
              const id = e.target.value as PresetId;
              setPresetId(id);
              sim.setPreset(id);
              bump();
            }}
          >
            {presetIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
          <select
            value={surface}
            onChange={(e) => {
              const id = e.target.value as SurfaceId;
              setSurface(id);
              sim.setSurface(surfaceId(id));
            }}
          >
            {surfaces.map((s) => (
              <option key={s.id} value={s.id}>
                Surface: {s.name}
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
          <button aria-pressed={primitives} onClick={() => setPrimitives((value) => !value)}>
            {primitives ? "Visuals: primitives" : "Visuals: detailed"}
          </button>
          <select
            aria-label="Camera view"
            value={cameraView}
            onChange={(e) => setCameraView(e.target.value as CameraView)}
          >
            <option value="chase">Camera: straight behind</option>
            <option value="offsetChase">Camera: offset chase</option>
            <option value="frontQuarter">Camera: front quarter</option>
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
              const on = await sim.audio.toggle();
              setSound(on);
              localStorage.setItem(SOUND_KEY, on ? "on" : "off");
            }}
          >
            {sound ? "Sound: on" : "Sound: off"}
          </button>
          <label className="volume">
            Volume
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
            />
          </label>
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
      </div>
      <div className="help">
        WASD / arrows to drive · Space handbrake · Q / E shift down / up (E from neutral for drive,
        Q below first for reverse) · C clutch · R reset · gamepad supported · the ramp is 70 m ahead
        under the Rapier host · sound follows the engine plus tire squeal past the grip peak ·
        Tuning edits the running car live (reset, copy, download or load its JSON) · the Surface
        menu changes the grip under the wheels · detailed body available for hatchbackFwd; other
        presets use primitive bodies · roadside props are visual markers
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
        engine: sim.hasEngine,
        rpm: sim.hasEngine ? w.read(v, "EngineRpm") : sim.audio.engineRpm,
        gear: sim.hasEngine ? w.read(v, "Gear") : sim.audio.currentGear,

        clutchSlip: w.read(v, "ClutchSlip"),
        squeal: sim.audio.squealLevel,
        stepMs: sim.stepCostMs,
        hash: w.stateHash(v),
        staticLoad: (sim.definition.chassis.mass * 9.80665) / 4,
        surface: surfaces[w.read(v, "SurfaceId_FL")]?.name ?? `#${w.read(v, "SurfaceId_FL")}`,
        surfaceGrip: w.read(v, "SurfaceGrip_FL"),
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
                <td>{hud.engine ? "Engine" : "Engine (sound only)"}</td>
                <td>
                  {hud.rpm.toFixed(0)} rpm · gear{" "}
                  {hud.gear < 0 ? "R" : hud.gear === 0 ? "N" : hud.gear}
                  {hud.engine && Math.abs(hud.clutchSlip) > 5 ? " · clutch slipping" : ""} · squeal{" "}
                  {(hud.squeal * 100).toFixed(0)}%
                </td>
              </tr>
              <tr>
                <td>Surface</td>
                <td>
                  {hud.surface} · grip ×{hud.surfaceGrip.toFixed(2)}
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
