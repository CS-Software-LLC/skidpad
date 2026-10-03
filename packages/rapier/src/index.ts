/**
 * @skidpad/rapier — drives a Rapier 3D rigid body with the Skidpad
 * four-wheel model (ADR-0002, ADR-0009).
 *
 * Each host step:
 *
 * 1. {@link RapierVehicle.beforeStep} copies the body's pose and velocities
 *    into the core and casts one ray per wheel to find the ground.
 * 2. The Skidpad world steps (substepping internally against its chassis
 *    proxy).
 * 3. {@link RapierVehicle.afterStep} hands the accumulated linear and
 *    angular impulse to the body as a force and torque over the coming
 *    Rapier step. A force rather than an instantaneous impulse because
 *    Rapier integrates applied forces and gravity together through its
 *    internal substeps; a kick applied before the step would put the body a
 *    fraction of a step ahead of gravity and settle it a few millimetres
 *    above ride height.
 * 4. Rapier steps and integrates the body with everything else in the scene.
 *
 * The scene's query pipeline is empty until the scene has stepped once, so
 * the very first wheel rays after creating colliders find nothing and the
 * first step runs airborne. Step the scene once after building it to avoid
 * that.
 *
 * Rapier is axis-agnostic; three.js scenes use +y up while the core uses
 * ISO 8855 (+z up, +y left). The adapter converts between the two frames
 * with a fixed rotation, so either `up: "y"` (default) or `up: "z"` works.
 *
 * The adapter types Rapier structurally (the members it uses), so the
 * standard build (`@dimforge/rapier3d-compat`) and the cross-platform
 * deterministic one (`@dimforge/rapier3d-deterministic-compat`) both fit
 * without a cast; install either.
 *
 * ```ts
 * const sp = await init();
 * await RAPIER.init();
 * const scene = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
 * const world = sp.createWorld(1);
 * const def = preset("sportsRwd");
 * const car = world.addVehicle(def);
 * const body = createChassisBody(RAPIER, scene, def);
 * const host = new RapierVehicle(RAPIER, world, car, body, scene);
 * // per frame
 * host.beforeStep();
 * world.step(1 / 60);
 * host.afterStep(1 / 60);
 * scene.step();
 * ```
 */
import type {
  ChassisDefinition,
  HostImpulse,
  PartialVehicleDefinition,
  WheelRay,
  World,
} from "@skidpad/core";

/** A vector as Rapier passes it. */
export interface RapierVector {
  x: number;
  y: number;
  z: number;
}

/** A rotation as Rapier passes it. */
export interface RapierRotation extends RapierVector {
  w: number;
}

/** The members of a Rapier rigid body the adapter uses. */
export interface RapierBodyLike {
  translation(): RapierVector;
  rotation(): RapierRotation;
  linvel(): RapierVector;
  angvel(): RapierVector;
  isFixed(): boolean;
  resetForces(wakeUp: boolean): void;
  resetTorques(wakeUp: boolean): void;
  addForce(force: RapierVector, wakeUp: boolean): void;
  addTorque(torque: RapierVector, wakeUp: boolean): void;
}

/** The members of a Rapier collider the adapter uses. */
export interface RapierColliderLike {
  parent(): RapierBodyLike | null;
}

/** The members of a Rapier ray the adapter uses. */
export interface RapierRayLike {
  origin: RapierVector;
  dir: RapierVector;
}

/** The members of a Rapier ray hit the adapter uses. */
export interface RapierHitLike<C> {
  timeOfImpact: number;
  normal: RapierVector;
  collider: C;
}

/** The members of a Rapier world (scene) the adapter uses. */
export interface RapierSceneLike<B extends RapierBodyLike, C extends RapierColliderLike> {
  createRigidBody(desc: never): B;
  createCollider(desc: never, parent?: B): C;
  castRayAndGetNormal(
    ray: never,
    maxToi: number,
    solid: boolean,
    filterFlags?: never,
    filterGroups?: number,
    filterExcludeCollider?: C,
    filterExcludeRigidBody?: B,
    filterPredicate?: (collider: C) => boolean,
  ): RapierHitLike<C> | null;
}

