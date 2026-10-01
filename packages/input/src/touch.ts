/**
 * Touch controls: a pure state machine for on-screen driving. The left part
 * of the screen is a steering strip (drag sideways, returns to centre), the
 * right part a pedal column (upper half throttle, lower half brake, pressure
 * by how far from the middle). Pointer positions arrive normalised to the
 * viewport (0 … 1); `update(dt)` returns a frame. No DOM here, so it is
 * testable and works with mouse and pen too.
 */
import { clamp, Ramp } from "./filters.js";
import { emptyFrame, type InputFrame } from "./index.js";

export interface TouchLayout {
  /** Fraction of the width used by the steering strip, from the left. */
  steerWidth: number;
  /** Half-width of the steering travel as a fraction of the strip width. */
  steerTravel: number;
  /** Fraction of the pedal column's height around the middle that is dead. */
  pedalDeadband: number;
}

export const defaultTouchLayout: TouchLayout = {
  steerWidth: 0.5,
  steerTravel: 0.4,
  pedalDeadband: 0.08,
};

interface Pointer {
  x: number;
  y: number;
  startX: number;
  role: "steer" | "pedal";
}

export class TouchInput {
  private readonly pointers = new Map<number, Pointer>();
  private readonly steerReturn: Ramp;
  private steerTarget = 0;
  private throttle = 0;
  private brake = 0;
  gear = 0;

  constructor(
    readonly layout: TouchLayout = defaultTouchLayout,
    returnRate = 4,
  ) {
    this.steerReturn = new Ramp({ riseRate: 8, fallRate: returnRate });
  }

  pointerDown(id: number, x: number, y: number): void {
    const role = x < this.layout.steerWidth ? "steer" : "pedal";
    this.pointers.set(id, { x, y, startX: x, role });
    this.pointerMove(id, x, y);
  }

  pointerMove(id: number, x: number, y: number): void {
    const p = this.pointers.get(id);
    if (!p) return;
    p.x = x;
    p.y = y;
    if (p.role === "steer") {
      const travel = this.layout.steerTravel * this.layout.steerWidth;
      this.steerTarget = clamp((x - p.startX) / travel, -1, 1);
    } else {
      // y grows downward: above the middle is throttle, below is brake.
      const d = 0.5 - y;
      const dead = this.layout.pedalDeadband;
      const span = 0.5 - dead;
      this.throttle = d > dead ? clamp((d - dead) / span, 0, 1) : 0;
      this.brake = d < -dead ? clamp((-d - dead) / span, 0, 1) : 0;
    }
  }

  pointerUp(id: number): void {
    const p = this.pointers.get(id);
    if (!p) return;
    this.pointers.delete(id);
    if (p.role === "steer" && ![...this.pointers.values()].some((q) => q.role === "steer")) {
      this.steerTarget = 0;
    }
    if (p.role === "pedal" && ![...this.pointers.values()].some((q) => q.role === "pedal")) {
      this.throttle = 0;
      this.brake = 0;
    }
  }

  /** True while any pointer is down: the frame should take precedence. */
  get active(): boolean {
    return this.pointers.size > 0;
  }

  update(dt: number): InputFrame {
    const f = emptyFrame();
    // Steering follows the finger directly and returns to centre at the
    // return rate when released.
    f.steer = this.active ? this.steerTarget : this.steerReturn.update(0, dt);
    if (this.active) this.steerReturn.value = this.steerTarget;
    f.throttle = this.throttle;
    f.brake = this.brake;
    f.gear = this.gear;
    return f;
  }
}
