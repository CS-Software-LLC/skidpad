# Validation

Every merge runs the standard manoeuvres for each reference vehicle and
compares them against golden results with tolerances. Physics-visible changes
must update the golden file in the same pull request and say so in a
`physics:` changeset line.

## Current results

<ValidationTable />

**Understeer gradient** follows ISO 4138 (constant radius, 40 m, speeds 4 to
12 m/s), run on the four-wheel model and, as a cross-check, on the
single-track model from the same definition. The "linear theory" column is
`K_us = (m / L') · (b' / C_f − a' / C_r)` with axle cornering stiffnesses at
their static loads and moment arms corrected for pneumatic trail. The
single-track model agrees with it within a few hundredths of a degree per g;
the residual is tire nonlinearity across the measured lateral-acceleration
range. The four-wheel model sits a few tenths higher because lateral load
transfer, split by roll stiffness, costs the more heavily loaded axle grip
through load sensitivity ([load transfer](/concepts/load-transfer)).

**Straight line** reports 0–100 km/h at full throttle and 100–0 km/h at full
brake with no ABS, so cars whose brakes exceed tire grip lock their wheels and
stop on sliding friction. Published road-test distances assume ABS and are
shorter; the gap closes in milestone 5.

**Scripted drive hash** is the state hash after a fixed 30 s drive. It changes
whenever anything physics-visible changes, and it must match across Chromium,
Firefox, WebKit, and Node.

## Coming with later milestones

Step steer (ISO 7401), double lane change (ISO 3888), parked-on-slope tests,
rest-jitter measurement, and the full timestep sweep (internal 250 to 2000 Hz,
host 30 to 240 Hz).
