"""
Reference runs of Project Chrono's BMW_E90 (330i-class sedan) for comparing Skidpad against an
independent multibody vehicle simulator.

Adapted from bench/chrono/bmw_e90.py in the sibling project csummers88/vehicle-physics-new (MIT,
same author), which produced the first version of this data. Changes here: output paths, and the
road-wheel angle of all four wheels is logged (delta0..delta3) and measured at rest (static.json
"toe"), because the Skidpad harness drives its car with Chrono's mean front road-wheel angle.

Usage (needs a PyChrono 9.0.1 environment, see tools/chrono-compare/README.md):
    python tools/chrono-compare/chrono/bmw_e90.py [maneuver ...]      # default: all

Writes tools/chrono-compare/reference/<maneuver>.csv (100 Hz) and reference/static.json.
Maneuver inputs are defined in chrono/maneuvers.json and shared with the Skidpad harness.
Conventions in the CSVs (vehicle frame): x forward, y left, z up; steer input + = right.
"""
import csv
import json
import math
import os
import sys

import pychrono as chrono
import pychrono.vehicle as veh

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'reference')
MANEUVERS = json.load(open(os.path.join(ROOT, 'chrono', 'maneuvers.json')))
STEP = 1e-3
LOG_EVERY = 10  # 100 Hz
TERRAIN_MU = 0.85  # equals the TMsimple reference mu_0: tire tables apply unscaled
CD, AREA, RHO = 0.30, 2.2, 1.2

veh.SetVehicleDataPath(chrono.GetChronoDataPath() + 'vehicle/')


def make_car(init_speed=0.0):
    car = veh.BMW_E90()
    car.SetContactMethod(chrono.ChContactMethod_NSC)
    car.SetChassisFixed(False)
    car.SetInitPosition(chrono.ChCoordsysd(chrono.ChVector3d(0, 0, 0.37), chrono.QUNIT))
    car.SetBrakeType(veh.BrakeType_SHAFTS)
    car.SetTireStepSize(STEP)
    car.SetAerodynamicDrag(CD, AREA, RHO)
    if init_speed > 0:
        car.SetInitFwdVel(init_speed)
        car.SetInitWheelAngVel([init_speed / 0.3186] * 4)  # + = rolling forward
    car.Initialize()
    terrain = veh.RigidTerrain(car.GetSystem())
    mat = chrono.ChContactMaterialNSC()
    mat.SetFriction(TERRAIN_MU)
    mat.SetRestitution(0.01)
    patch = terrain.AddPatch(mat, chrono.ChCoordsysd(chrono.ChVector3d(0, 0, 0), chrono.QUNIT), 6000, 6000)
    terrain.Initialize()
    return car, terrain


def interp(points, t):
    """Piecewise-linear [[t, v], ...]."""
    if t <= points[0][0]:
        return points[0][1]
    for (t0, v0), (t1, v1) in zip(points, points[1:]):
        if t <= t1:
            return v0 + (v1 - v0) * (t - t0) / (t1 - t0) if t1 > t0 else v1
    return points[-1][1]


def steer_at(spec, t):
    s = spec.get('steer')
    if s is None:
        return 0.0
    if s['type'] == 'points':
        return interp(s['points'], t)
    if s['type'] == 'sine':
        if t < s['start'] or t > s['start'] + s['cycles'] / s['freq']:
            return 0.0
        return s['amp'] * math.sin(2 * math.pi * s['freq'] * (t - s['start']))
    raise ValueError(s['type'])


class SpeedController:
    """Identical PI cruise control in both harnesses (see bench/revline/run.ts)."""

    def __init__(self, target):
        self.target = target
        self.i = 0.0

    def update(self, speed, dt):
        e = self.target - speed
        self.i = max(-2.0, min(2.0, self.i + e * dt))
        u = 0.4 * e + 0.15 * self.i
        return (max(0.0, min(1.0, u)), max(0.0, min(1.0, -u * 0.5)))


