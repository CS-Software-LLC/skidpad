# Aerodynamics

The aero model is three forces from the same dynamic pressure: a drag force
against the velocity and a lift force at each axle, with the drag on a line
that may sit above the centre of mass
([ADR-0015](https://github.com/CS-Software-LLC/skidpad/blob/main/docs/adr/0015-aero-lift-and-drag-height.md)).
Every coefficient in `aero` is referenced to the one `frontalArea`, as wind
tunnels quote them, and `q = ½ · airDensity · frontalArea` is the common
factor.

## Drag

`F_drag = q · dragCoefficient · V²`, against the velocity of the centre of
mass. On its own it only slows the car. `dragHeightAboveCg` puts its line of
action that far above the centre of mass along the body's up axis, which is
where a real car's drag acts: the body is above the wheels and the wake is
behind the roof. Drag high on the body pitches the nose up and moves load
rearward at speed. The single-track model has no pitch, so it moves the
load directly: `F_drag · dragHeightAboveCg / wheelbase` from the front axle
to the rear.

## Lift

`liftCoefficientFront` and `liftCoefficientRear` give a force at each axle,
`L = q · C_l · V_x²` with `V_x` the body-frame forward speed, so sideways
motion makes no lift. Positive is lift, negative is downforce. A road car
has a little lift at both ends (a few hundredths), a winged car a lot of
downforce.

On the four-wheel model each lift force is applied to the body along its up
axis at the axle's position. It reaches the tires through the springs, as
it does on a real car: downforce compresses the suspension, the ride height
drops with speed, and the tire load rises by what the spring now carries.
The raycast suspension needs no special case for it, and the consequences
come for free: a car with downforce needs stiffer springs or less travel
than its mass alone would ask for, or it sits on its bump stops at speed,
and the `SuspTravel_*` channels show it happening. The single-track model
has no springs, so the lift is added to each axle's load directly.

Because the load sits on the tire, downforce raises the grip of that axle
through the tire's load sensitivity: not in proportion, since friction per
unit load falls as load rises ([slip](/concepts/slip)), but a car that
corners at 1.6 g on its tires alone corners harder still with half its
weight again pressing down on it. The balance of front to rear lift sets the aero balance, which
shifts the handling balance with speed in the same way the static weight
distribution sets it at low speed.

## The open-wheeler preset

`openWheeler` is a junior single-seater in the 600 kg class with lift
coefficients of −1.2 front and −1.8 rear on a 1.0 m² frontal area and a
drag coefficient of 0.9. At 180 km/h that is about 4.6 kN of downforce,
near 0.8 of its weight, with the drag acting 0.15 m above the centre of mass
at the wing heights. Its ride frequencies are around 3.5 Hz for that reason.
Below about 100 km/h the wings add little, and full throttle in the lower
gears is more than the rear slicks can take, so the preset ships with
traction and stability control on (and ABS); turn them off under `assists`
for the unassisted car.
The road-car presets carry small positive lift coefficients from their data
sheets; the kart has none.

## Telemetry

`DragForce` is the drag magnitude in newtons. `AeroLift_F` and `AeroLift_R`
are the lift forces at each axle, positive up, so a car with downforce shows
negative values that grow with the square of speed.

## Tuning

- More negative `liftCoefficientRear` adds rear grip at speed, which is
  stability: the car that is loose only on fast corners usually wants rear
  downforce, or less front, rather than a tire change.
- Keep the two coefficients in proportion to the static weight
  distribution for an aero balance that does not move with speed; a
  front-heavy aero balance is a car that gets nervous as it goes faster.
- `dragHeightAboveCg` is a small effect on a road car (a tenth of a metre
  moves a couple of kilograms of load rearward at motorway speed) and a
  real one on a tall vehicle or a winged car with the rear wing high up.
- Downforce needs springs: check `SuspTravel_*` at top speed against
  `travelBump`, and raise `springRate` before touching the dampers.
