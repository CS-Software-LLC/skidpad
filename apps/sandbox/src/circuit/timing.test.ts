import { describe, expect, it } from "vitest";
import { buildCircuit, Projector, type CircuitGeometry } from "./geometry.js";
import { CIRCUIT } from "./layout.js";
import { crossing, LapTimer, profileTime, PROFILE_SPACING, type StepResult } from "./timing.js";

const DT = 1 / 60;
const g: CircuitGeometry = buildCircuit(CIRCUIT);
const L = g.length;
const S = g.samples;

/** Plan position at distance `s` along the centreline (wrapping), plus a lateral offset. */
function at(s: number, offset = 0): [number, number] {
  const d = ((s % L) + L) % L;
  let i = Math.floor(d / (L / S.length));
  while (i + 1 < S.length && S[i + 1]!.s <= d) i++;
  while (i > 0 && S[i]!.s > d) i--;
  const a = S[i]!;
  const b = S[(i + 1) % S.length]!;
  const span = (i + 1 < S.length ? b.s : L) - a.s;
  const f = (d - a.s) / span;
  return [a.x + (b.x - a.x) * f + a.lx * offset, a.z + (b.z - a.z) * f + a.lz * offset];
}

/** Drives the timer along the centreline from distance `from` at speeds given per step. */
class Driver {
  readonly timer = new LapTimer(g.gates, L, DT);
  readonly proj = new Projector(S, L);
  s: number;
  results: StepResult[] = [];
  offTrack = false;
  offset = 0;
  constructor(from: number) {
    this.s = from;
  }
  /** Drive `seconds` at `speed`. */
  drive(seconds: number, speed: number): void {
    const n = Math.round(seconds / DT);
    for (let k = 0; k < n; k++) this.move(this.s + speed * DT);
  }
  /** Drive until a lap completes (or a step limit). */
  lap(speed: number): StepResult {
    for (let k = 0; k < 60 * 600; k++) {
      const r = this.move(this.s + speed * DT);
      if (r.completed) return r;
    }
    throw new Error("no lap completed");
  }
  move(to: number): StepResult {
    const [px, pz] = at(this.s, this.offset);
    const [cx, cz] = at(to, this.offset);
    this.s = to;
    const r = this.timer.step(px, pz, cx, cz, this.proj.project(cx, cz).s, this.offTrack);
    this.results.push(r);
    return r;
  }
}

const startS = g.gates[0]!.s;

