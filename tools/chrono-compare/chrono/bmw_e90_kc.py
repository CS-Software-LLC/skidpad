"""
Kinematics sweep of Project Chrono's BMW_E90, as a kinematics-and-compliance rig does it: the
parked car's chassis is held and moved slowly in heave, then in roll, with the steering centred,
and every wheel's travel, toe and camber relative to the chassis is logged. Skidpad's travel
curves (ADR-0026) for the comparison car take their toe from here; see
docs/validation/chrono-bmw-e90.md for why the front's comes from Chrono rather than the
hardpoint solver in src/kinematics.ts.

Usage (needs a PyChrono 9.0.1 environment, see tools/chrono-compare/README.md):
    python tools/chrono-compare/chrono/bmw_e90_kc.py

Writes tools/chrono-compare/reference/kc.csv. Columns: phase (rest, heave, roll), heave (m, +
raises the chassis), roll (rad, + = left side up), then per wheel 0..3 (FL, FR, RL, RR): z (m,
spindle height in the chassis frame), toe (deg, + = toe-in) and camber (deg, + = top outboard,
so negative is top-in).
"""
import csv
import math
import os

import pychrono as chrono
import pychrono.vehicle as veh

from bmw_e90 import OUT, STEP, make_car, wheel_list

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


def wheel_row(v, ref_frame):
    rot = ref_frame.GetRot()
    out = []
    for a, s in wheel_list(v):
        p = ref_frame.TransformPointParentToLocal(v.GetSpindlePos(a, s))
        axle = outboard_axle(v, rot, a, s)
        # Toe-in, the wheel's front turned toward the centreline: the outboard axle leans
        # forward on either side (`bmw_e90.py`'s `wheel_angle`, negated on the left).
        toe = math.degrees(math.atan2(axle.x, abs(axle.y)))
        camber = -math.degrees(math.asin(max(-1.0, min(1.0, axle.z))))
        out += [p.z, toe, camber]
    return out


def advance(car, terrain, t, inputs):
    terrain.Synchronize(t)
    car.Synchronize(t, inputs, terrain)
    terrain.Advance(STEP)
    car.Advance(STEP)
    return t + STEP


def main():
    car, terrain = make_car()
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
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'kc.csv'), 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows([[r[0]] + [f'{x:.6g}' for x in r[1:]] for r in rows])
    print(f'kc: {len(rows)} rows; rest', rows[0])


if __name__ == '__main__':
    main()