interface RigidBodyDescLike {
  setTranslation(x: number, y: number, z: number): RigidBodyDescLike;
  setRotation(rotation: RapierRotation): RigidBodyDescLike;
  setCanSleep(canSleep: boolean): RigidBodyDescLike;
  setAdditionalMassProperties(
    mass: number,
    centerOfMass: RapierVector,
    principalAngularInertia: RapierVector,
    angularInertiaLocalFrame: RapierRotation,
  ): RigidBodyDescLike;
}

interface ColliderDescLike {
  setMass(mass: number): ColliderDescLike;
  setCollisionGroups(groups: number): ColliderDescLike;
}

/**
 * The parts of the Rapier module the adapter uses: `@dimforge/rapier3d-compat`
 * or `@dimforge/rapier3d-deterministic-compat`, after `init()`.
 */
export interface RapierModuleLike {
  RigidBodyDesc: { dynamic(): RigidBodyDescLike };
  ColliderDesc: { cuboid(hx: number, hy: number, hz: number): ColliderDescLike };
  Ray: new (origin: RapierVector, dir: RapierVector) => RapierRayLike;
}

/** Which axis points up in the Rapier scene. */
export type UpAxis = "y" | "z";

export interface RapierVehicleOptions<C extends RapierColliderLike = RapierColliderLike> {
  /** Up axis of the Rapier scene. Default `"y"` (three.js convention). */
  up?: UpAxis;
  /** Rapier interaction groups the wheel rays may hit. Default: everything. */
  filterGroups?: number;
  /** Extra predicate on colliders the rays may hit. */
  filterPredicate?: (collider: C) => boolean;
  /**
   * Map a hit collider to a surface id, an index into the world's surface
   * table (`World.setSurfaces()`, ADR-0014). Rapier colliders carry no user
   * data, so keep a `Map` from `collider.handle` to the id when you create
   * the colliders, or pass {@link surfaceIdsByHandle}. Default 0, the
   * reference surface.
   */
  surfaceId?: (collider: C) => number;
  /**
   * Read the velocity of the hit body at the contact so the car rides moving
   * platforms. Default true.
   */
  surfaceVelocity?: boolean;
}

export interface ChassisBodyOptions {
  up?: UpAxis;
  /** Initial centre-of-mass position in the Rapier frame. Default: at rest on the ground plane. */
  position?: [number, number, number];
  /** Initial heading, rad, about the up axis. Default 0. */
  yaw?: number;
  /**
   * Half extents of the massless chassis box collider in the core's body
   * frame `[x, y, z]`, m. Default: derived from wheelbase, track and
   * centre-of-mass height. Pass `null` for no collider.
   */
  colliderHalfExtents?: [number, number, number] | null;
  /** Rapier collision groups for the chassis collider. */
  collisionGroups?: number;
}

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];

// The fixed rotation taking Rapier y-up coordinates to the core's z-up
// frame: +90° about x maps y → z and z → −y. Its conjugate goes back.
const SQRT_HALF = Math.SQRT1_2;
const Y_TO_Z: Quat = [SQRT_HALF, 0, 0, SQRT_HALF];
const Z_TO_Y: Quat = [-SQRT_HALF, 0, 0, SQRT_HALF];
const IDENTITY: Quat = [0, 0, 0, 1];

function rotate(q: Quat, v: Vec3, out: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  // t = 2 q × v
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  out[0] = vx + qw * tx + (qy * tz - qz * ty);
  out[1] = vy + qw * ty + (qz * tx - qx * tz);
  out[2] = vz + qw * tz + (qx * ty - qy * tx);
  return out;
}

