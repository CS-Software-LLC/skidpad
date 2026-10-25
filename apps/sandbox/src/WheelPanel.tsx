/**
 * Wheel setup: which devices are seen, assigning and calibrating each
 * control by moving it, force feedback over WebHID with a diagnostics log,
 * and the driving assists.
 */
import { useEffect, useRef, useState } from "react";
import {
  AxisCalibrator,
  AxisFinder,
  DIRECT_DRIVE_SCALER,
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
import { FfbGraph } from "./FfbGraph.js";
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
  peak: number;
  lapPeak: number | undefined;
  tripped: string | undefined;
  torque: number;
}

export function WheelPanel({
  sim,
  revision,
  onAssistChanged,
}: {
  sim: Sim;
  /** Bumped on every definition change (preset switch, tuning edit). */
  revision: number;
  /** Called after an assist toggle, which changes the definition too. */
  onAssistChanged: () => void;
}) {
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
  // Multiplier on the car's column friction and damping, which the wheel's
  // firmware applies; they resist motion, so raising it is safe. 2× is
  // what felt right on a G PRO (2026-10-25).
  const [columnScale, setColumnScale] = useState(2);
  // Road detail (ADR-0036): gain on the torque above 10 Hz, the road
  // texture and kerbs, on top of the gain. 1× is the model as it is.
  const [detail, setDetail] = useState(1);
  // Polish items 1B, 2 and 3, on since a drive on a G PRO (2026-10-25):
  // playing the core's torque slices out between frames, a direct-drive
  // slew and smoothing, and setting the wheel's rotation to the car's lock.
  // A gear or belt wheel can take the "Gear / belt" button.
  const [playout, setPlayout] = useState(true);
  const [playoutRate, setPlayoutRate] = useState(500);
  const [slewRate, setSlewRate] = useState<number>(DIRECT_DRIVE_SCALER.slewRate);
  const [smoothingMs, setSmoothingMs] = useState(DIRECT_DRIVE_SCALER.smoothing * 1000);
  const [matchRotation, setMatchRotation] = useState(true);
  const [rotationNote, setRotationNote] = useState("");
  // Polish item 4: the firmware damper's units, measured on this wheel and
  // remembered per browser; until then the sink uses the model's (the G
  // PRO's is measured).
  const [damperRate, setDamperRate] = useState(loadDamperRate);
  const [measuring, setMeasuring] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [assists, setAssists] = useState(() => currentAssists(sim));
  const sink = useRef<LogitechWebHidSink | null>(null);

  // Each preset ships its own assists, so re-read them whenever the
  // definition changes rather than only on mount.
  useEffect(() => {
    setAssists(currentAssists(sim));
  }, [sim, revision]);

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
        clip: s?.scaler?.clipFraction ?? 0,
        peak: s?.scaler?.peak ?? 0,
        lapPeak: sim.ffbLapPeak,
        tripped: sink.current?.scaler.tripped,
        torque: sim.world.read(sim.vehicle, "SteeringTorque"),
      });
      if (sink.current) setLog(sink.current.diagnostics.slice(-12));
    }, 100);
    return () => clearInterval(id);
  }, [sim]);

  // Keep the wheel's rotation on the car's lock (checked at 2 Hz, so a car
  // change follows), or hand it back to the profile.
  useEffect(() => {
    const id = setInterval(() => {
      const s = sink.current;
      if (!s?.connected) return;
      if (!matchRotation) {
        if (sim.wheel.rotationDeg !== undefined) {
          const profile = sim.wheel.status.profile?.rotationDeg ?? 900;
          sim.wheel.rotationDeg = undefined;
          void s.setRotation(profile);
          setRotationNote("");
        }
        return;
      }
      const st = sim.definition.steering;
      const car = 2 * st.ratio * st.maxWheelAngleDeg;
      const want = Math.round(Math.min(car, s.maxRotationDeg));
      if (sim.wheel.rotationDeg === want) return;
      sim.wheel.rotationDeg = want;
      void s.setRotation(want);
      setRotationNote(
        car > s.maxRotationDeg + 0.5
          ? `car lock ${Math.round(car)}° is wider than the wheel's ${s.maxRotationDeg}°: steering scaled to reach it`
          : `wheel set to the car's ${want}°`,
      );
    }, 500);
    return () => clearInterval(id);
  }, [sim, matchRotation]);

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
        columnScale,
        detail,
        slewRate,
        smoothing: smoothingMs / 1000,
        playoutRate: playout ? playoutRate : 0,
        ...(damperRate !== undefined && { damperRate }),
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
      sink.current.columnScale = columnScale;
      sink.current.scaler.detail = detail;
      sink.current.scaler.slewRate = slewRate;
      sink.current.scaler.smoothing = smoothingMs / 1000;
      sink.current.playoutRate = playout ? playoutRate : 0;
      sink.current.damperRate = damperRate;
    }
  }, [
    gain,
    invert,
    maxOutput,
    columnScale,
    detail,
    slewRate,
    smoothingMs,
    playout,
    playoutRate,
    damperRate,
  ]);

  const measureDamping = async () => {
    const s = sink.current;
    if (!s?.ready) return;
    setMeasuring(true);
    setMessage("Measuring damping: hands off the wheel; it will turn slowly each way three times.");
    try {
      const { fit } = await s.measureDamper(() => sim.wheel.status.wheelAngleDeg);
      if (fit) {
        setDamperRate(fit.damperRate);
        saveDamperRate(fit.damperRate);
        setMessage(
          `Damping measured: damperRate ${fit.damperRate.toFixed(1)} rad/s ` +
            `(firmware friction ${fit.friction.toFixed(2)} N·m, runs within ${(100 * fit.spread).toFixed(0)} %). Saved.`,
        );
      } else {
        setMessage(
          "Damping: no usable runs (see the log). Try the other update mode, or a wider rotation.",
        );
      }
    } finally {
      setMeasuring(false);
    }
  };

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
            <button
              onClick={() => void measureDamping()}
              disabled={!sink.current || measuring}
              title="Hands off: spins the wheel slowly with the damper on to find its units"
            >
              {measuring ? "Measuring…" : "Measure damping"}
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
            <label title="Multiplier on the car's steering column friction and damping">
              Column feel
              <input
                type="range"
                min={0}
                max={4}
                step={0.25}
                value={columnScale}
                onChange={(e) => setColumnScale(Number(e.target.value))}
              />
              {columnScale.toFixed(2)}×
            </label>
            <label title="Gain on the fast part of the torque (above 10 Hz): road texture and kerbs, without making the steering heavier. 1× is the car as modelled">
              Road detail
              <input
                type="range"
                min={0}
                max={4}
                step={0.25}
                value={detail}
                onChange={(e) => setDetail(Number(e.target.value))}
              />
              {detail.toFixed(2)}×
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
              {status.ffb} · clipping {(100 * status.clip).toFixed(0)}% · peak{" "}
              {status.peak.toFixed(1)} N·m
              {status.lapPeak !== undefined && ` (last lap ${status.lapPeak.toFixed(1)})`}
            </span>
          </div>
          {sim.ffbSink?.scaler && (
            <div className="row">
              <FfbGraph trace={sim.ffbTrace} />
            </div>
          )}
          <div className="row">
            <label title="Play the core's 1 kHz torque out between frames, one frame behind, instead of one value per 60 Hz frame">
              <input
                type="checkbox"
                checked={playout}
                onChange={(e) => setPlayout(e.target.checked)}
              />
              Sub-frame playout
              <select
                value={playoutRate}
                onChange={(e) => setPlayoutRate(Number(e.target.value))}
                disabled={!playout}
              >
                {[250, 360, 500].map((hz) => (
                  <option key={hz} value={hz}>
                    {hz} Hz
                  </option>
                ))}
              </select>
            </label>
            <label title="Fastest change of the output, full scale per second">
              Slew
              <input
                type="range"
                min={5}
                max={100}
                step={5}
                value={slewRate}
                onChange={(e) => setSlewRate(Number(e.target.value))}
              />
              {slewRate}/s
            </label>
            <label title="First-order smoothing time constant">
              Smoothing
              <input
                type="range"
                min={0}
                max={20}
                step={1}
                value={smoothingMs}
                onChange={(e) => setSmoothingMs(Number(e.target.value))}
              />
              {smoothingMs} ms
            </label>
            <button
              title="Slew and smoothing for a direct-drive base such as the G PRO"
              onClick={() => {
                setSlewRate(DIRECT_DRIVE_SCALER.slewRate);
                setSmoothingMs(DIRECT_DRIVE_SCALER.smoothing * 1000);
              }}
            >
              Direct drive
            </button>
            <button
              onClick={() => {
                setSlewRate(5);
                setSmoothingMs(10);
              }}
            >
              Gear / belt
            </button>
            <label title="Set the wheel's rotation to the car's lock, so the wheel's end stop is the car's">
              <input
                type="checkbox"
                checked={matchRotation}
                onChange={(e) => setMatchRotation(e.target.checked)}
              />
              Match rotation to car
            </label>
            {rotationNote && <span className="small">{rotationNote}</span>}
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
                    onAssistChanged();
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

const DAMPER_KEY = "skidpad.damperRate";

/** The damperRate measured on this browser's wheel, if any. */
function loadDamperRate(): number | undefined {
  try {
    const v = Number(globalThis.localStorage?.getItem(DAMPER_KEY));
    return v > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

function saveDamperRate(v: number): void {
  try {
    globalThis.localStorage?.setItem(DAMPER_KEY, String(v));
  } catch {
    // Storage blocked: the value lasts for this page only.
  }
}
