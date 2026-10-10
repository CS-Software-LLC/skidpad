"""
Kinematics sweep of a Project Chrono reference car, as a kinematics-and-compliance rig does it:
the parked car's chassis is held and moved slowly in heave, then in roll, with the steering
centred, and every wheel's travel, toe and camber relative to the chassis is logged. Skidpad's
travel curves (ADR-0026) for the E90 take their toe and camber from here (see
docs/validation/chrono-bmw-e90.md); the Sedan takes all of its geometry from here, because its
multi-link rear has no front-view instant-centre construction (docs/validation/chrono-sedan.md).

Usage (needs a PyChrono 9.0.1 environment, see tools/chrono-compare/README.md):
    python tools/chrono-compare/chrono/kc.py bmw_e90|sedan

Writes tools/chrono-compare/reference/<car>/kc.csv. Columns: phase (rest, heave, roll), heave (m,
+ raises the chassis), roll (rad, + = left side up), then per wheel 0..3 (FL, FR, RL, RR): z (m,
spindle height in the chassis frame), toe (deg, + = toe-in) and camber (deg, + = top outboard,
so negative is top-in); then per wheel x and y (m, spindle position in the chassis frame) and
spring (m, spring length, where the suspension type reports it). The E90's committed sweep
predates the last two groups.
"""
import csv
import importlib
import math
import os
import sys

import pychrono as chrono
import pychrono.vehicle as veh

from common import STEP, make_car, wheel_list

SPEED = 0.01  # m/s of heave, rad/s of roll: slow enough to be quasi-static
LOG_EVERY = 0.002  # m or rad between rows


def outboard_axle(v, rot, a, s):
    """Spindle axle direction in the chassis frame, pointing outboard."""
    q = rot.GetConjugate() * v.GetSpindleRot(a, s)
    axle = q.Rotate(chrono.ChVector3d(0, 1, 0))
    side = 1.0 if s == veh.LEFT else -1.0
    if axle.y * side < 0:
        axle = axle * -1.0
    return axle


def spring_length(v, a, s):
    """Spring length of the suspension at axle a, side s, or NaN if its type does not report one."""
    susp = v.GetSuspension(a)
    for cast in (veh.CastToChDoubleWishbone, veh.CastToChMultiLink, veh.CastToChMacPhersonStrut):
        typed = cast(susp)
        if typed is not None:
            return typed.GetSpringLength(s)
    return float('nan')


def wheel_row(v, ref_frame):
    rot = ref_frame.GetRot()
    out = []
    extra = []
    for a, s in wheel_list(v):
        p = ref_frame.TransformPointParentToLocal(v.GetSpindlePos(a, s))
        axle = outboard_axle(v, rot, a, s)
        # Toe-in, the wheel's front turned toward the centreline: the outboard axle leans
        # forward on either side (`common.py`'s `wheel_angle`, negated on the left).
        toe = math.degrees(math.atan2(axle.x, abs(axle.y)))
        camber = -math.degrees(math.asin(max(-1.0, min(1.0, axle.z))))
        out += [p.z, toe, camber]
        extra += [p.x, p.y, spring_length(v, a, s)]
    return out + extra


def advance(car, terrain, t, inputs):
    terrain.Synchronize(t)
    car.Synchronize(t, inputs, terrain)
    terrain.Advance(STEP)
    car.Advance(STEP)
    return t + STEP


def main(spec):
    car, terrain = make_car(spec)
    v = car.GetVehicle()
    inputs = veh.DriverInputs()
    inputs.m_braking = 0.3
    t = 0.0
    while t < 3.0:
        t = advance(car, terrain, t, inputs)
    body = v.GetChassisBody()
    # The chassis reference frame, as static.json's spindleLocal (GetPos is the centre of mass).
    rest = chrono.ChFramed(body.GetFrameRefToAbs())
    rows = [['rest', 0.0, 0.0] + wheel_row(v, rest)]
    body.SetFixed(True)

    def hold(heave, roll):
        rot = rest.GetRot() * chrono.QuatFromAngleX(roll)
        frame = chrono.ChFramed(rest.GetPos() + chrono.ChVector3d(0, 0, heave), rot)
        body.SetFrameRefToAbs(frame)
        return frame

    # Heave: up to 6 cm (the wheels hang on their rebound stops), down to 10 cm, back to rest.
    for phase, path in [('heave', [0.0, 0.06, -0.10, 0.0]), ('roll', [0.0, 0.06, -0.06, 0.0])]:
        last_logged = None
        for start, end in zip(path, path[1:]):
            n = max(1, int(abs(end - start) / (SPEED * STEP)))
            for k in range(1, n + 1):
                x = start + (end - start) * k / n
                frame = hold(x, 0.0) if phase == 'heave' else hold(0.0, x)
                t = advance(car, terrain, t, inputs)
                if last_logged is None or abs(x - last_logged) >= LOG_EVERY - 1e-12:
                    last_logged = x
                    heave, roll = (x, 0.0) if phase == 'heave' else (0.0, x)
                    rows.append([phase, heave, roll] + wheel_row(v, frame))
    header = ['phase', 'heave', 'roll']
    for i in range(4):
        header += [f'z{i}', f'toe{i}', f'camber{i}']
    for i in range(4):
        header += [f'x{i}', f'y{i}', f'spring{i}']
    os.makedirs(spec.out, exist_ok=True)
    with open(os.path.join(spec.out, 'kc.csv'), 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows([[r[0]] + [f'{x:.6g}' for x in r[1:]] for r in rows])
    print(f'kc: {len(rows)} rows; rest', rows[0])


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('usage: kc.py bmw_e90|sedan')
    main(importlib.import_module(sys.argv[1]).CAR)
