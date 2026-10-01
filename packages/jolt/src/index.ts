/**
 * @skidpad/jolt — drives a Jolt Physics rigid body with the Skidpad
 * four-wheel model (ADR-0002, ADR-0009, ADR-0023), the counterpart of
 * `@skidpad/rapier` for `jolt-physics`.
 *
 * Each host step:
 *
 * 1. {@link JoltVehicle.beforeStep} copies the body's centre-of-mass pose
 *    and velocities into the core and casts one ray per wheel through the
 *    narrow-phase query to find the ground.
 * 2. The Skidpad world steps (substepping internally against its chassis
 *    proxy).
 * 3. {@link JoltVehicle.afterStep} adds the step's linear and angular
 *    impulse to the body as a force and torque over the coming Jolt step.
 *    Jolt clears accumulated forces after every update, so nothing carries
 *    over.
 * 4. Jolt steps and integrates the body with the rest of the scene.
 *
 * Jolt is y-up by convention; the core uses ISO 8855 (+z up, +y left). The
 * adapter converts between the two with a fixed rotation, so `up: "y"`
 * (default) and `up: "z"` both work.
 *
 * ```ts
 * import initJolt from "jolt-physics";
 * const Jolt = await initJolt();
 * const jolt = new Jolt.JoltInterface(settings); // your layers
 * const def = preset("sportsRwd");
 * const car = world.addVehicle(def);
 * const body = createChassisBody(Jolt, jolt, def, { objectLayer: MOVING });
 * const host = new JoltVehicle(Jolt, jolt, world, car, body);
 * // per frame
 * host.step(1 / 60);   // beforeStep, world.step, afterStep
 * jolt.Step(1 / 60, 1);
 * ```
 *
 * Jolt objects created with `new` live on Jolt's heap. The adapter
 * allocates its scratch objects once and frees them in {@link JoltVehicle.dispose}.
 */
import type JoltNs from "jolt-physics";
import type { HostImpulse, VehicleDefinition, WheelRay, World } from "@skidpad/core";

/** The loaded `jolt-physics` module (what `await initJolt()` returns). */
export type JoltModule = typeof JoltNs;

/** Which axis points up in the Jolt scene. */
export type UpAxis = "y" | "z";

export interface JoltVehicleOptions {
  /** Up axis of the Jolt scene. Default `"y"`. */
  up?: UpAxis;
  /**
   * Object layer the wheel rays query as: they hit what a body on this
   * layer would collide with. Default: the chassis body's own layer.
   */
  objectLayer?: number;
  /**
   * Map a hit body to a surface id, an index into the world's surface table
   * (`World.setSurfaces()`, ADR-0014); for example from the body's user
   * data. Default 0.
   */
  surfaceId?: (bodyId: JoltNs.BodyID, bodyInterface: JoltNs.BodyInterface) => number;
  /** Read the velocity of the hit body so the car rides moving platforms. Default true. */
  surfaceVelocity?: boolean;
}

export interface ChassisBodyOptions {
  up?: UpAxis;
  /** Object layer of the chassis body. Default 1 (the "moving" layer of Jolt's examples). */
  objectLayer?: number;
  /** Initial centre-of-mass position in the Jolt frame. Default: at rest on the plane through the origin. */
  position?: [number, number, number];
  /** Initial heading, rad, about the up axis. Default 0. */
  yaw?: number;
  /**
   * Half extents of the chassis box in the core's body frame `[x, y, z]`,
   * m. Default: from the wheelbase, track and centre-of-mass height. The
   * box only collides; mass and inertia come from the definition.
   */
  halfExtents?: [number, number, number];
}

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];

const SQRT_HALF = Math.SQRT1_2;
// +90° about x maps y-up to z-up; its conjugate goes back.
const Y_TO_Z: Quat = [SQRT_HALF, 0, 0, SQRT_HALF];
const Z_TO_Y: Quat = [-SQRT_HALF, 0, 0, SQRT_HALF];
const IDENTITY: Quat = [0, 0, 0, 1];

