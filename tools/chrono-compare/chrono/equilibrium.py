"""
Ride height of a Project Chrono reference car at its true static equilibrium, without the tires.

A parked car rests where its tires' static friction propped it while it settled, and a rolling one
where its toe-in forces jack it, so neither is the suspension's own equilibrium, the state Skidpad's
travel is measured from. Here the parked car's chassis is held, each spindle is pushed up, at its centre, by the load its tire
carries at rest, and the chassis is raised slowly until the tires hang clear of the ground. Gravity still acts on every unsprung body, so once the dampers have settled each wheel sits
where its spring balances its corner's load with no tire force acting sideways or fore and aft.

Usage (needs a PyChrono 9.0.1 environment, see tools/chrono-compare/README.md):
    python tools/chrono-compare/chrono/equilibrium.py bmw_e90|sedan

Writes tools/chrono-compare/reference/<car>/equilibrium.json: each wheel's (FL, FR, RL, RR) load
pushed with (N, from static.json) and spindle height in the chassis frame (m), at equilibrium and
at rest (the parked car, as kc.csv's rest row), the difference (travel, m, + bump), and each
wheel's toe-in at equilibrium (rad).
"""
import importlib
import json
import os
import sys

import pychrono as chrono
import pychrono.vehicle as veh

from common import STEP, make_car, wheel_angle, wheel_list

RAISE = 0.1  # m: the tires hang clear of the ground
RAISE_SPEED = 0.02  # m/s: slow, as kc.py moves the chassis, so every joint follows
SETTLE = 4.0  # s at the raised height


def main(spec):
    static = json.load(open(os.path.join(spec.out, 'static.json')))
    car, terrain = make_car(spec)
    v = car.GetVehicle()
    inputs = veh.DriverInputs()
    inputs.m_braking = 0.3
    t = 0.0

    def advance():
        nonlocal t
        terrain.Synchronize(t)
        car.Synchronize(t, inputs, terrain)
        terrain.Advance(STEP)
        car.Advance(STEP)
        t += STEP

    while t < 3.0:
        advance()
    body = v.GetChassisBody()
    rest = chrono.ChFramed(body.GetFrameRefToAbs())

    def heights(frame):
        return [frame.TransformPointParentToLocal(v.GetSpindlePos(a, s)).z for a, s in wheel_list(v)]

    at_rest = heights(rest)
    body.SetFixed(True)
    pushes = []
    for (a, s), load in zip(wheel_list(v), static['loads']):
        spindle = v.GetAxle(a).GetWheel(s).GetSpindle()
        pushes.append((spindle, spindle.AddAccumulator(), load))
    raise_steps = int(RAISE / RAISE_SPEED / STEP)
    frame = rest
    for k in range(raise_steps + int(SETTLE / STEP)):
        if k < raise_steps:
            lift = RAISE * (k + 1) / raise_steps
            frame = chrono.ChFramed(rest.GetPos() + chrono.ChVector3d(0, 0, lift), rest.GetRot())
            body.SetFrameRefToAbs(frame)
        for spindle, idx, load in pushes:
            spindle.EmptyAccumulator(idx)
            spindle.AccumulateForce(idx, chrono.ChVector3d(0, 0, load), spindle.GetPos(), False)
        advance()
    at_eq = heights(frame)
    steer = [wheel_angle(v, v.GetRot(), a, s) for a, s in wheel_list(v)]
    if max(abs(x) for x in steer) > 0.05:
        sys.exit(f'a wheel turned while the chassis was raised: {steer}')
    out = {
        'loads': static['loads'],
        'toe': [(-1 if s == veh.LEFT else 1) * x for (a, s), x in zip(wheel_list(v), steer)],
        'restZ': at_rest,
        'equilibriumZ': at_eq,
        'travel': [e - r for e, r in zip(at_eq, at_rest)],
    }
    json.dump(out, open(os.path.join(spec.out, 'equilibrium.json'), 'w'), indent=2)
    print(spec.name, 'equilibrium travel from rest (mm):', [round(1000 * x, 1) for x in out['travel']])


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('usage: equilibrium.py bmw_e90|sedan')
    main(importlib.import_module(sys.argv[1]).CAR)
