/**
 * Wheel setup: which devices are seen, assigning and calibrating each
 * control by moving it, force feedback over WebHID with a diagnostics log,
 * and the driving assists.
 */
import { useEffect, useRef, useState } from "react";
import {
  AxisCalibrator,
  AxisFinder,
  GamepadRumbleSink,
  LogitechWebHidSink,
  builtinProfiles,
  saveProfiles,
  webHid,
  type AxisBinding,
  type DeviceRole,
  type LogitechProtocol,
  type WheelProfile,
} from "@skidpad/input";
import type { Sim } from "./sim.js";

type Control = "steer" | "throttle" | "brake" | "clutch";
const CONTROLS: Control[] = ["steer", "throttle", "brake", "clutch"];
const ASSISTS = [
  ["abs", "ABS"],
  ["tractionControl", "Traction control"],
  ["stabilityControl", "Stability control"],
  ["steeringAssist", "Speed-sensitive steering"],
] as const;

interface Status {
  source: string;
  profile: string;
  wheel: string;
  pedals: string;
  angle: number;
  ffb: string;
  clip: number;
  tripped: string | undefined;
  torque: number;
}

export function WheelPanel({ sim }: { sim: Sim }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [assigning, setAssigning] = useState<Control | null>(null);
  const [message, setMessage] = useState("");
  const [protocol, setProtocol] = useState<LogitechProtocol | "auto">("auto");
  const [updateMode, setUpdateMode] = useState<"modify" | "recreate">("modify");
  // Conservative defaults: this page is public and a direct-drive wheel is
  // strong enough to hurt. Raise them deliberately.
  const [gain, setGain] = useState(0.5);
  const [maxOutput, setMaxOutput] = useState(0.4);
  const [invert, setInvert] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [assists, setAssists] = useState(() => currentAssists(sim));
  const sink = useRef<LogitechWebHidSink | null>(null);

  // Live status at 10 Hz.
  useEffect(() => {
    const id = setInterval(() => {
      const w = sim.wheel.status;
      const s = sim.ffbSink;
      setStatus({
        source: sim.inputSource,
        profile: w.profile?.name ?? "none matched",
        wheel: w.wheel?.id ?? "no wheel",
        pedals: w.pedals?.id ?? (w.wheel ? "on the wheel base" : "none"),
        angle: w.wheelAngleDeg,
        ffb: s ? `${s.name}${s.connected ? "" : " (not connected)"}` : "off",
        clip: sink.current?.scaler.clipFraction ?? 0,
        tripped: sink.current?.scaler.tripped,
        torque: sim.world.read(sim.vehicle, "SteeringTorque"),
      });
      if (sink.current) setLog(sink.current.diagnostics.slice(-12));
    }, 100);
    return () => clearInterval(id);
  }, [sim]);

  // Assigning a control: watch every axis of both devices for about three
  // seconds, take the one that moved most, and record its end stops.
  useEffect(() => {
    if (!assigning) return;
    const finder = new AxisFinder();
    const cal = new AxisCalibrator(assigning === "steer");
    let rested = false;
    const start = performance.now();
    const id = setInterval(() => {
      const w = sim.wheel.status;
      const devices: Array<[DeviceRole, typeof w.wheel]> = [
        ["wheel", w.wheel],
        ["pedals", w.pedals],
      ];
      for (const [role, pad] of devices) if (pad) finder.sample(role, pad);
      const found = finder.result(0.6);
      if (found) {
        const pad = found.device === "pedals" ? (w.pedals ?? w.wheel) : w.wheel;
        const raw = pad?.axes[found.axis];
        if (raw !== undefined) {
          if (!rested) {
            // The first reading after the control was found is treated as
            // its rest for a pedal; the wheel's rest is sampled at the end.
            rested = true;
            if (assigning !== "steer") cal.rest(raw);
          }
          cal.sample(raw);
        }
      }
      if (performance.now() - start > 3500) {
        clearInterval(id);
        const result = cal.result();
        if (!found || !result || !w.profile) {
          setMessage(`No clear movement seen for ${assigning}; try again and move it fully.`);
        } else {
          if (assigning === "steer") {
            const pad = w.wheel;
            result.center = pad?.axes[found.axis] ?? 0.5 * (result.min + result.max);
          }
          const binding: AxisBinding = {
            device: found.device,
            axis: found.axis,
            calibration: result,
          };
          const profile: WheelProfile = { ...w.profile, [assigning]: binding };
          const all = [profile, ...builtinProfiles().filter((p) => p.id !== profile.id)];
          sim.wheel.setProfiles(all);
          saveProfiles(globalThis.localStorage, [profile]);
          setMessage(
            `${assigning}: ${found.device} axis ${found.axis}, ${result.min.toFixed(2)} … ${result.max.toFixed(2)}${result.invert ? ", inverted" : ""}. Saved.`,
          );
        }
        setAssigning(null);
      }
    }, 30);
    return () => clearInterval(id);
  }, [assigning, sim]);

  const connect = async () => {
    try {
      const rotation = sim.wheel.status.profile?.rotationDeg ?? 900;
      const s = new LogitechWebHidSink({
        protocol,
        updateMode,
        rotationDeg: rotation,
        gain,
        invert,
        maxOutput,
      });
      // Keep the sink even when the force path fails, so its diagnostics
      // log stays on screen.
      sink.current = s;
      await s.connect(webHid());
      sim.ffbSink = s;
      setMessage(`Connected: ${s.name}. Drive, or press Test pulse.`);
    } catch (e) {
      setMessage(`Force feedback: ${String(e)}`);
    }
  };

  useEffect(() => {
    if (sink.current) {
      sink.current.scaler.gain = gain;
      sink.current.scaler.invert = invert;
      sink.current.maxOutput = maxOutput;
    }
  }, [gain, invert, maxOutput]);

  const rumble = () => {
    const s = new GamepadRumbleSink(() => {
      const pads = navigator.getGamepads?.() ?? [];
      for (const p of pads) {
        const act = (p as { vibrationActuator?: unknown } | null)?.vibrationActuator;
        if (act) return act as never;
      }
      return undefined;
    });
    sim.ffbSink = s;
    setMessage("Rumble fallback: torque magnitude on the strong motor.");
  };

  const disconnect = async () => {
    await sink.current?.disconnect();
    await sim.ffbSink?.stop();
    sink.current = null;
    sim.ffbSink = undefined;
    setMessage("Force feedback off.");
  };

  return (
    <div className={`panel${open ? " open" : ""}`}>
      <button className="panel-toggle" onClick={() => setOpen(!open)}>
        {open ? "Close wheel setup" : "Wheel setup & assists"}
      </button>
      {open && status && (
        <div className="panel-body">
          <h2>Devices</h2>
          <div className="row">
            Input: <b>{status.source}</b> · profile: {status.profile}
          </div>
          <div className="row small">
            wheel: {status.wheel}
            <br />
            pedals: {status.pedals}
          </div>
          <div className="row">
            Hand wheel {status.angle.toFixed(0)}° · torque {status.torque.toFixed(2)} N·m
          </div>
          <div className="row">
            {CONTROLS.map((c) => (
              <button
                key={c}
                disabled={assigning !== null || !sim.wheel.status.wheel}
                onClick={() => {
                  setMessage(`Move the ${c} fully, end to end, within three seconds…`);
                  setAssigning(c);
                }}
              >
                {assigning === c ? "listening…" : `Assign ${c}`}
              </button>
            ))}
          </div>
          <h2>Force feedback (WebHID, Chromium)</h2>
          <div className="row">
            <select
              value={protocol}
              onChange={(e) => setProtocol(e.target.value as LogitechProtocol | "auto")}
            >
              <option value="auto">Logitech, protocol from the model</option>
              <option value="hidpp">Logitech HID++ (G PRO, G923, G920)</option>
              <option value="classic">Logitech classic (G29, G27, G25)</option>
            </select>
            <select
              value={updateMode}
              onChange={(e) => setUpdateMode(e.target.value as "modify" | "recreate")}
            >
              <option value="modify">update: modify effect</option>
              <option value="recreate">update: recreate effect</option>
            </select>
            <button onClick={connect}>Connect wheel</button>
            <button onClick={rumble}>Use gamepad rumble</button>
            <button onClick={() => void sink.current?.pulse()} disabled={!sink.current}>
              Test pulse
            </button>
            <button onClick={disconnect}>Off</button>
          </div>
          <div className="row">
            <label>
              Gain
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={gain}
                onChange={(e) => setGain(Number(e.target.value))}
              />
              {gain.toFixed(2)}
            </label>
            <label>
              Max output
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={maxOutput}
                onChange={(e) => setMaxOutput(Number(e.target.value))}
              />
              {(100 * maxOutput).toFixed(0)}%
              {sink.current ? ` (${(sink.current.peakTorque * maxOutput).toFixed(1)} N·m)` : ""}
            </label>
            <label>
              <input
                type="checkbox"
                checked={invert}
                onChange={(e) => setInvert(e.target.checked)}
              />
              invert
            </label>
            <span>
              {status.ffb} · clipping {(100 * status.clip).toFixed(0)}%
            </span>
          </div>
          {status.tripped && (
            <div className="row message">
              Force feedback stopped: {status.tripped}. Check the sign with Test pulse (it should
              turn the wheel right) before re-enabling.{" "}
              <button
                onClick={() => {
                  sink.current?.scaler.rearm();
                  setMessage("Force feedback re-enabled.");
                }}
              >
                Re-enable
              </button>
            </div>
          )}
          <div className="row small">
            Safety: a force-feedback wheel is a motor and can spin hard on its own, for example if
            the sign is wrong or the car spins. Keep your hands clear for the first test, start with
            low gain and max output, and press Test pulse first: it should turn the wheel gently to
            the right; if it turns left, tick invert. The force stops if the wheel runs away under
            force, if the tab is hidden and if the simulation stops.
          </div>
          {log.length > 0 && (
            <div className="row">
              <textarea readOnly value={log.join("\n")} rows={6} />
              <button
                onClick={() =>
                  void navigator.clipboard?.writeText(sink.current?.diagnostics.join("\n") ?? "")
                }
              >
                Copy log
              </button>
            </div>
          )}
          <h2>Assists</h2>
          <div className="row">
            {ASSISTS.map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={assists[key]}
                  onChange={(e) => {
                    sim.setAssist(key, e.target.checked);
                    setAssists(currentAssists(sim));
                  }}
                />
                {label}
              </label>
            ))}
          </div>
          {message && <div className="row message">{message}</div>}
          <div className="row small">
            Protocol constants are reconstructed from open-source drivers and marked [VERIFY] until
            tried on hardware. If the wheel does nothing, try the other protocol or update mode and
            copy the log into an issue.
          </div>
        </div>
      )}
    </div>
  );
}

function currentAssists(sim: Sim): Record<(typeof ASSISTS)[number][0], boolean> {
  const a = sim.definition.assists;
  return {
    abs: a.abs.enabled,
    tractionControl: a.tractionControl.enabled,
    stabilityControl: a.stabilityControl.enabled,
    steeringAssist: a.steeringAssist.enabled,
  };
}