function rotate(q: Quat, v: Vec3, out: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
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

/** Frame conversion between the Jolt scene and the core. */
export class Frame {
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
 * Create and add a dynamic Jolt body with the definition's mass and
 * principal inertia and a box shape for the chassis. Wheels have no shapes:
 * the rays are the wheels. Sleeping and Jolt's default damping are off, so
 * the core's forces are the only ones besides gravity and contacts.
 */
export function createChassisBody(
  Jolt: JoltModule,
  jolt: JoltNs.JoltInterface,
  def: VehicleDefinition,
  options: ChassisBodyOptions = {},
): JoltNs.Body {
  const up = options.up ?? "y";
  const frame = new Frame(up);
  const c = def.chassis;
  const yaw = options.yaw ?? 0;
  const qCore: Quat = [0, 0, Math.sin(yaw / 2), Math.cos(yaw / 2)];
  const qs = frame.quatToScene(qCore, [0, 0, 0, 1]);
  const p = options.position ?? frame.vecToScene([0, 0, c.cgHeight], [0, 0, 0]);
  const he = options.halfExtents ?? [
    0.7 * c.wheelbase,
    0.5 * c.trackWidth,
    Math.max(0.1, Math.min(0.3, c.cgHeight - 0.12)),
  ];
  const heScene = up === "y" ? [he[0], he[2], he[1]] : he;
  // Principal inertia in the body's local frame: with y up, local y is the
  // core's z (yaw) and local z the core's −y (pitch).
  const inertia: Vec3 =
    up === "y"
      ? [c.rollInertia, c.yawInertia, c.pitchInertia]
      : [c.rollInertia, c.pitchInertia, c.yawInertia];

  const half = new Jolt.Vec3(heScene[0]!, heScene[1]!, heScene[2]!);
  const shape = new Jolt.BoxShape(half, 0.02, undefined as unknown as JoltNs.PhysicsMaterial);
  const pos = new Jolt.RVec3(p[0], p[1], p[2]);
  const rot = new Jolt.Quat(qs[0], qs[1], qs[2], qs[3]);
  const settings = new Jolt.BodyCreationSettings(
    shape,
    pos,
    rot,
    Jolt.EMotionType_Dynamic,
    options.objectLayer ?? 1,
  );
  settings.mOverrideMassProperties = Jolt.EOverrideMassProperties_MassAndInertiaProvided;
  settings.mMassPropertiesOverride.mMass = c.mass;
  const diag = new Jolt.Vec3(inertia[0], inertia[1], inertia[2]);
  settings.mMassPropertiesOverride.mInertia = Jolt.Mat44.prototype.sScaleVec3(diag);
  settings.mAllowSleeping = false;
  settings.mLinearDamping = 0;
  settings.mAngularDamping = 0;
  const bodies = jolt.GetPhysicsSystem().GetBodyInterface();
  const body = bodies.CreateBody(settings);
  bodies.AddBody(body.GetID(), Jolt.EActivation_Activate);
  Jolt.destroy(settings);
  Jolt.destroy(half);
  Jolt.destroy(pos);
  Jolt.destroy(rot);
  Jolt.destroy(diag);
  return body;
}

/** Drives one Jolt body with one Skidpad vehicle. */
export class JoltVehicle {
  readonly frame: Frame;
  private readonly rays: WheelRay[];
  private readonly surfaceVelocity: boolean;
  private readonly surfaceId: JoltVehicleOptions["surfaceId"];
  private readonly impulse: HostImpulse = { impulse: [0, 0, 0], angularImpulse: [0, 0, 0] };
  private readonly bodies: JoltNs.BodyInterface;
  private readonly query: JoltNs.NarrowPhaseQuery;
  private readonly locks: JoltNs.BodyLockInterface;
  // Jolt-heap scratch, allocated once.
  private readonly jRay: JoltNs.RRayCast;
  private readonly jOrigin: JoltNs.RVec3;
  private readonly jDir: JoltNs.Vec3;
  private readonly jPoint: JoltNs.RVec3;
  private readonly jForce: JoltNs.Vec3;
  private readonly jTorque: JoltNs.Vec3;
  private readonly settings: JoltNs.RayCastSettings;
  private readonly collector: JoltNs.CastRayClosestHitCollisionCollector;
  private readonly bpFilter: JoltNs.DefaultBroadPhaseLayerFilter;
  private readonly objFilter: JoltNs.DefaultObjectLayerFilter;
  private readonly bodyFilter: JoltNs.IgnoreSingleBodyFilter;
  private readonly shapeFilter: JoltNs.ShapeFilter;
  // JS scratch so the per-step path allocates nothing of its own.
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
  private disposed = false;

  constructor(
    private readonly Jolt: JoltModule,
    readonly jolt: JoltNs.JoltInterface,
    readonly world: World,
    readonly vehicle: number,
    readonly body: JoltNs.Body,
    options: JoltVehicleOptions = {},
  ) {
    this.frame = new Frame(options.up ?? "y");
    this.surfaceVelocity = options.surfaceVelocity ?? true;
    this.surfaceId = options.surfaceId;
    this.rays = world.wheelRays(vehicle);
    const system = jolt.GetPhysicsSystem();
    this.bodies = system.GetBodyInterface();
    this.query = system.GetNarrowPhaseQuery();
    this.locks = system.GetBodyLockInterfaceNoLock();
    this.jOrigin = new Jolt.RVec3(0, 0, 0);
    this.jDir = new Jolt.Vec3(0, -1, 0);
    this.jRay = new Jolt.RRayCast(this.jOrigin, this.jDir);
    this.jPoint = new Jolt.RVec3(0, 0, 0);
    this.jForce = new Jolt.Vec3(0, 0, 0);
    this.jTorque = new Jolt.Vec3(0, 0, 0);
    this.settings = new Jolt.RayCastSettings();
    this.collector = new Jolt.CastRayClosestHitCollisionCollector();
    const layer = options.objectLayer ?? body.GetObjectLayer();
    this.bpFilter = new Jolt.DefaultBroadPhaseLayerFilter(
      jolt.GetObjectVsBroadPhaseLayerFilter(),
      layer,
    );
    this.objFilter = new Jolt.DefaultObjectLayerFilter(jolt.GetObjectLayerPairFilter(), layer);
    this.bodyFilter = new Jolt.IgnoreSingleBodyFilter(body.GetID());
    this.shapeFilter = new Jolt.ShapeFilter();
    world.setHostMode(vehicle, "external");
  }

  /** Re-read the wheel geometry after a live definition change. */
  refreshGeometry(): void {
    this.world.wheelRays(this.vehicle).forEach((r, i) => {
      this.rays[i] = r;
    });
  }

  /** Copy the body state into the core and cast the wheel rays. Call before `world.step`. */
  beforeStep(): void {
    const b = this.body;
    const f = this.frame;
    const t = b.GetCenterOfMassPosition();
    const pos = f.vecToCore([t.GetX(), t.GetY(), t.GetZ()], this.v0);
    const r = b.GetRotation();
    this.qScene[0] = r.GetX();
    this.qScene[1] = r.GetY();
    this.qScene[2] = r.GetZ();
    this.qScene[3] = r.GetW();
    const q = f.quatToCore(this.qScene, this.qCore);
    const lv = b.GetLinearVelocity();
    const vel = f.vecToCore([lv.GetX(), lv.GetY(), lv.GetZ()], this.v1);
    const av = b.GetAngularVelocity();
    const ang = f.vecToCore([av.GetX(), av.GetY(), av.GetZ()], this.v2);
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
    const px = pos[0];
    const py = pos[1];
    const pz = pos[2];

    for (let w = 0; w < this.rays.length; w++) {
      const ray = this.rays[w]!;
      const o = rotate(q, ray.origin, this.v3);
      o[0] += px;
      o[1] += py;
      o[2] += pz;
      const d = rotate(q, ray.direction, this.v1);
      const os = f.vecToScene(o, this.v2);
      const ox = os[0];
      const oy = os[1];
      const oz = os[2];
      const ds = f.vecToScene(d, this.v3);
      // Jolt's ray direction carries the length.
      this.jOrigin.Set(ox, oy, oz);
      this.jDir.Set(ds[0] * ray.length, ds[1] * ray.length, ds[2] * ray.length);
      this.jRay.mOrigin = this.jOrigin;
      this.jRay.mDirection = this.jDir;
      this.collector.Reset();
      this.query.CastRay(
        this.jRay,
        this.settings,
        this.collector,
        this.bpFilter,
        this.objFilter,
        this.bodyFilter,
        this.shapeFilter,
      );
      if (!this.collector.HadHit()) {
        this.world.clearWheelContact(this.vehicle, w);
        continue;
      }
      const hit = this.collector.mHit;
      const toi = hit.mFraction * ray.length;
      const hx = ox + ds[0] * toi;
      const hy = oy + ds[1] * toi;
      const hz = oz + ds[2] * toi;
      const c = this.contact;
      f.vecToCore([hx, hy, hz], c.point);
      this.jPoint.Set(hx, hy, hz);
      const hitBody = this.locks.TryGetBody(hit.mBodyID);
      const n = hitBody.GetWorldSpaceSurfaceNormal(hit.mSubShapeID2, this.jPoint);
      f.vecToCore([n.GetX(), n.GetY(), n.GetZ()], c.normal);
      if (c.normal[0] * d[0] + c.normal[1] * d[1] + c.normal[2] * d[2] > 0) {
        c.normal[0] = -c.normal[0];
        c.normal[1] = -c.normal[1];
        c.normal[2] = -c.normal[2];
      }
      c.surfaceVelocity[0] = 0;
      c.surfaceVelocity[1] = 0;
      c.surfaceVelocity[2] = 0;
      if (this.surfaceVelocity && !hitBody.IsStatic()) {
        const sv = this.bodies.GetPointVelocity(hit.mBodyID, this.jPoint);
        f.vecToCore([sv.GetX(), sv.GetY(), sv.GetZ()], c.surfaceVelocity);
      }
      c.surfaceId = this.surfaceId ? this.surfaceId(hit.mBodyID, this.bodies) : 0;
      this.world.writeWheelContact(this.vehicle, w, c);
    }
  }

  /**
   * Add the step's impulses to the body as a force and torque over the
   * coming Jolt step of `dt` seconds (the same `dt` the Skidpad world was
   * stepped with). Call after `world.step`, before `jolt.Step`.
   */
  afterStep(dt: number): void {
    const imp = this.world.readHostImpulse(this.vehicle, this.impulse);
    const f = this.frame;
    const inv = dt > 0 ? 1 / dt : 0;
    const li = f.vecToScene(imp.impulse, this.v0);
    const ai = f.vecToScene(imp.angularImpulse, this.v1);
    this.jForce.Set(li[0] * inv, li[1] * inv, li[2] * inv);
    this.jTorque.Set(ai[0] * inv, ai[1] * inv, ai[2] * inv);
    const id = this.body.GetID();
    this.bodies.AddForce(id, this.jForce, this.Jolt.EActivation_Activate);
    this.bodies.AddTorque(id, this.jTorque, this.Jolt.EActivation_Activate);
  }

  /** Convenience for one vehicle per Skidpad world: before, step, after. */
  step(dt: number): void {
    this.beforeStep();
    this.world.step(dt);
    this.afterStep(dt);
  }

  /** Hand the vehicle back to the built-in host. */
  detach(): void {
    this.world.setHostMode(this.vehicle, "builtin");
  }

  /** Free the adapter's Jolt-heap scratch objects. The body stays yours. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const J = this.Jolt;
    for (const o of [
      this.jRay,
      this.jOrigin,
      this.jDir,
      this.jPoint,
      this.jForce,
      this.jTorque,
      this.settings,
      this.collector,
      this.bpFilter,
      this.objFilter,
      this.bodyFilter,
      this.shapeFilter,
    ]) {
      J.destroy(o);
    }
  }
}
