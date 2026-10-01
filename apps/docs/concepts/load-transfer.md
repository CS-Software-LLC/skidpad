# Load transfer

When a car accelerates, brakes, or corners, load moves between the tires. The
total is unchanged, but because peak friction _per unit load_ falls as load
rises ([load sensitivity](/concepts/slip)), the loaded tire gains less than the
unloaded tire loses. Net grip falls, and the axle that lost the most grip
decides the balance.

Longitudinal transfer is `m · a_x · h / L`: mass, acceleration, centre-of-mass
height over wheelbase. Braking loads the front; the front axle therefore
tolerates more brake torque, which is what brake bias is about.

The single-track model has longitudinal transfer only. Lateral transfer,
which depends on roll stiffness distribution, arrives with the four-wheel
model and the anti-roll bars in milestone 2.

## Understeer gradient

The steer angle a car needs to hold a circle grows with lateral acceleration.
That slope is the understeer gradient. Linear theory gives

`K_us = (m / L) · (b / C_f − a / C_r)`

with `C_f`, `C_r` the axle cornering stiffnesses. A nose-heavy car with equal
tires understeers because stiffness per unit load falls with load. The
[validation page](/validation/) compares the simulated gradient against this
formula, corrected for pneumatic trail.