function mul(a: Quat, b: Quat, out: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

/** Frame conversion between the Rapier scene and the core. */
class Frame {
  readonly toCore: Quat;
  readonly toScene: Quat;
  private readonly tmp: Quat = [0, 0, 0, 1];

  constructor(up: UpAxis) {
    this.toCore = up === "y" ? Y_TO_Z : IDENTITY;
    this.toScene = up === "y" ? Z_TO_Y : IDENTITY;
  }

  vecToCore(v: Vec3, out: Vec3): Vec3 {
    return rotate(this.toCore, v, out);
  }

  vecToScene(v: Vec3, out: Vec3): Vec3 {
    return rotate(this.toScene, v, out);
  }

  /** Body orientation: `q_core = T · q_scene · T⁻¹`. */
  quatToCore(q: Quat, out: Quat): Quat {
    mul(this.toCore, q, this.tmp);
    return mul(this.tmp, this.toScene, out);
  }

  quatToScene(q: Quat, out: Quat): Quat {
    mul(this.toScene, q, this.tmp);
    return mul(this.tmp, this.toCore, out);
  }
}

/**
 * A `surfaceId` callback reading a `Map` from collider handle to surface id
 * (ids missing from the map read as 0, the reference surface).
 */
export function surfaceIdsByHandle(
  ids: ReadonlyMap<number, number>,
): (collider: { readonly handle: number }) => number {
  return (collider) => ids.get(collider.handle) ?? 0;
}

const CHASSIS_FIELDS = [
  "mass",
  "cgHeight",
  "wheelbase",
  "trackWidth",
  "rollInertia",
  "pitchInertia",
  "yawInertia",
] as const;

type ChassisSizing = Pick<ChassisDefinition, (typeof CHASSIS_FIELDS)[number]>;

/** The chassis fields a body needs, or a clear error naming what is missing. */
export function chassisSizing(def: PartialVehicleDefinition): ChassisSizing {
  const c = def.chassis ?? {};
  const missing = CHASSIS_FIELDS.filter((k) => typeof c[k] !== "number");
  if (missing.length > 0) {
    throw new Error(
      `the definition has no chassis.${missing.join(", chassis.")}; pass sp.completeDefinition(def) to fill in the core's defaults`,
    );
  }
  return c as ChassisSizing;
}

/**
 * Create a dynamic Rapier body with the definition's mass and inertia and,
 * by default, a massless box collider for the chassis. Wheels have no
 * colliders: the rays are the wheels. Takes a partial definition (a preset)
 * as long as its chassis sizes are given; `sp.completeDefinition(def)`
 * fills in the rest.
 */
export function createChassisBody<B extends RapierBodyLike, C extends RapierColliderLike>(
  rapier: RapierModuleLike,
  scene: RapierSceneLike<B, C>,
  def: PartialVehicleDefinition,
  options: ChassisBodyOptions = {},
): B {
  const up = options.up ?? "y";
  const frame = new Frame(up);
  const c = chassisSizing(def);
  const yaw = options.yaw ?? 0;
  const qCore: Quat = [0, 0, Math.sin(yaw / 2), Math.cos(yaw / 2)];
  const qScene = frame.quatToScene(qCore, [0, 0, 0, 1]);
  const p = options.position ?? frame.vecToScene([0, 0, c.cgHeight], [0, 0, 0]);
  // Principal inertia in the body's local frame. With y up the body's local
  // y is the core's z (yaw) and local z is the core's −y (pitch).
  const inertia: Vec3 =
    up === "y"
      ? [c.rollInertia, c.yawInertia, c.pitchInertia]
      : [c.rollInertia, c.pitchInertia, c.yawInertia];
  const desc = rapier.RigidBodyDesc.dynamic()
    .setTranslation(p[0], p[1], p[2])
    .setRotation({ x: qScene[0], y: qScene[1], z: qScene[2], w: qScene[3] })
    .setCanSleep(false)
    .setAdditionalMassProperties(
      c.mass,
      { x: 0, y: 0, z: 0 },
      { x: inertia[0], y: inertia[1], z: inertia[2] },
      { x: 0, y: 0, z: 0, w: 1 },
    );
  const body = scene.createRigidBody(desc as never);
  if (options.colliderHalfExtents !== null) {
    const he = options.colliderHalfExtents ?? [
      0.7 * c.wheelbase,
      0.5 * c.trackWidth,
      Math.max(0.1, Math.min(0.3, c.cgHeight - 0.12)),
    ];
    const heScene = up === "y" ? [he[0], he[2], he[1]] : he;
    const collider = rapier.ColliderDesc.cuboid(heScene[0]!, heScene[1]!, heScene[2]!).setMass(0);
    if (options.collisionGroups !== undefined) collider.setCollisionGroups(options.collisionGroups);
    scene.createCollider(collider as never, body);
  }
  return body;
}

/** Drives one Rapier body with one Skidpad vehicle. */
export class RapierVehicle<
  B extends RapierBodyLike = RapierBodyLike,
  C extends RapierColliderLike = RapierColliderLike,
> {
  readonly frame: Frame;
  private readonly rays: WheelRay[];
  private readonly ray: RapierRayLike;
  private readonly surfaceVelocity: boolean;
  private readonly filterGroups: number | undefined;
  private readonly filterPredicate: ((collider: C) => boolean) | undefined;
  private readonly surfaceId: ((collider: C) => number) | undefined;
  private readonly impulse: HostImpulse = { impulse: [0, 0, 0], angularImpulse: [0, 0, 0] };
  // Scratch space so the per-step path allocates nothing of its own.
  private readonly v0: Vec3 = [0, 0, 0];
  private readonly v1: Vec3 = [0, 0, 0];
  private readonly v2: Vec3 = [0, 0, 0];
  private readonly v3: Vec3 = [0, 0, 0];
  private readonly qScene: Quat = [0, 0, 0, 1];
  private readonly qCore: Quat = [0, 0, 0, 1];
  private readonly contact = {
    point: [0, 0, 0] as Vec3,
    normal: [0, 0, 1] as Vec3,
    surfaceVelocity: [0, 0, 0] as Vec3,
    surfaceId: 0,
  };

  constructor(
    rapier: RapierModuleLike,
    readonly world: World,
    readonly vehicle: number,
    readonly body: B,
    readonly scene: RapierSceneLike<B, C>,
    options: RapierVehicleOptions<C> = {},
  ) {
    this.frame = new Frame(options.up ?? "y");
    this.surfaceVelocity = options.surfaceVelocity ?? true;
    this.filterGroups = options.filterGroups;
    this.filterPredicate = options.filterPredicate;
    this.surfaceId = options.surfaceId;
    this.rays = world.wheelRays(vehicle);
    this.ray = new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    world.setHostMode(vehicle, "external");
  }

  /** Re-read the wheel geometry after a live definition change. */
  refreshGeometry(): void {
    const rays = this.world.wheelRays(this.vehicle);
    rays.forEach((r, i) => {
      this.rays[i] = r;
    });
  }

  /** Copy the body state into the core and cast the wheel rays. Call before `world.step`. */
  beforeStep(): void {
    const b = this.body;
    const t = b.translation();
    const r = b.rotation();
    const lv = b.linvel();
    const av = b.angvel();
    const f = this.frame;
    const pos = f.vecToCore([t.x, t.y, t.z], this.v0);
    this.qScene[0] = r.x;
    this.qScene[1] = r.y;
    this.qScene[2] = r.z;
    this.qScene[3] = r.w;
    const q = f.quatToCore(this.qScene, this.qCore);
    const vel = f.vecToCore([lv.x, lv.y, lv.z], this.v1);
    const ang = f.vecToCore([av.x, av.y, av.z], this.v2);
    this.world.writeHostBody(
      this.vehicle,
      pos[0],
      pos[1],
      pos[2],
      q[0],
      q[1],
      q[2],
      q[3],
      vel[0],
      vel[1],
      vel[2],
      ang[0],
      ang[1],
      ang[2],
    );

    for (let w = 0; w < this.rays.length; w++) {
      const ray = this.rays[w]!;
      // Ray origin and direction in the core's world frame, then the scene's.
      const o = rotate(q, ray.origin, this.v3);
      o[0] += pos[0];
      o[1] += pos[1];
      o[2] += pos[2];
      const d = rotate(q, ray.direction, this.v1);
      const os = f.vecToScene(o, this.v2);
      this.ray.origin.x = os[0];
      this.ray.origin.y = os[1];
      this.ray.origin.z = os[2];
      const ds = f.vecToScene(d, this.v3);
      this.ray.dir.x = ds[0];
      this.ray.dir.y = ds[1];
      this.ray.dir.z = ds[2];
      const hit = this.scene.castRayAndGetNormal(
        this.ray as never,
        ray.length,
        true,
        undefined,
        this.filterGroups,
        undefined,
        this.body,
        this.filterPredicate,
      );
      if (!hit) {
        this.world.clearWheelContact(this.vehicle, w);
        continue;
      }
      const toi = hit.timeOfImpact;
      const c = this.contact;
      // Hit point and normal back in the core frame.
      const ps: Vec3 = [os[0] + ds[0] * toi, os[1] + ds[1] * toi, os[2] + ds[2] * toi];
      f.vecToCore(ps, c.point);
      f.vecToCore([hit.normal.x, hit.normal.y, hit.normal.z], c.normal);
      // Rapier reports the surface normal; make sure it faces the ray.
      if (c.normal[0] * d[0] + c.normal[1] * d[1] + c.normal[2] * d[2] > 0) {
        c.normal[0] = -c.normal[0];
        c.normal[1] = -c.normal[1];
        c.normal[2] = -c.normal[2];
      }
      c.surfaceVelocity[0] = 0;
      c.surfaceVelocity[1] = 0;
      c.surfaceVelocity[2] = 0;
      if (this.surfaceVelocity) {
        const parent = hit.collider.parent();
        if (parent && !parent.isFixed()) {
          const pv = parent.linvel();
          const pw = parent.angvel();
          const pt = parent.translation();
          const rx = ps[0] - pt.x;
          const ry = ps[1] - pt.y;
          const rz = ps[2] - pt.z;
          const sv: Vec3 = [
            pv.x + (pw.y * rz - pw.z * ry),
            pv.y + (pw.z * rx - pw.x * rz),
            pv.z + (pw.x * ry - pw.y * rx),
          ];
          f.vecToCore(sv, c.surfaceVelocity);
        }
      }
      c.surfaceId = this.surfaceId ? this.surfaceId(hit.collider) : 0;
      this.world.writeWheelContact(this.vehicle, w, c);
    }
  }

  /**
   * Hand the step's impulses to the body as a force and torque over the
   * coming scene step of `dt` seconds (the same `dt` the Skidpad world was
   * stepped with and the scene's `timestep`). Call after `world.step`, before
   * the scene steps. Replaces any force the body carried.
   */
  afterStep(dt: number): void {
    const imp = this.world.readHostImpulse(this.vehicle, this.impulse);
    const f = this.frame;
    const inv = dt > 0 ? 1 / dt : 0;
    const li = f.vecToScene(imp.impulse, this.v0);
    const ai = f.vecToScene(imp.angularImpulse, this.v1);
    const b = this.body;
    b.resetForces(true);
    b.resetTorques(true);
    b.addForce({ x: li[0] * inv, y: li[1] * inv, z: li[2] * inv }, true);
    b.addTorque({ x: ai[0] * inv, y: ai[1] * inv, z: ai[2] * inv }, true);
  }

  /** Convenience for a single vehicle per Skidpad world: before, step, after. */
  step(dt: number): void {
    this.beforeStep();
    this.world.step(dt);
    this.afterStep(dt);
  }

  /** Hand the vehicle back to the built-in host and clear the body's force. */
  detach(): void {
    this.body.resetForces(true);
    this.body.resetTorques(true);
    this.world.setHostMode(this.vehicle, "builtin");
  }
}
