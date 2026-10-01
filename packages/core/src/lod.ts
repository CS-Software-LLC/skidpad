import type { Lod, World } from "./core.js";

/** Distances at which {@link LodController} changes a vehicle's level. */
export interface LodThresholds {
  /** Beyond this distance a car drops to the single-track model, m. Default 80. */
  singleTrackBeyond?: number;
  /** Beyond this distance a car freezes, m. Default Infinity (never). */
  frozenBeyond?: number;
  /**
   * A car moves back up only once it is this much closer than the
   * threshold it crossed, m, so a car at the boundary does not flicker
   * between models. Default 10.
   */
  hysteresis?: number;
  /** Substep rate at the single-track level, Hz; 0 keeps the definition's. Default 0. */
  singleTrackRateHz?: number;
}

/**
 * Pick a level of detail for a car `distance` metres from the camera,
 * given its current level. Pure; {@link LodController} applies it.
 */
export function chooseLod(distance: number, current: Lod, thresholds: LodThresholds = {}): Lod {
  const st = thresholds.singleTrackBeyond ?? 80;
  const fr = thresholds.frozenBeyond ?? Number.POSITIVE_INFINITY;
  const h = thresholds.hysteresis ?? 10;
  const rank = (l: Lod) => (l === "full" ? 0 : l === "singleTrack" ? 1 : 2);
  // The level the distance asks for, moving down at the threshold and up
  // only past it by the hysteresis.
  const down: Lod = distance > fr ? "frozen" : distance > st ? "singleTrack" : "full";
  const up: Lod = distance > fr - h ? "frozen" : distance > st - h ? "singleTrack" : "full";
  if (rank(down) > rank(current)) return down;
  if (rank(up) < rank(current)) return up;
  return current;
}

/**
 * Applies distance-based levels of detail to a world's vehicles each frame
 * (ADR-0019). Cars on an external host are never reduced to the
 * single-track model, only frozen if `frozenBeyond` is set.
 *
 * ```ts
 * const lod = new LodController(world, { singleTrackBeyond: 60, frozenBeyond: 400 });
 * // each frame, before world.step
 * lod.update((car) => distanceToCamera(car), playerCar);
 * ```
 */
export class LodController {
  private readonly external = new Set<number>();
  private readonly pinned = new Set<number>();

  constructor(
    private readonly world: World,
    public thresholds: LodThresholds = {},
  ) {}

  /** Keep a vehicle at full detail whatever its distance (the player's car). */
  pin(vehicle: number, pinned = true): void {
    if (pinned) this.pinned.add(vehicle);
    else this.pinned.delete(vehicle);
  }

  /** Tell the controller a vehicle is on an external host. */
  markExternal(vehicle: number, external = true): void {
    if (external) this.external.add(vehicle);
    else this.external.delete(vehicle);
  }

  /**
   * Choose and apply each vehicle's level. `distance(i)` returns vehicle
   * `i`'s distance from the camera in metres. Returns the number of
   * vehicles whose level changed.
   */
  update(distance: (vehicle: number) => number): number {
    let changed = 0;
    const n = this.world.vehicleCount;
    for (let i = 0; i < n; i++) {
      const current = this.world.lod(i);
      let next: Lod = this.pinned.has(i)
        ? "full"
        : chooseLod(distance(i), current, this.thresholds);
      if (next === "singleTrack" && this.external.has(i)) next = "full";
      if (next !== current) {
        this.world.setLod(
          i,
          next,
          next === "singleTrack" ? (this.thresholds.singleTrackRateHz ?? 0) : 0,
        );
        changed++;
      }
    }
    return changed;
  }
}
