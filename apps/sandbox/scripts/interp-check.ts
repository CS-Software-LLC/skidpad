// Drives Sim.frame() with synthetic frame times and checks that the rendered
// (interpolated) pose advances evenly. Run: pnpm --filter @contactpatch/validate exec tsx ../../apps/sandbox/scripts/interp-check.ts
import { Sim } from "../src/sim.js";

const sim = new Sim();
await sim.load();
sim.speedSensitiveSteering = false;
sim.keyboard.keyDown("ArrowUp");

let t = 1000;
function run(label: string, frameMs: () => number): void {
  for (let i = 0; i < 400; i++) {
    t += frameMs();
    sim.frame(t);
  }
  const vel: number[] = [];
  let prev = sim.snapshot({ x: 0, y: 0, yaw: 0, steer: 0, speed: 0, wheelF: 0, wheelR: 0 });
  let prevT = t;
  for (let i = 0; i < 240; i++) {
    const dt = frameMs();
    t += dt;
    sim.frame(t);
    const s = sim.snapshot({ x: 0, y: 0, yaw: 0, steer: 0, speed: 0, wheelF: 0, wheelR: 0 });
    // Ratio of rendered speed to simulated speed: 1.0 every frame is perfect.
    vel.push(
      Math.hypot(s.x - prev.x, s.y - prev.y) / ((t - prevT) / 1000) / Math.max(s.speed, 0.1),
    );
    prev = s;
    prevT = t;
  }
  const mean = vel.reduce((a, b) => a + b, 0) / vel.length;
  const sd = Math.sqrt(vel.reduce((a, b) => a + (b - mean) ** 2, 0) / vel.length);
  const zeros = vel.filter((v) => v < 0.01).length;
  console.log(
    `${label}: sim speed ${sim.snapshot({ x: 0, y: 0, yaw: 0, steer: 0, speed: 0, wheelF: 0, wheelR: 0 }).speed.toFixed(1)} m/s, rendered/sim speed ratio ${mean.toFixed(3)} ± ${sd.toFixed(3)}, frames with no motion ${zeros}/${vel.length}`,
  );
}

run("120 Hz display", () => 1000 / 120);
let k = 0;
run("jittery 60 Hz display", () => (k++ % 3 === 0 ? 22 : 14));
run("90 Hz display", () => 1000 / 90);
