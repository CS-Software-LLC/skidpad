# Validation

Every merge runs the standard manoeuvres for each reference vehicle and
compares them against golden results with tolerances. Physics-visible changes
must update the golden file in the same pull request and say so in a
`physics:` changeset line.

## Current results

<ValidationTable />

**Understeer gradient** follows ISO 4138 (constant radius, 40 m, speeds 4 to
12 m/s), run on the four-wheel model and, as a cross-check, on the
single-track model from the same definition. Each point's steer angle is
reduced by the Ackermann angle of the path actually driven, `L · r / V`,
before the fit, so the small speed errors a drivetrain leaves at part
throttle do not bias the slope. The "linear theory" column is
`K_us = (m / L') · (b' / C_f − a' / C_r)` with axle cornering stiffnesses at
their static loads and moment arms corrected for pneumatic trail. The
single-track model agrees with it within a few hundredths of a degree per g;
the residual is tire nonlinearity across the measured lateral-acceleration
range. The four-wheel model sits a few tenths higher because lateral load
transfer, split by roll stiffness, costs the more heavily loaded axle grip
through load sensitivity ([load transfer](/concepts/load-transfer)), and the
sports car's limited-slip differential adds a little more under power. The
kart is the exception: its solid rear axle ([drivetrain](/concepts/drivetrain))
forces both rear wheels to one speed, so in a corner the inner wheel drives
and the outer brakes, a yaw moment against the turn that doubles the steer
angle needed at low speed. The push eases as load transfer and steering jacking
([ADR-0012](https://github.com/csummers88/skidpad/blob/main/docs/adr/0012-steering-geometry-and-rack-force.md))
unload the inner rear wheel, so a linear fit over lateral acceleration reads
it as a negative gradient: the number is a poor summary for a solid axle, and
the per-point steer angles in the golden file tell the story (twice the
Ackermann angle at 4 m/s, falling with speed). The single-track model, with
one wheel per axle, shows the kart's underlying understeer.

**Straight line** reports 0–100 km/h at full throttle, through the
preset's drivetrain (the automatic launches on its clutch and shifts up, so
the time includes wheelspin and the torque holes), and 100–0 km/h at full
brake with no ABS, so cars whose brakes exceed tire grip lock their wheels
and stop on sliding friction. Published road-test distances assume ABS; the
table also shows the same stop with the ABS assist on
([assists](/concepts/assists)), which brings the sports car to within a few
metres of its data sheet.

**Locked brakes** is measured on that same stop. A wheel that locks must lock
once and stay locked: the scenario counts every change between rolling and
locked at substep resolution and reports the releases while the car is still
moving, which is lock chatter; the reference vehicles show none. The driven
wheels lock last, because they also have to drag the engine's reflected
inertia down through the clutch; the kart's single-speed engine from near
redline takes the longest. The
deceleration on sliding friction is reported as its relative RMS ripple about
a 0.2 s moving average (below 0.01 % for every preset; the slow drift with
speed from aero drag and the friction curve is not counted). After the stop
the brake stays held for two seconds: the sliding tires release the
contact-patch deflection they stored
([ADR-0010](https://github.com/csummers88/skidpad/blob/main/docs/adr/0010-contact-patch-deflection-at-standstill.md)),
a spring-back of a few centimetres at under 0.3 m/s, and the car must then be
at rest below 0.1 mm/s.

**Parks on slopes** runs the standstill scenarios: at rest on flat ground
with no inputs, parked facing uphill on 10 %, 20 % and 30 % grades on the
service brake, on 10 % and 20 % grades on the handbrake alone (skipped for
vehicles without one), and across a 20 % slope with both held. After a 5 s
settle the car must sit below 0.1 mm/s, drift less than 1 mm over the next
10 s and show no sustained oscillation (velocity RMS below 0.1 mm/s over the
last 5 s). The table shows the worst creep speed over the cases.

**Timestep sweep** runs the skidpad (three speeds), the locked-wheel stop and
a parked hold on a 30 % grade at every combination of internal substep rate
(250, 500, 1000, 2000 Hz) and host step rate (30, 60, 120, 240 Hz), and
compares each cell with a reference cell at the definition's own substep rate
and the 100 Hz host step the other scenarios use. A vehicle passes when every
cell is finite, parks, stops without chatter and comes to rest, the understeer
gradient stays within 0.05 deg/g of the reference and the braking distance
within 1 %. The presets sit at a thousandth of a degree per g and under 1 %.
On the built-in host the host rate only changes how often the inputs update
(the proxy integrates at the substep rate), so the sweep is mostly a check on
the substep rate; the host-rate dimension is there for the external-host
contract, where the impulse exchange runs at the host rate.

**Step steer** follows ISO 7401: the car runs straight at 80 km/h, then
the road-wheel angle is ramped over 0.1 s (the standard allows up to 0.15 s;
a ramp keeps the result independent of which host step the input lands on)
to the angle linear theory needs for 4 m/s² of lateral acceleration, with
the definition's own cornering stiffnesses and trail, and held for 5 s. The
table shows the time for the yaw rate to first reach 90 % of its steady
state and its overshoot past it; the golden file also has the steady yaw
rate and its gain per radian of steer, the lateral-acceleration response
time, the steady side-slip angle and the roll. A short wheelbase and a small
yaw inertia answer fastest: the kart in under two tenths of a second, the
road cars in two to three. The lateral acceleration comes out a little under the
4 m/s² aimed for because the steer angle is the linear one and the tires
are not.

**Double lane change** lays out the ISO 3888-1 course: 15, 30, 25, 25 and
15 m sections with lane widths of 1.1, 1.2 and 1.3 times the vehicle width
plus 0.25 m and a 3.5 m offset between the lane centres (the ISO 3888-2
"moose test" course is an option). The vehicle width defaults to the track
width plus 0.25 m. A scripted driver steers through at each entry speed
from 50 to 110 km/h in steps of 10: path-curvature feedforward with the
linear understeer gradient, pure pursuit on a smooth centreline, and up to
four practice runs per speed in which it learns a steering correction
along the course from the path error of the previous run, as a test driver
does; the best run counts. A speed passes when every wheel stayed inside
the coned lanes of sections 1, 3 and 5, and the table shows the highest
speed that passed. The number depends on this driver as much as on the car,
so compare presets against each other and against road tests only loosely;
the per-speed attempts with their cone overlap, peak lateral acceleration,
yaw rate and side slip are in the golden file.

**Surfaces** repeats the 100–0 km/h stop on wet asphalt, gravel, snow and
ice from the [reference table](/concepts/surfaces), with locked wheels and
with the ABS. The distance scales roughly with the inverse of the grip, so
ice at 0.12 takes about seven times the dry distance; the ABS gains less on ice
than on asphalt because the surface scales the friction and not the
stiffness, so the force peaks at a smaller slip and the ABS's default slip
target of 0.12 sits past it. The table shows the ice column. A car
with rear-only brakes locks its rear wheels and swaps ends on snow and ice
(the kart does); the scenario flags it as spun, the distance is then what
it travelled before coming to rest, and the table shows "spins" instead of a
number.

**Scripted drive hash** is the state hash after a fixed 30 s drive. It changes
whenever anything physics-visible changes, and it must match across Chromium,
Firefox, WebKit, and Node. The determinism harness also replays a recorded lap
of the sandbox track for each preset; see the
[determinism contract](/guide/determinism-contract).

## Against an independent simulator

The scenarios above check Skidpad against linear theory, against itself across
timesteps, and against published road-test figures the presets were tuned to.
An independent check drives Skidpad and Project Chrono's multibody BMW E90
through the same manoeuvres with the same inputs, with the Skidpad car built
from Chrono's published constants. Steady-state handling agrees within a few
percent: understeer gradient, lateral acceleration to the limit, yaw gain,
roll and turn radius. The differences found are Skidpad's missing static toe,
which accounts for a quicker step-steer response, and its missing anti-dive
geometry. The
[report](https://github.com/csummers88/skidpad/blob/main/docs/validation/chrono-bmw-e90.md)
has the full results, and `tools/chrono-compare` reruns them.

## Coming with later milestones

A rest-jitter measurement on an external host: the standstill scenarios run
on the built-in host, and the external-host contract has only the timestep
sweep's host-rate dimension to cover it.
