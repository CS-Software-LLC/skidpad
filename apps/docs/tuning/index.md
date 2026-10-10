# Tuning guide

Symptom first. Each entry names the parameter, where it lives, and why it
helps. Parameters are per tire unless noted.

## Car understeers on entry

- Soften the front `antiRollStiffness` or stiffen the rear. The axle with
  the larger share of roll stiffness takes more lateral load transfer and
  loses more grip to load sensitivity.
- Lower the rear `corneringStiffness` or raise the front. Balance is the
  ratio of front to rear cornering stiffness per unit load.
- Raise the front `stiffnessPeakLoad` (less saturation on the heavy axle) or
  lower the rear.
- Move `chassis.cgToFrontAxle` rearward. Less static front load means less
  front saturation.

## Car oversteers under power

- The driven axle loses lateral grip while it spins; lower the engine's
  `torqueCurve` or a tall first gear in `transmission.gears`, or raise the
  rear `peakSlipRatio` so the force peak sits at a larger slip.
- Raise the rear `falloffLong` so the tire keeps more grip past the peak.
- A limited-slip differential (`rear.kind: "lsd"`) with a high `biasDrive`
  drives the inner and outer wheels together and turns wheelspin into a yaw
  moment; lower the bias or the `preload` for a more forgiving exit.
- `assists.tractionControl` scales the throttle on drive slip; see
  [assists](/concepts/assists).

## Body rolls or pitches too much

- Raise `springRate` on both axles together to keep the balance, or raise
  `antiRollStiffness` to add roll stiffness without stiffening the ride.
- Raise `chassis.rollInertia` or `pitchInertia` to slow the motion rather
  than reduce it.