def tire_force(tire, terrain, rot=None):
    """Tire force in the vehicle frame (x fwd, y left, z up). ReportTireForceLocal is unreliable for TMsimple."""
    f = tire.ReportTireForce(terrain).force
    return rot.RotateBack(f) if rot is not None else f


def wheel_list(v):
    return [(0, veh.LEFT), (0, veh.RIGHT), (1, veh.LEFT), (1, veh.RIGHT)]


def wheel_angle(v, rot, a, s):
    """Road-wheel angle relative to the chassis, rad, + = left (toe and steer)."""
    # The spindle frame spins with the wheel; its y axis (the axle) does not.
    q = rot.GetConjugate() * v.GetSpindleRot(a, s)
    axle = q.Rotate(chrono.ChVector3d(0, 1, 0))
    if axle.y < 0:
        axle = axle * -1.0
    return math.atan2(-axle.x, axle.y)


def run(name, spec):
    car, terrain = make_car(spec.get('initSpeed', 0.0))
    v = car.GetVehicle()
    if spec.get('initSpeed', 0) > 0:
        # Start in the gear the shift map would hold at this speed (like the Revline harness), instead
        # of 1st gear at 100 km/h, which drags the car down through engine braking until it upshifts.
        ratios = [4.71, 2.34, 1.52, 1.14, 0.87, 0.69]
        shaft = spec['initSpeed'] / 0.3186 * 3.64
        g = 1
        while g < 6 and shaft * ratios[g - 1] * 30 / math.pi > 5500:
            g += 1
        v.GetTransmission().SetGear(g)
    speed_ctl = SpeedController(spec['holdSpeed']) if 'holdSpeed' in spec else None
    pre_ctl = SpeedController(spec.get('initSpeed', 0.0))
    rows = []
    t = 0.0
    step = 0
    x0 = v.GetPos().x
    duration = spec['duration']
    settle = spec.get('settle', 1.0)
    while t < duration + settle:
        tm = t - settle  # maneuver time (settle phase: parked, brakes on unless moving)
        inputs = veh.DriverInputs()
        spd = v.GetSpeed()
        if tm < 0:
            # Pre-phase: parked with brakes on, or holding the initial speed with the shared PI controller.
            if spec.get('initSpeed', 0) > 0:
                inputs.m_throttle, inputs.m_braking = pre_ctl.update(spd, STEP)
            else:
                inputs.m_throttle, inputs.m_braking = 0.0, 0.3
            inputs.m_steering = 0.0
        else:
            thr = interp(spec['throttle'], tm) if 'throttle' in spec else 0.0
            brk = interp(spec['brake'], tm) if 'brake' in spec else 0.0
            if speed_ctl:
                thr, brk = speed_ctl.update(spd, STEP)
            inputs.m_throttle = thr
            inputs.m_braking = brk
            # Chrono: + steering = left. Maneuvers use Revline's convention (+ = right).
            inputs.m_steering = -steer_at(spec, tm)
        terrain.Synchronize(t)
        car.Synchronize(t, inputs, terrain)
        terrain.Advance(STEP)
        car.Advance(STEP)
        t += STEP
        step += 1
        if step % LOG_EVERY == 0 and tm >= 0:
            rot = v.GetRot()
            com_local = v.GetCOMFrame().GetPos()
            acc = rot.RotateBack(v.GetPointAcceleration(com_local))
            vel = rot.RotateBack(v.GetPointVelocity(com_local))
            row = {
                't': round(tm, 4),
                'x': v.GetPos().x - x0,
                'y': v.GetPos().y,
                'speed': vel.x,
                'vy': vel.y,
                'ax': acc.x,
                'ay': acc.y,
                'yawRate': v.GetYawRate(),
                'roll': v.GetRoll(),
                'pitch': v.GetPitch(),
                'rpm': v.GetEngine().GetMotorSpeed() * 30 / math.pi,
                'gear': v.GetTransmission().GetCurrentGear(),
                'throttle': inputs.m_throttle,
                'brake': inputs.m_braking,
                'steer': -inputs.m_steering,
            }
            # Road-wheel steer angles (rad, + = left) of all four wheels relative to the chassis.
            for i, (a, s) in enumerate(wheel_list(v)):
                row[f'delta{i}'] = wheel_angle(v, rot, a, s)
            for i, (a, s) in enumerate(wheel_list(v)):
                tire = v.GetTire(a, s)
                f = tire_force(tire, terrain, rot)
                row[f'fz{i}'] = f.z
                row[f'fx{i}'] = f.x
                row[f'fy{i}'] = f.y
                row[f'slip{i}'] = tire.GetLongitudinalSlip()
                row[f'alpha{i}'] = tire.GetSlipAngle()
                row[f'omega{i}'] = v.GetSpindleOmega(a, s)
            rows.append(row)
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, f'{name}.csv'), 'w', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows([{k: (f'{v:.6g}' if isinstance(v, float) else v) for k, v in r.items()} for r in rows])
    print(f'{name}: {len(rows)} rows, final speed {rows[-1]["speed"]:.2f} m/s, x {rows[-1]["x"]:.1f} m')


