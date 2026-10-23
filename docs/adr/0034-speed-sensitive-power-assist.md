# ADR-0034: Speed-sensitive power assist

- Status: Proposed
- Date: 2026-10-23
- Supersedes / superseded by: extends the power assist of ADR-0012 and ADR-0029

## Context

The power assist removes the same share of the rack torque at 5 km/h and at
150 km/h. Real electric and variable hydraulic systems give a lot of help
when parking and much less at speed. That is a large part of why a road
car is light in a car park and settled on the motorway, and it is the most
common speed map in EPS calibration.

## Decision

Three steering fields, default 0:

- `powerAssistAtSpeed`: the assist fraction at and above the fade's end,
  in place of `powerAssist`, 0 … 1;
- `powerAssistFadeStart`, `powerAssistFadeEnd`: road speeds, m/s, between
  which the fraction goes linearly from `powerAssist` to
  `powerAssistAtSpeed`. A zero end keeps the assist the same at every
  speed, bit for bit as before.

`VehicleDefinition::power_assist_at(speed)` gives the fraction, and
`hand_wheel_torque_at(kingpin, speed)` uses it in place of `powerAssist` in
the boost curve of ADR-0029. Both models call it with the car's speed at
the end of each substep. The assist acts at the hand wheel only, so the
kingpin torque, the compliance steer behind it, and the state are
unchanged.

The hatchback, crossover, pickup and sports car fade from full assist at
4 m/s to about 60 % of it at 28 m/s [ILLUSTRATIVE].

## Alternatives considered

- A full assist map (assist torque against hand torque and speed, as EPS
  calibration tables are). More faithful, but many parameters with no data
  behind them for these generic cars. The boost curve and one speed fade
  cover the feel.
- Scaling the gain with speed in the force-feedback scaler. It would hide
  what the car does and would not show in telemetry.

## Consequences

- `SteeringTorque` and its slices grow at speed on the four presets. Their
  motion and determinism hashes do not change.
- More torque at speed raises the steering's stiffness in the hands-off
  loop. The harness assertions of ADR-0033 still hold with it.
- `the_assist_fades_with_speed_when_asked` checks the map exactly, and
  `a_fading_assist_weighs_the_wheel_up_at_speed_only` checks the whole car
  (heavier at speed, same parked, same state hash).