describe("lap timing", () => {
  it("times a clean lap at constant speed to within a step's rounding", () => {
    const d = new Driver(startS - 40);
    d.drive(1, 30); // run-up: crosses the line after about 1.3 s
    const r1 = d.lap(30);
    expect(r1.started).toBe(true);
    // The first crossing only starts the clock: that lap is the second one to start.
    const lap = r1.completed!;
    expect(lap.valid).toBe(true);
    expect(lap.time).toBeCloseTo(L / 30, 2);
    expect(lap.sectors[0] + lap.sectors[1] + lap.sectors[2]).toBeCloseTo(lap.time, 9);
    for (const sec of lap.sectors) expect(sec).toBeGreaterThan(5);
    expect(d.timer.state.best).toBe(lap);
    expect(d.results.filter((r) => r.started)).toHaveLength(2);
  });

  it("keeps the faster valid lap as the best and gives a live delta against it", () => {
    const d = new Driver(startS - 40);
    d.drive(1, 30);
    const slow = d.lap(30).completed!;
    d.drive(20, 35);
    const st = d.timer.state;
    // 20 s at 35 m/s against the 30 m/s lap at the same distance.
    expect(st.delta).not.toBeNull();
    expect(st.delta!).toBeCloseTo(20 - (20 * 35) / 30, 1);
    const fast = d.lap(35).completed!;
    expect(fast.time).toBeLessThan(slow.time);
    expect(d.timer.state.best).toBe(fast);
    expect(d.timer.state.last).toBe(fast);
  });

  it("marks a lap with all four wheels off the track invalid and does not keep it as best", () => {
    const d = new Driver(startS - 40);
    d.drive(1, 30);
    d.drive(10, 30);
    d.offTrack = true;
    d.drive(0.2, 30);
    d.offTrack = false;
    const lap = d.lap(30).completed!;
    expect(lap.valid).toBe(false);
    expect(d.timer.state.best).toBeNull();
    // The next lap starts valid again.
    expect(d.timer.state.valid).toBe(true);
  });

  it("does not count a lap that skips the sector lines", () => {
    const d = new Driver(startS - 40);
    d.drive(2, 30); // past the line: the clock is running
    expect(d.timer.state.running).toBe(true);
    // Jump to just before the line without crossing a sector gate.
    d.s = startS - 20;
    d.proj.reset();
    const r: StepResult[] = [];
    for (let k = 0; k < 60; k++) r.push(d.move(d.s + 30 * DT));
    expect(r.some((x) => x.completed)).toBe(false);
    expect(r.some((x) => x.started)).toBe(true);
    expect(d.timer.state.last).toBeNull();
  });

  it("invalidates a lap crossed backwards", () => {
    const d = new Driver(startS - 40);
    d.drive(2, 30);
    // Reverse back over the line, then drive on.
    for (let k = 0; k < 60; k++) d.move(d.s - 20 * DT);
    expect(d.timer.state.valid).toBe(false);
  });

  it("invalidates the current lap on a reset", () => {
    const d = new Driver(startS - 40);
    d.drive(5, 30);
    d.timer.invalidate();
    const lap = d.lap(30).completed!;
    expect(lap.valid).toBe(false);
  });

  it("counts a crossing exactly on a step boundary once", () => {
    const gate = g.gates[0]!;
    const mid: [number, number] = [(gate.a[0] + gate.b[0]) / 2, (gate.a[1] + gate.b[1]) / 2];
    const back: [number, number] = [mid[0] - gate.forward[0], mid[1] - gate.forward[1]];
    const fwd: [number, number] = [mid[0] + gate.forward[0], mid[1] + gate.forward[1]];
    expect(crossing(back[0], back[1], mid[0], mid[1], gate.a, gate.b)).toBeCloseTo(1, 9);
    expect(crossing(mid[0], mid[1], fwd[0], fwd[1], gate.a, gate.b)).toBeNull();
    const t = new LapTimer(g.gates, L, DT);
    const a = t.step(back[0], back[1], mid[0], mid[1], gate.s, false);
    const b = t.step(mid[0], mid[1], fwd[0], fwd[1], gate.s + 1, false);
    expect(a.started).toBe(true);
    expect(b.started).toBe(false);
    expect(t.state.lap).toBe(1);
  });

  it("stops until the next crossing of the line", () => {
    const d = new Driver(startS - 40);
    d.drive(5, 30);
    d.timer.stop();
    expect(d.timer.state.running).toBe(false);
    expect(d.timer.state.lapTime).toBe(0);
    const lap = d.lap(30);
    // The first crossing after a stop starts the clock; the next completes a lap.
    expect(lap.completed!.valid).toBe(true);
  });
});

describe("lap profiles", () => {
  it("interpolate time against distance", () => {
    const p = new Float32Array([0, 1, 3]);
    expect(profileTime(p, 0)).toBe(0);
    expect(profileTime(p, PROFILE_SPACING / 2)).toBeCloseTo(0.5, 6);
    expect(profileTime(p, PROFILE_SPACING * 1.5)).toBeCloseTo(2, 6);
    expect(profileTime(p, PROFILE_SPACING * 5)).toBeCloseTo(3, 6);
  });

  it("end at the lap time", () => {
    const d = new Driver(startS - 40);
    d.drive(1, 30);
    const lap = d.lap(30).completed!;
    expect(lap.profile[lap.profile.length - 1]!).toBeCloseTo(lap.time, 4);
    expect(lap.profile[0]!).toBeLessThan(DT);
    for (let k = 1; k < lap.profile.length; k++)
      expect(lap.profile[k]!).toBeGreaterThanOrEqual(lap.profile[k - 1]!);
  });
});
