// Drives every preset round the circuit with the core's path-following
// driver (ADR-0020), through the sandbox's own Sim and Rapier scene, and
// reports lap times, track limits and anything that went wrong (a fall
// through the ground, a wheel never landing, a spin).
// Run: pnpm --filter @skidpad/sandbox exec tsx scripts/circuit-drive.ts [preset…] [--laps N]
import { Sim, presetIds, type PresetId } from "../src/sim.js";
import { circuitGeometryOnce } from "../src/sim.js";
import { Projector } from "../src/circuit/geometry.js";
import { surfaces } from "@skidpad/presets";

const args = process.argv.slice(2);
const lapsAt = args.indexOf("--laps");
const laps = lapsAt >= 0 ? Number(args[lapsAt + 1]) : 2;
const chosen = args.filter(
  (a, i) => !a.startsWith("--") && (lapsAt < 0 || i !== lapsAt + 1),
) as PresetId[];
const presets = chosen.length ? chosen : presetIds;
const verbose = args.includes("--verbose");

/**
 * Driver settings per preset: what each can sensibly be asked for. The
 * driver plans its corner speeds from `lateralAccel`, without knowing about
 * load transfer or grade, so it is set below each car's grip.
 */
const AI: Record<PresetId, { maxSpeed: number; lateralAccel: number; brakeDecel: number }> = {
  hatchbackFwd: { maxSpeed: 60, lateralAccel: 6, brakeDecel: 5 },
  sportsRwd: { maxSpeed: 65, lateralAccel: 7.5, brakeDecel: 7 },
  kart: { maxSpeed: 28, lateralAccel: 6, brakeDecel: 5 },
  pickup4x4: { maxSpeed: 50, lateralAccel: 5, brakeDecel: 5 },
  crossoverEv: { maxSpeed: 60, lateralAccel: 6, brakeDecel: 5 },
  openWheeler: { maxSpeed: 75, lateralAccel: 11, brakeDecel: 10 },
};

const g = circuitGeometryOnce();
// The centreline in the core's frame: three (x, z) → core (x, −z).
const path = g.samples.map((s) => [s.x, -s.z] as const);
const minGround = Math.min(...g.samples.map((s) => s.y)) - 3;

const sim = new Sim();
await sim.load();
sim.speedSensitiveSteering = process.env.ASSIST === "1";
await sim.setMap("circuit");

let ok = true;
for (const id of presets) {
  sim.setPreset(id);
  const cfg = AI[id];
  sim.world.setAi(sim.vehicle, path, { ...cfg, closed: true });
  // Select drive on the automatics.
  sim.keyboard.keyDown("KeyE");
  let t = 1000;
  sim.frame(t);
  sim.keyboard.keyUp("KeyE");
  const times: string[] = [];
  let lowest = Infinity;
  let airborneSteps = 0;
  let maxRoll = 0;
  let steps = 0;
  const limit = 60 * 60 * 6; // six minutes of sim time
  let completed = 0;
  let last = sim.timing?.last ?? null;
  const proj = new Projector(g.samples, g.length);
  let reported = false;
  const where = () => {
    const w = sim.world;
    const v = sim.vehicle;
    const p = proj.project(w.read(v, "PosX"), -w.read(v, "PosY"));
    const surf = ["FL", "FR", "RL", "RR"]
      .map((n) => surfaces[w.read(v, `SurfaceId_${n}`)]?.id ?? "?")
      .join("/");
    return `s=${p.s.toFixed(0)} m (u≈${g.samples[p.index]!.u.toFixed(1)}) lateral ${p.lateral.toFixed(1)} m · ${(w.read(v, "Speed") * 3.6).toFixed(0)} km/h · gear ${w.read(v, "Gear")} · ${surf}`;
  };
  while (completed < laps && steps < limit) {
    t += 1000 / 60;
    sim.frame(t);
    steps++;
    const w = sim.world;
    const v = sim.vehicle;
    // The core reads the Rapier body's pose from the step after a placement on.
    if (steps > 10) lowest = Math.min(lowest, w.read(v, "PosZ"));
    maxRoll = Math.max(maxRoll, Math.abs(w.read(v, "Roll")));
    if (verbose && !reported && Math.abs(w.read(v, "Roll")) > 0.3) {
      reported = true;
      console.log(`  ${id}: roll past 17° at t=${(steps / 60).toFixed(1)} s, ${where()}`);
    }
    if (verbose && steps % (60 * 20) === 0) console.log(`  ${id} t=${steps / 60} s ${where()}`);
    let contacts = 0;
    for (const n of ["FL", "FR", "RL", "RR"]) contacts += w.read(v, `WheelContact_${n}`);
    if (contacts === 0) airborneSteps++;
    const st = sim.timing!;
    if (st.last && st.last !== last) {
      last = st.last;
      times.push(`${last.time.toFixed(2)} s${last.valid ? "" : " (invalid)"}`);
      completed++;
    }
    if (lowest < minGround) break;
  }
  if (verbose) console.log(`  ${id}: end ${where()}`);
  const fell = lowest < minGround;
  const best = sim.timing?.best;
  const problems = [
    fell ? `fell to z=${lowest.toFixed(1)}` : "",
    completed < laps ? `only ${completed} of ${laps} laps` : "",
    maxRoll > 0.5 ? `rolled to ${((maxRoll * 180) / Math.PI).toFixed(0)}°` : "",
  ].filter(Boolean);
  if (problems.length) ok = false;
  console.log(
    `${id.padEnd(12)} laps: ${times.join(", ") || "none"} · best ${best ? best.time.toFixed(2) + " s" : "—"} · ` +
      `all wheels airborne ${airborneSteps} steps · max roll ${((maxRoll * 180) / Math.PI).toFixed(1)}°` +
      (problems.length ? ` · PROBLEM: ${problems.join("; ")}` : ""),
  );
  sim.world.clearAi(sim.vehicle);
}
sim.dispose();
process.exit(ok ? 0 : 1);
