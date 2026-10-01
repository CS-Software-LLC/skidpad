// Minimal headless use: drive a preset for ten seconds and print telemetry.
import { init } from "@contactpatch/core";
import { preset } from "@contactpatch/presets";

const cp = await init();
const world = cp.createWorld(1);
const car = world.addVehicle(preset("sportsRwd"));

for (let step = 0; step < 600; step++) {
  const t = step / 60;
  // Full throttle for four seconds, then ease off and turn in gently. Full
  // throttle with real steering lock would spin this car: no traction control
  // until milestone 5.
  world.setInput(car, t < 4 ? { throttle: 1, steer: 0 } : { throttle: 0.35, steer: 0.08 });
  world.step(1 / 60);
  if (step % 60 === 0) {
    const speedKmh = world.read(car, "Speed") * 3.6;
    const latG = world.read(car, "LatAccel") / 9.81;
    console.log(
      `t=${t.toFixed(1)}s  ${speedKmh.toFixed(1)} km/h  lat ${latG.toFixed(2)} g  hash ${world.stateHash(car)}`,
    );
  }
}
world.free();
