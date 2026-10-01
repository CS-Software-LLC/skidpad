# Many cars: level of detail, batched stepping and drivers

Milestone 7 makes a world of dozens to hundreds of cars practical: each car
can drop to a cheaper model or stop costing anything, a world can take many
steps in one call, and the core can drive cars along a path by itself.

## Level of detail

Every vehicle has a level ([ADR-0019](https://github.com/csummers88/skidpad/blob/main/docs/adr/0019-level-of-detail.md)):

| Level         | Model                                                | Cost per car-step (see Benchmarks)     |
| ------------- | ---------------------------------------------------- | -------------------------------------- |
| `full`        | what the definition asks for                         | about 100 µs per car-step              |
| `singleTrack` | the single-track model, whatever the definition says | about 20 µs at 500 Hz, 10 µs at 240 Hz |
| `frozen`      | not stepped                                          | nothing                                |

```ts
world.setLod(car, "singleTrack", 240); // optional substep-rate override, Hz
world.setLod(car, "frozen");
world.setLod(car, "full"); // back to the definition's model and rate
```

Moving between `full` and `singleTrack` rebuilds the car as the other model
and carries its motion across: position, heading, velocity, yaw rate, wheel
speeds, the engine, gear and clutch, and the clock. Going up, the body
starts level at its ride height and settles into its roll and pitch over a
few hundred milliseconds; speed and yaw rate do not jump. A frozen car keeps
its state and ignores its inputs until it is raised again.

`LodController` picks levels by distance with hysteresis, so a car at the
boundary does not flicker between models:

```ts
import { LodController } from "@skidpad/core";

const lod = new LodController(world, { singleTrackBeyond: 60, frozenBeyond: 300, hysteresis: 10 });
lod.pin(playerCar); // always full
// each frame
lod.update((i) => distanceFromCamera(i));
```

A car on an external host (Rapier, Jolt) can be frozen but not reduced: the
single-track model has no host contract. Tell the controller with
`lod.markExternal(i)`.

A snapshot records which model it came from. Restoring a single-track
snapshot into a car at the full level drops it to `singleTrack`, and the
other way round.

## Batched stepping

```ts
world.stepMany(1 / 60, 600); // ten seconds in one call
```

`stepMany` is bit-identical to calling `step` that many times with the
inputs as they stand. It saves the cost of crossing into WASM per step:
use it to run a server ahead, seek a replay, or let a worker catch up.
Path-following drivers update their own inputs on every one of those steps.

## The path-following driver

The core can drive a car along a polyline by itself
([ADR-0020](https://github.com/csummers88/skidpad/blob/main/docs/adr/0020-path-following-driver.md)).
It runs inside the step, so a field of driven cars is deterministic and
costs no calls from JavaScript:

```ts
world.setAi(car, trackCentreline, {
  maxSpeed: 30, // m/s
  lateralAccel: 6, // m/s² the speed profile allows in corners
  brakeDecel: 6,
  lateralOffset: 2, // m left of the path, to run cars side by side
  closed: true, // the last point joins the first
});
world.aiStatus(car); // { distance, laps, lateralError, targetSpeed, finished }
world.clearAi(car); // hand the car back; the inputs keep their last values
```

Steering is pure pursuit on a point about half a second down the path. The
pedals follow a speed profile built when the path is set: each point is
capped at the speed its curvature allows at `lateralAccel`, then braking
into every slower point ahead at `brakeDecel` and accelerating out of every
slower point behind at `driveAccel`. On an open path the car brakes to a
stop at the end.

The driver writes steer, throttle and brake into the car's input record, so
telemetry and replays see exactly what it did. Handbrake, clutch and gear
stay yours. It is a helper, not a racing AI: it does not overtake or avoid
other cars, and it is only as fast as `lateralAccel` lets it be. Keep that
below the car's grip on the surface it drives on.

## Benchmarks

From `pnpm bench` on a Node 22 x64 container, 60 Hz host step, hatchback
preset. This container runs the existing cases about 1.7 times slower than
the machine behind the committed baseline, so compare rows with each other
rather than with the README table:

| Case                                                            | ms per step |
| --------------------------------------------------------------- | ----------- |
| 20 cars, four-wheel at 1 kHz, scripted inputs                   | 1.98        |
| 20 cars, four-wheel at 1 kHz, path-following driver             | 2.11        |
| 200 cars, single-track at 240 Hz, scripted inputs               | 2.08        |
| 200 cars, single-track at 240 Hz, driven, one `stepMany` call   | 2.39        |
| 100 cars, driven: 10 full, 60 single-track at 240 Hz, 30 frozen | 1.87        |

The driver adds about 7 % to a four-wheel car at 1 kHz and about 15 % to a
single-track car at 240 Hz, where the car itself is cheaper. A field of 100
driven cars at mixed levels costs less than 20 full-detail cars.
