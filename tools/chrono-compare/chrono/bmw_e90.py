"""
Reference runs of Project Chrono's BMW_E90 (330i-class sedan). The driver is `common.py`.

Usage (needs a PyChrono 9.0.1 environment, see tools/chrono-compare/README.md):
    python tools/chrono-compare/chrono/bmw_e90.py [maneuver ...]      # default: static and all

Writes tools/chrono-compare/reference/bmw_e90/.
"""
import pychrono.vehicle as veh

from common import Car, main

CAR = Car(
    name='bmw_e90',
    create=veh.BMW_E90,
    init_height=0.37,
    wheel_radius=0.3186,
    terrain_mu=0.85,  # equals the TMsimple reference mu_0: tire tables apply unscaled
    gears=[4.71, 2.34, 1.52, 1.14, 0.87, 0.69],
    final_drive=3.64,
    upshift_rpm=[5500] * 6,
)

if __name__ == '__main__':
    main(CAR)
