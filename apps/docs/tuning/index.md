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

- The driven axle loses lateral grip while it spins; lower
  `drive.maxWheelTorque` or raise the rear `peakSlipRatio` so the force peak
  sits at a larger slip.
- Raise the rear `falloffLong` so the tire keeps more grip past the peak.
- Traction control arrives with the assists in milestone 5.

## Body rolls or pitches too much

- Raise `springRate` on both axles together to keep the balance, or raise
  `antiRollStiffness` to add roll stiffness without stiffening the ride.
- Raise `chassis.rollInertia` or `pitchInertia` to slow the motion rather
  than reduce it.
- Lower `chassis.cgHeight`: both transfers scale with it.

## Car bounces after a bump or a landing

- Raise `bumpDamping` and `reboundDamping`. A damping ratio near 0.3 of
  critical (`c = 2 · 0.3 · √(k · m_corner)`) is a road-car starting point;
  rebound a third higher than bump.
- Check `travelBump`: if the car sits on its bump stops at rest,
  `validateDefinition()` warns about it.

## Inner front wheel spins out of corners

- That is an open differential doing what it does under power with the
  inner wheel unloaded. A limited-slip differential arrives with the
  drivetrain graph in milestone 4; until then lower `drive.maxWheelTorque`
  or raise the front `antiRollStiffness` a little less.

## Steering feels numb

- Lower `relaxationLengthLat` for a faster lateral response.
- Raise `pneumaticTrail` for more aligning torque at small slip.
- Reduce `steering.ratio` for more road-wheel angle per hand-wheel degree.

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
- ABS arrives in milestone 5.

## Car feels like it is on ice

- Raise `peakFriction`. Values above 1.2 are beyond road tires; fine for
  arcade.
- Lower `loadSensitivity` so load transfer costs less total grip.

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