def static_properties():
    """Settled ride, loads, steering geometry and inertia for building the matching Revline car."""
    car, terrain = make_car()
    v = car.GetVehicle()
    t = 0.0
    inputs = veh.DriverInputs()
    inputs.m_braking = 0.3
    while t < 3.0:
        terrain.Synchronize(t)
        car.Synchronize(t, inputs, terrain)
        terrain.Advance(STEP)
        car.Advance(STEP)
        t += STEP
    ref = v.GetChassis().GetPos()
    com = v.GetCOMFrame().GetPos()
    I = v.GetInertia()
    out = {
        'mass': v.GetMass(),
        'wheelbase': v.GetWheelbase(),
        'track': [v.GetWheeltrack(0), v.GetWheeltrack(1)],
        'comLocal': [com.x, com.y, com.z],
        'inertia': [[I[r, c] for c in range(3)] for r in range(3)],
        'refHeight': ref.z,
        'loads': [tire_force(v.GetTire(a, s), terrain).z for a, s in wheel_list(v)],
        'spindleLocal': [],
    }
    rot = v.GetRot()
    for a, s in wheel_list(v):
        p = rot.RotateBack(v.GetSpindlePos(a, s) - ref)
        out['spindleLocal'].append([p.x, p.y, p.z])
    # Static toe of each wheel (rad, + = left), at rest with the steering centred.
    out['toe'] = [wheel_angle(v, rot, a, s) for a, s in wheel_list(v)]
    # Steering: road-wheel angles for a sweep of inputs (Chrono + = left).
    sweep = []
    for u in [0.25, 0.5, 0.75, 1.0]:
        inputs = veh.DriverInputs()
        inputs.m_steering = u
        inputs.m_braking = 0.3
        for _ in range(1500):
            terrain.Synchronize(t)
            car.Synchronize(t, inputs, terrain)
            terrain.Advance(STEP)
            car.Advance(STEP)
            t += STEP
        angles = []
        for a, s in [(0, veh.LEFT), (0, veh.RIGHT)]:
            q = rot.GetConjugate() * v.GetSpindleRot(a, s)
            fwd = q.Rotate(chrono.ChVector3d(1, 0, 0))
            angles.append(math.atan2(fwd.y, fwd.x))
        sweep.append({'input': u, 'left': angles[0], 'right': angles[1]})
    out['steerSweep'] = sweep
    os.makedirs(OUT, exist_ok=True)
    json.dump(out, open(os.path.join(OUT, 'static.json'), 'w'), indent=2)
    print('static:', json.dumps({k: out[k] for k in ['mass', 'comLocal', 'refHeight', 'loads']}))
    print('steer sweep:', sweep)


if __name__ == '__main__':
    names = sys.argv[1:] or ['static'] + list(MANEUVERS.keys())
    for n in names:
        if n == 'static':
            static_properties()
        else:
            run(n, MANEUVERS[n])
