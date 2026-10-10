"""
Reference runs of Project Chrono's generic Sedan (`src/chrono_models/vehicle/sedan/`): double
wishbone front, multi-link rear, front-wheel drive, no anti-roll bars, on its Pac02 (Magic Formula
2002) tire. The driver is `common.py`.

Usage (needs a PyChrono 9.0.1 environment, see tools/chrono-compare/README.md):
    python tools/chrono-compare/chrono/sedan.py [maneuver ...]      # default: static and all

Writes tools/chrono-compare/reference/sedan/.
"""
import pychrono.vehicle as veh

from common import Car, main


def create():
    car = veh.Sedan()
    car.SetTireType(veh.TireModelType_PAC02)
    return car


CAR = Car(
    name='sedan',
    create=create,
    init_height=0.5,
    wheel_radius=0.344,  # Sedan_Pac02Tire.tir UNLOADED_RADIUS
    # ChPac02Tire scales its friction by terrain mu / 0.8 (`m_mu0`): at 0.8 the .tir applies unscaled.
    terrain_mu=0.8,
    gears=[3.778, 2.045, 1.276, 0.941, 0.784, 0.667],
    final_drive=5.0,  # Sedan_Driveline2WD conical gear ratio 0.2
    upshift_rpm=[4000, 4500, 4500, 4500, 4500, 4500],
)

if __name__ == '__main__':
    main(CAR)
