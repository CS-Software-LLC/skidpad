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
angle needed at low speed. The push eases as load transfer unloads the
inner wheel, so the fitted gradient comes out slightly negative. Real karts
lift the inner rear wheel through steering-geometry jacking, which arrives in
milestone 5; the single-track model, with one wheel per axle, shows the
kart's underlying understeer.

**Straight line** reports 0–100 km/h at full throttle, through the
preset's drivetrain (the automatic launches on its clutch and shifts up, so
the time includes wheelspin and the torque holes), and 100–0 km/h at full
brake with no ABS, so cars whose brakes exceed tire grip lock their wheels
and stop on sliding friction. Published road-test distances assume ABS and
are shorter; the gap closes in milestone 5.

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

**Scripted drive hash** is the state hash after a fixed 30 s drive. It changes
whenever anything physics-visible changes, and it must match across Chromium,
Firefox, WebKit, and Node. The determinism harness also replays a recorded lap
of the sandbox track for each preset; see the
[determinism contract](/guide/determinism-contract).

## Coming with later milestones

Step steer (ISO 7401), double lane change (ISO 3888) and a rest-jitter
measurement on an external host.
