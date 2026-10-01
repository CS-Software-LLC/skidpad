# Load transfer

When a car accelerates, brakes, or corners, load moves between the tires. The
total is unchanged, but because peak friction _per unit load_ falls as load
rises ([load sensitivity](/concepts/slip)), the loaded tire gains less than the
unloaded tire loses. Net grip falls, and the axle that lost the most grip
decides the balance.

Longitudinal transfer is `m · a_x · h / L`: mass, acceleration, centre-of-mass
height over wheelbase. Braking loads the front; the front axle therefore
tolerates more brake torque, which is what brake bias is about.

Lateral transfer is `m · a_y · h / t` across the track, and the four-wheel
model splits it between the axles in proportion to their roll stiffness
(springs plus anti-roll bars, see [suspension](/concepts/suspension)). The
axle that takes the larger share loses more grip to load sensitivity, so a
stiff front bar adds understeer and a stiff rear bar removes it. The
single-track model has longitudinal transfer only, which is why it sits
closer to the linear theory below.

## Understeer gradient

The steer angle a car needs to hold a circle grows with lateral acceleration.
That slope is the understeer gradient. Linear theory gives

`K_us = (m / L) · (b / C_f − a / C_r)`

with `C_f`, `C_r` the axle cornering stiffnesses. A nose-heavy car with equal
tires understeers because stiffness per unit load falls with load. The
[validation page](/validation/) compares the four-wheel and single-track
gradients against this formula, corrected for pneumatic trail; the
four-wheel value is a few tenths of a degree per g higher because of the
lateral transfer.
