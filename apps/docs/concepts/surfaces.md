# Surfaces

A surface is what the ground under a wheel does to the tire: a scale on its
friction, a scale on its rolling resistance, and a ploughing drag. The host
tags every wheel contact with a surface id, the world holds a small table
that says what each id means, and the tire models apply the scales inside
their own equations, so the surface is part of the physics, of every replay
and of the state hash
([ADR-0014](https://github.com/CS-Software-LLC/skidpad/blob/main/docs/adr/0014-surface-table.md)).

The table holds at most 16 surfaces. Id 0 is the surface the tire
parameters describe, usually dry asphalt, and an id beyond the table reads
as id 0, so a host may tag its colliders before the application has
described every surface. The default table is the reference surface
everywhere: grip 1, rolling resistance 1, drag 0.

## What the scales do

**Grip** multiplies the tire's peak and sliding friction the way the Magic
Formula's `λμ` does (Pacejka, _Tire and Vehicle Dynamics_, §4.3.2), which is
where that model puts a change of road surface. In the feel model it scales
`peakFriction`; in the Magic Formula model it scales `lmux` and `lmuy`. The
stiffnesses are untouched, so on a slippery surface the force peaks at a
smaller slip, as a tire on ice does: the car reaches the limit sooner and
with less warning, which is the right behaviour and the reason the scale is
not applied to the force as a whole.

**Rolling resistance** scales the tire's rolling-resistance moment. Gravel
and grass roughly double it; ice is a little below asphalt.

**Drag** is the ploughing resistance of a surface the tire sinks into:
gravel, sand, snow. It is quoted in newtons per newton of load and opposes
the velocity of the contact patch in the contact plane. It acts on the
chassis at the contact, not on the wheel, so it slows the car without
changing the wheel's spin or its slip; the tire still rolls freely over
sand, it is the car that is held back. Below the tire's `lowSpeedFloor` the
force fades linearly to zero with speed, the same treatment rolling
resistance gets ([ADR-0005](https://github.com/CS-Software-LLC/skidpad/blob/main/docs/adr/0005-tire-low-speed-handling.md)),
so a car parked on gravel sees a small viscous force and never one that
switches sign.

## Where the id comes from

On the built-in host, `world.setSurface(vehicle, id)` sets the surface of
the flat ground under every wheel of that vehicle; the sandbox's surface
selector calls it.

An external host tags each contact itself: `WheelContact.surfaceId` is the
last field of the record `writeWheelContact` fills in, and defaults to 0.
The Rapier adapter takes a `surfaceId` callback that maps the collider a
wheel ray hit to an id (see [Driving a Rapier body](/guide/rapier#surfaces)).

`world.setSurfaces(list)` replaces the table: entry `i` is surface id `i`.
Each entry is `{ grip, rollingResistance, drag }`, missing fields take the
reference values, and the whole list is validated before anything changes
(grip 0 to 5, drag 0 to 1 N/N).

```ts
import { surfaceTable, surfaceId } from "@skidpad/presets";

world.setSurfaces(surfaceTable());
world.setSurface(car, surfaceId("gravel"));
```

## The reference table

`@skidpad/presets` exports `surfaces`, the table below in id order, with
`surfaceTable()` giving the plain entries for `setSurfaces` and
`surfaceId("snow")` the index of a named surface. Grip is the friction
coefficient of the surface relative to dry asphalt, from the ranges
published for passenger-car tires (J. Y. Wong, _Theory of Ground Vehicles_,
ch. 1; T. D. Gillespie, _Fundamentals of Vehicle Dynamics_, ch. 10).
Rolling-resistance scales follow Wong's coefficients by surface relative to
a hard road. The ploughing drag is an order-of-magnitude figure for the
motion resistance of a tire on a deformable surface (Wong ch. 2), chosen so
a car coasts to a stop on sand in a few car lengths.

| Id  | Name         | Grip | Rolling resistance | Drag (N/N) | Source                                                                                                           |
| --- | ------------ | ---- | ------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| 0   | `asphaltDry` | 1    | 1                  | 0          | The reference surface the tire parameters describe.                                                              |
| 1   | `concrete`   | 0.95 | 0.9                | 0          | Wong ch. 1: peak coefficients on dry concrete a little below dry asphalt; rolling resistance slightly lower.     |
| 2   | `asphaltWet` | 0.65 | 1.1                | 0          | Gillespie ch. 10: wet pavement peak 0.5–0.8 of dry depending on tread depth and speed; the middle of that range. |
| 3   | `cobbles`    | 0.75 | 1.6                | 0          | Wong ch. 1: dry cobbles 0.6–0.8 of asphalt; rolling resistance well above asphalt.                               |
| 4   | `gravel`     | 0.6  | 2                  | 0.02       | Wong ch. 1: loose gravel 0.55–0.65; rolling resistance about twice asphalt; light ploughing.                     |
| 5   | `dirt`       | 0.65 | 1.5                | 0.01       | Wong ch. 1: hard-packed earth road 0.6–0.7 of asphalt.                                                           |
| 6   | `grass`      | 0.45 | 2.5                | 0.03       | Wong ch. 1: dry grass 0.4–0.5; soft ground raises the rolling resistance severalfold.                            |
| 7   | `sand`       | 0.4  | 3                  | 0.12       | Wong ch. 2: the motion resistance of a tire sinking into loose sand is of the order of a tenth of the load.      |
| 8   | `snow`       | 0.3  | 1.5                | 0.04       | Wong ch. 1, Gillespie ch. 10: packed snow 0.2–0.35.                                                              |
| 9   | `ice`        | 0.12 | 0.8                | 0          | Wong ch. 1, Gillespie ch. 10: smooth ice near freezing 0.1–0.15.                                                 |
| 10  | `kerb`       | 0.9  | 1.2                | 0          | Painted concrete kerbing, a little below dry asphalt.                                                            |

The table is a starting point, not a measurement of any particular road.
An application is free to build its own, or to use the ids for its own
materials and leave the entries it does not need at the reference values.

## Telemetry

`SurfaceId_FL` to `SurfaceId_RR` report the id each wheel ran on during the
last substep and `SurfaceGrip_FL` to `SurfaceGrip_RR` the grip scale it
resolved to, which is the quickest way to see whether a host is tagging its
colliders as intended.

## In the validation table

The [validation page](/validation/) repeats the 100–0 km/h stop on wet
asphalt, gravel, snow and ice for every preset, with locked wheels and with
the ABS assist. Braking distance scales roughly with the inverse of the
grip: the hatchback's dry stop of under 50 m becomes about 70 m on wet
asphalt and over 300 m on ice. A car with rear-only
brakes, such as the kart, locks its rear wheels on a slippery surface and
swaps ends; the scenario reports `spun` and the distance it travelled
before coming to rest, and the table shows "spins" for that cell.
