# Tuning guide

Symptom first. Each entry names the parameter, where it lives, and why it
helps. Parameters are per tire unless noted.

## Car understeers on entry

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

## Steering feels numb

- Lower `relaxationLengthLat` for a faster lateral response.
- Raise `pneumaticTrail` for more aligning torque at small slip.
- Reduce `steering.ratio` for more road-wheel angle per hand-wheel degree.

## Wheels lock under braking

- Lower `maxBrakeTorque` on the axle that locks, or shift bias toward the
  front where braking load goes. Mean deceleration in the validation table
  tells you when you are at the tire's limit.
- ABS arrives in milestone 5.

## Car feels like it is on ice

- Raise `peakFriction`. Values above 1.2 are beyond road tires; fine for
  arcade.
- Lower `loadSensitivity` so load transfer costs less total grip.

## The car jitters when parked

- It should not. Raise `lowSpeedFloor` slightly (0.5 to 1.0 m/s) and file an
  issue with a telemetry export; standstill stability is a feature we test.