- Lower `chassis.cgHeight`: both transfers scale with it.
- For pitch alone, add `antiBrake` on both axles (anti-dive at the front,
  anti-lift at the rear) and `antiDrive` on the driven axle. Values of 0.2
  to 0.5 are typical. They change only the body's pitch, not the tire loads
  ([anti-dive](/concepts/suspension#anti-dive-and-anti-squat)).

## Car rolls too much in corners but rides well

- Raise `rollCenterHeight` on one or both axles. The share
  `rollCenterHeight / cgHeight` of that axle's lateral load transfer goes
  through the links instead of the springs, so the body rolls less for the
  same cornering force without a stiffer ride
  ([roll centres](/concepts/suspension#roll-centres)). It also moves the
  balance: the axle with the higher roll centre takes a larger share of
  the transfer, like a stiffer bar, so raise the rear for less understeer
  and the front for more.

## Car lifts or squats in corners, or darts over bumps

- A body that rises in long corners is jacking: the axle's roll centre is
  high, or rises in bump, so the loaded outer link pushes the body up
  (`JackingForce_F`, `JackingForce_R`). Lower `rollCenterHeight`, or make
  its `kinematics.rollCenterHeight` curve fall in bump. Static toe-in also
  lifts a car with a roll-centre curve; reduce it if the car rises on the
  straight.
- A car that steers itself over bumps or in roll has bump steer: flatten
  the `kinematics.toeDeg` curve. Toe-out in bump at the rear is roll
  oversteer, so the car turns in more as it rolls; toe-in in bump at the
  rear steadies it
  ([geometry that changes with travel](/concepts/suspension#geometry-that-changes-with-travel)).
- To make an axle's share of load transfer fall as the car rolls further,
  give its roll centre a curve that falls in bump.

## Car bounces after a bump or a landing

- Raise `bumpDamping` and `reboundDamping`. A damping ratio near 0.3 of
  critical (`c = 2 · 0.3 · √(k · m_corner)`) is a road-car starting point;
  rebound a third higher than bump.
- Check `travelBump`: if the car sits on its bump stops at rest,
  `validateDefinition()` warns about it.

## Inner front wheel spins out of corners

- That is an open differential doing what it does under power with the
  inner wheel unloaded. Set `drivetrain.front.kind` to `"lsd"`: `preload`
  (N·m) is what it locks with at zero torque, `biasDrive` how much more
  torque the slower wheel may carry than the spinning one under power
  (2 to 3 is a road-car range), `biasCoast` the same on the overrun. A
  `"locked"` differential is a spool and pushes in tight corners.

## Car launches lazily or bogs down

- The automatic clutch bites between idle and `clutchBiteRpm` above it; a
  smaller value engages sooner and stalls less speed off the engine, a
  larger one lets the engine rev first (a kart's centrifugal clutch). Raise
  `clutchMaxTorque` if the clutch slips at full throttle in first.
- `shiftUpAt` and `shiftDownAt` are fractions of redline on the gearbox
  input speed at full throttle; a long `shiftTime` is a visible torque hole.

## Automatic holds a low gear at part throttle, or short-shifts too early

- `shiftLightFactor` scales both shift points on a closed throttle, and they
  move linearly with the throttle up to `shiftUpAt` and `shiftDownAt`. Lower
  it to cruise in a higher gear at lower revs. Raise it toward 1 for a car
  that holds gears like a race box (1 shifts at the full-throttle points
  whatever the throttle). Upshifts are kept far enough above the next gear's
  downshift point that the car does not hunt, and pressing the pedal raises
  the downshift point, which is the kickdown.
- A `direct` power unit has none of this and pulls from rest at its full
  `maxWheelTorque`; use it for traffic.

## Engine drags the car on a closed throttle

- `engineBrakingIdle` and `engineBrakingRedline` set the closed-throttle
  drag; lower them for a car that coasts further. An electric motor's
  lift-off drag is `regenTorque`.
- A measured motoring map rises faster than a line at high revs. Give it
  as `engineBrakingCurve`, `[rpm, N·m]` points with the drag positive; it
  then replaces the two end values.

## Steering feels numb

- Lower `relaxationLengthLat` for a faster lateral response.
- Raise `pneumaticTrail` for more aligning torque at small slip, or
  `steering.mechanicalTrail` for torque that also stays when the pneumatic
  trail fades at the limit (more caster).
- Lower `steering.powerAssist`; it removes that fraction of the rack torque
  at the hand wheel.
- Reduce `steering.ratio` for more road-wheel angle per hand-wheel degree.

## Steering tugs under power or over bumps

- That is the scrub radius: `steering.scrubRadius` turns any left to right
  difference in longitudinal force into torque. Lower it, or soften the
  front differential's `biasDrive` if the pull comes with the throttle.

## A keyboard driver cannot keep the car straight at speed

- Turn on `assists.steeringAssist`; `latAccelLimit` is the lateral
  acceleration full lock aims for, so lower it for gentler steering at speed.
- `assists.stabilityControl` catches the slide itself; raise `gain` for a
  firmer hand, widen `deadBand` to let the car move around first.

## Wheels spin up on the launch

- `assists.tractionControl` scales the throttle on drive slip between
  `slipTarget` and `slipRelease`; set the target a little below the rear
  tire's `peakSlipRatio`.

## Braking distance is longer than road-test figures

- Road tests have ABS; turn on `assists.abs`. Its `slipTarget` should sit at
  the tire's `peakSlipRatio`; the `floor` is how much brake stays when a
  wheel runs away.

## Steering does not go light before the limit

- The trail crosses zero at `trailZeroCrossing` times the peak slip angle
  (default 1.0). Steering torque peaks at about 0.4 of that and is zero at
  the crossing, so with the default the wheel goes light while lateral grip
  is still rising and is weightless at the lateral peak. Raise the crossing
  (1.2 moves the torque peak to about 0.47 of the peak slip angle) for a
  wheel that stays loaded closer to the limit; lower it for an earlier
  warning.
- `trailReversal` (default 0.1) is how far the trail goes negative past the
  crossing, as a fraction of `pneumaticTrail`. The torque reverses by
  roughly a fifth of its peak at 1.5 peak slip angles with the default;
  raise it for a stronger "pulling into the slide" past the limit, set it
  near zero for a wheel that just goes dead.
- Braking or drive shortens the trail through the combined equivalent slip
  angle, so the wheel also lightens under trail braking. `fxMomentArm`
  (default 0) adds the Magic Formula `SSZ2` effect, where the longitudinal
  force acting off the wheel centre plane adds its own moment; a few
  centimetres is a road-tire value.

## Wheels lock under braking

- Lower `maxBrakeTorque` on the axle that locks, or shift bias toward the
  front where braking load goes. Dive moves load forward through the
  springs; stiffer front springs do not change the steady-state transfer. Mean deceleration in the validation table
  tells you when you are at the tire's limit.
- `assists.abs` holds each wheel at its slip target; the validation table
  reports the stop with and without it.

## Car feels like it is on ice

- Check the `SurfaceGrip_*` channels first: if they read below 1 the car
  is on a surface, not a tire problem.
- Raise `peakFriction`. Values above 1.2 are beyond road tires; fine for
  arcade.
- Lower `loadSensitivity` so load transfer costs less total grip.

## Car is loose at high speed only

- That is aero. A road car's small positive `liftCoefficientRear` unloads
  the rear with the square of speed; set it lower, or negative for
  downforce, and keep `liftCoefficientFront` in proportion to the static
  weight distribution so the balance stays put as speed rises
  ([aerodynamics](/concepts/aero)).
- `dragHeightAboveCg` moves load rearward at speed, which helps a little;
  it is a real effect only on tall cars and winged ones.

## Car is undrivable on ice or gravel

- Probably correct: ice is 0.12 of dry grip in the reference table and the
  tire peaks at a correspondingly smaller slip. Raise the surface's `grip`
  in your own table, or pick a kinder entry (`snow` is 0.3, `gravel` 0.6),
  before touching the tire ([surfaces](/concepts/surfaces)).
- `assists.abs` and `assists.tractionControl` are what make low grip
  drivable from a keyboard; `assists.stabilityControl` catches the yaw.
- A car with rear-only brakes swaps ends on ice; give the front axle some
  `maxBrakeTorque`.
- The ploughing `drag` of gravel, sand and snow holds the car back
  through the chassis; lower it in your table if the car will not reach
  speed.

## Outer wheel cambers off the road in corners

- On an independent axle the wheels lean with the body, so more roll is
  more positive camber on the outer tire and less grip. Add negative
  `staticCamberDeg`, reduce the roll (above), or declare the axle
  `suspension.kind: "solid"`, which keeps both wheels upright to the road
  whatever the body does ([solid axles](/concepts/suspension#solid-axles)).
  A solid axle tilts both wheels together over a one-wheel bump, which is
  the trade.

## Turn-in is too sharp, or the car is nervous on the straight

- Add a little toe-in, `staticToeDeg` of 0.1 to 0.3 degrees per wheel. The
  car answers the wheel a little later and settles with less overshoot. On
  the rear axle toe-in also steadies the car under braking and on lift-off.
- Toe-out on the front does the opposite and sharpens turn-in. Either way
  the scrub costs a little straight-line speed
  ([toe](/concepts/suspension#toe)).

## Car understeers more at speed than the steering ratio suggests

- Real steering gives under load. Measured against NHTSA's Jeep Cherokee
  (`docs/validation/nhtsa-jeep-cherokee.md`), a fixed ratio that matched at 40 km/h gave 16–29 % too much response at 80 km/h. Add
  `steering.alignTorqueComplianceDeg` (1 to 2 for a firm rack, up to about
  10 for a soft recirculating-ball box) rather than slowing the ratio: the
  compliance grows with cornering force, a ratio with steering angle.
- `lateralComplianceSteerDeg` on the rear axle (a few hundredths to a tenth)
  steadies a car that feels loose in fast corners without dulling its
  turn-in at low speed ([compliance steer](/concepts/steering#compliance-steer)).

## The car jitters or creeps when parked

- It should not. Raise `lowSpeedDamping` (the damping ratio of the
  contact-patch spring on the corner mass at standstill, default 0.7) or
  `lowSpeedDampingFade` (the rolling speed at which that damping is gone,
  default 2 m/s), and file an issue with a telemetry export; standstill
  stability is a feature we test, on 30 % grades and 20 % cross slopes.
- A car placed on a slope moves a few millimetres while its tire springs
  wind up, then holds. If it keeps moving, the brakes cannot hold it: check
  `maxBrakeTorque` and `brakes.handbrakeTorque` against
  `m · g · sin θ · radius`.
- `lowSpeedFloor` only shapes the slip channels in telemetry near standstill
  and the point at which a pushed car goes from stiction to sliding.

## Tuning editor

The sandbox has a Tuning panel that lists every parameter of the current
definition with the units from the schema. Edits apply live through
`World.setDefinition`, which replaces the definition while keeping the
car's state, so you can change a spring rate mid-corner and feel it. Reset
returns the preset; copy, download and load move the definition as JSON, so
a tune made in the sandbox goes straight into your own application. Curves
(the engine's torque map, a suspension's `kinematics`) show read-only;
edit them in the JSON and load it back. The
surface selector in the sandbox controls sets the ground under the car from
the [reference table](/concepts/surfaces).
