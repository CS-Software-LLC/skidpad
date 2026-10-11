/**
 * The sandbox circuit: an original layout of about 2.5 km, run clockwise
 * seen from above. Positions in metres, three.js plan coordinates (x east,
 * z south), elevation y up. Feature ranges are in control-point units (see
 * `Range` in `geometry.ts`).
 *
 *  0–3   start/finish straight, gently downhill
 *  3–6   Turn 1, a heavy-braking hairpin at the bottom of the hill
 *  6–11  uphill esses
 *  11–13 a blind crest on a fast left kink
 *  13–16 a long, fast, banked left-hander
 *  16–20 a downhill compression into a double-apex right
 *  20–24 a slow chicane
 *  24–27 the final corner onto the straight
 */
import type { CircuitDescription } from "./geometry.js";

export const CIRCUIT: CircuitDescription = {
  name: "Skidpad Ring",
  width: 11,
  runoffWidth: 9,
  points: [
    { x: -200, z: 0, y: 22 },
    { x: 20, z: 0, y: 19 },
    { x: 260, z: 0, y: 14.5 },
    { x: 440, z: 0, y: 11, width: 12 },
    { x: 492, z: 10, y: 10, width: 13 },
    { x: 510, z: 40, y: 10, width: 13 },
    { x: 494, z: 70, y: 10, width: 13 },
    { x: 455, z: 80, y: 10.5, width: 12 },
    { x: 395, z: 112, y: 12.5 },
    { x: 340, z: 98, y: 14.5 },
    { x: 280, z: 140, y: 17 },
    { x: 215, z: 140, y: 19.5 },
    { x: 140, z: 170, y: 23 },
    { x: 60, z: 168, y: 25 },
    { x: -20, z: 196, y: 24 },
    { x: -95, z: 232, y: 22, bank: -4 },
    { x: -130, z: 300, y: 18.5, bank: -7 },
    { x: -118, z: 380, y: 14, bank: -3 },
    { x: -112, z: 440, y: 10 },
    { x: -138, z: 492, y: 7.5 },
    { x: -185, z: 505, y: 7 },
    { x: -222, z: 488, y: 7 },
    { x: -244, z: 440, y: 7.5 },
    { x: -250, z: 370, y: 9.5 },
    { x: -242, z: 322, y: 10.5 },
    { x: -262, z: 292, y: 11.5 },
    { x: -255, z: 258, y: 12.5 },
    { x: -262, z: 160, y: 16.5 },
    { x: -256, z: 62, y: 20 },
    { x: -240, z: 16, y: 21.5 },
  ],
  kerbs: [
    // Turn 1: apex and exit.
    { side: "right", from: 4.4, to: 6.4 },
    { side: "left", from: 6.2, to: 7.4 },
    // Esses: both sides through each change of direction.
    { side: "left", from: 7.7, to: 8.4 },
    { side: "right", from: 7.7, to: 8.4 },
    { side: "left", from: 8.7, to: 9.3 },
    { side: "right", from: 8.7, to: 9.3 },
    { side: "left", from: 9.7, to: 10.4 },
    { side: "right", from: 9.7, to: 10.4 },
    { side: "left", from: 10.7, to: 11.3 },
    // The crest kink's inside.
    { side: "left", from: 12.7, to: 13.4 },
    // The banked left-hander's inside.
    { side: "left", from: 14.8, to: 16.6 },
    // Double apex: both apexes and the exit.
    { side: "right", from: 18.7, to: 19.6 },
    { side: "right", from: 21.0, to: 22.2 },
    { side: "left", from: 22.1, to: 23.0 },
    // Chicane: tall kerbs on both sides.
    { side: "left", from: 23.6, to: 26.0 },
    { side: "right", from: 23.6, to: 26.0 },
    // Final corner: apex and exit.
    { side: "right", from: 28.4, to: 29.8 },
    { side: "left", from: 29.5, to: 30.4 },
  ],
  gravel: [
    { side: "left", from: 3.5, to: 6.9, width: 22 },
    { side: "left", from: 19.0, to: 22.2, width: 16 },
  ],
  wideRunoff: [
    { side: "right", from: 14.2, to: 17.2, width: 16 },
    { side: "left", from: 2.4, to: 3.5, width: 16 },
  ],
  barriers: [
    // Pit wall on the infield along the straight.
    { side: "right", from: 0.5, to: 2.6, kind: "wall" },
    // Wall outside the final corner and the length of the straight.
    { side: "left", from: 27.4, to: 3.2, kind: "wall" },
    // Tyre walls behind the Turn 1 and double-apex gravel and outside the sweeper.
    { side: "left", from: 3.2, to: 7.2, kind: "tyres" },
    { side: "right", from: 14.2, to: 17.4, kind: "tyres" },
    { side: "left", from: 18.8, to: 22.6, kind: "tyres" },
  ],
  gates: [0.3, 9, 18.5],
  gridBehind: 40,
};
