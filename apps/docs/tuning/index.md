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

## The car jitters when parked

- It should not. Raise `lowSpeedDamping` (the damping ratio of the
  wheel-tire mode below the speed floor, default 0.3) or `lowSpeedFloor`
  slightly (0.5 to 1.0 m/s), and file an issue with a telemetry export;
  standstill stability is a feature we test.
