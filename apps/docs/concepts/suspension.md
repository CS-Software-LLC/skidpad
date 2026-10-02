# Suspension and the four-wheel model

The default vehicle model has four wheels, each on its own strut, over a
chassis that is free to heave, pitch and roll; an axle may also be declared
a solid beam, below. It is the model the sandbox
drives and the one an external physics engine hosts; the
[single-track model](/concepts/load-transfer#understeer-gradient) remains
available as `simulation.model: "singleTrack"` for traffic and as the
analytic cross-check.

## A strut per corner

Each corner is a ray from the top of its travel straight down the body's
vertical axis. Where the ray meets the ground sets the compression, measured
from the static ride position: positive is bump (compressed), negative is
droop (extended). From that come four forces, all per wheel:

- **Spring**, `springRate × (static compression + travel)`. The static
  compression is the corner's static load over its spring rate, so the car
  always sits at `chassis.cgHeight` at rest and the spring rate only changes
  how stiffly it moves from there.
- **Damper**, `bumpDamping` or `reboundDamping` times the compression rate,
  depending on its sign. Rebound is usually the stiffer of the two.
- **Anti-roll bar**, `antiRollStiffness` times the difference between this
  wheel's travel and the other wheel's on the same axle. It only acts when
  the two sides move differently, which is why it adds roll stiffness
  without adding ride stiffness.
- **Bump stop**, `bumpStopStiffness` times the travel beyond `travelBump`.

The sum, never negative because the ground cannot pull, is the strut force.
Its component along the contact normal is the tire's vertical load, which is
what the [tire model](/concepts/slip) sees.

There is no unsprung mass: the wheel is massless and rigid. The only vertical
modes are the body's own, at a few hertz, so the model stays stable at every
substep rate the core supports. Wheel hop and kerb strikes arrive with an
unsprung-mass option later ([ADR-0009](https://github.com/CS-Software-LLC/skidpad/blob/main/docs/adr/0009-raycast-suspension-and-host-contract.md)).

## What the body does

Tire forces act at the contact patches, at ground level, while the mass sits
`cgHeight` above them. Braking therefore pitches the nose down (dive),
accelerating pitches it up (squat), and cornering rolls the body toward the
outside of the turn. The telemetry channels `Roll`, `Pitch`, `PosZ`, the
rates, and the per-wheel `SuspTravel_*` and `SuspForce_*` channels show it.

Ride frequency is a useful handle: `f = √(k / m_corner) / 2π` with the
corner's share of the mass. Road cars sit around 1.2 to 1.6 Hz, sports cars
near 2 Hz, racing cars higher. The presets carry their ride frequencies in
their data sheets.

## Ackermann steering

With two steered wheels the inner wheel must steer more than the outer one
to roll about the same centre; otherwise the front tires fight each other
at parking speeds. `steering.ackermann` interpolates between parallel steer
(0) and ideal Ackermann (1). The per-wheel angles are the `WheelSteer_*`
channels.

## Camber

`staticCamberDeg` is quoted the way alignment sheets quote it: negative leans
the top of each wheel toward the centreline. On an independent axle body
roll adds to it at the contact; `Camber_*` reports the resulting inclination
in the tire's sign convention. A solid axle behaves differently, below.

## Toe

`staticToeDeg` is the toe of each wheel, also as alignment sheets quote it:
positive is toe-in, each wheel pointing toward the centreline ahead of it,
and negative is toe-out. It adds to the steering angle of each wheel, so
`WheelSteer_*` includes it and `SteerAngle` does not. Driving straight, a
toed-in axle runs both tires at a small slip angle whose lateral forces
cancel, leaving some drag. In a corner the loaded outer tire is already
turned into the turn and the unloaded inner one away from it, so toe-in
gains grip as the load transfers. Before that transfer arrives, each tire
works partway up its curve, where it is less stiff, so a toed-in car answers
the wheel later and overshoots less. Toe-out does the opposite. Road cars
run a few tenths of a degree. The single-track model ignores toe because
its two mirrored forces cancel.

## Roll centres

A strut that is a ray down the body's vertical axis puts the roll centre on
the ground: every bit of the lateral load transfer goes through the springs
and bars, so the body must roll for the outer tire to gain load. On a real
car the suspension links carry part of the transfer straight to the ground.
Milliken & Milliken (_Race Car Vehicle Dynamics_, ch. 17 and 18) describe
that part by the axle's roll-centre height: of the axle's lateral transfer
`F_y · h_cg / t`, the share `h_rc / h_cg` is **geometric**, `F_y · h_rc / t`,
and only the rest rolls the body on its springs
([ADR-0016](https://github.com/CS-Software-LLC/skidpad/blob/main/docs/adr/0016-solid-axles-and-roll-centres.md)).

`suspension.rollCenterHeight` is that height above the ground at ride
height, per axle. Each substep the model takes the axle's lateral tire
force from the previous substep (the lag keeps the load–force loop
explicit; its gain, `h_rc / t` times the load sensitivity, is far below
one), and applies `F_y · h_rc / t` as a couple on the body through the two
contacts: load onto the outer wheel, off the inner one, with no spring
travel involved. The previous force is part of the snapshot, so a replay
is exact. The default of zero is the plain raycast strut.

What it does to the car: for the same cornering force the body rolls less,
and the load reaches the outer tire as soon as the force builds instead of
after the body has rolled over onto it, which is a quicker response. The
axle with the higher roll centre also takes a larger share of the total
transfer, as it would with a stiffer bar, but without the extra roll
stiffness. The road-car presets sit at 0.05 to 0.13 m, lower at the front
than the rear as most road cars are; the open-wheeler at a few centimetres;
the pickup's leaf-sprung rear at 0.4 m, near the spring-seat height. The
`GeometricTransfer_F` and `GeometricTransfer_R` channels report the geometric
part in newtons.

## Anti-dive and anti-squat

The same idea applies in side view. Braking or driving moves load from one
axle to the other, `F_x · h_cg / L` in all. With the plain raycast strut
every bit of it goes through the springs, so the nose dives under braking
and squats or lifts under power. Inclined links carry part of it straight
to the tires instead (Milliken & Milliken ch. 17; Gillespie, _Fundamentals
of Vehicle Dynamics_, ch. 9). Each axle has two fractions on its
`suspension`
([ADR-0018](https://github.com/CS-Software-LLC/skidpad/blob/main/docs/adr/0018-anti-dive-and-anti-squat.md)):

- `antiBrake` for that axle's braking force: anti-dive at the front,
  anti-lift at the rear.
- `antiDrive` for its driving force: anti-squat on a driven rear axle,
  anti-lift on a driven front one.

Each is `tan θ · L / h_cg`, with `θ` the side-view angle of the line from
the contact patch (outboard brakes) or the wheel centre (inboard brakes,
and drive through half-shafts) to the side-view instant centre. The model
applies `anti · F_x · h_cg / L` of the axle's longitudinal force from the
previous substep as a vertical force between the body and that axle's
tires: under braking it lifts the nose at the front and holds the tail down
at the rear. The tires carry the same loads either way, since the
deceleration fixes the transfer; only the body's pitch changes. Negative
values are pro-dive and pro-lift, which some strut fronts have.

Alignment sheets often quote "percent anti-dive" with the brake balance
folded in: Gillespie's `%AD = tan θ · L / h · (front braking share)`. To
convert, divide that percentage by the axle's share of the braking. A front
axle braking 65 % of the car with 30 % anti-dive therefore has
`antiBrake` 0.46. The default of zero is the plain strut, and the
`PitchLinkLoad_F` and `PitchLinkLoad_R` channels report the link force in
newtons, positive up. The single-track model has no pitch and ignores both.

## Track width per axle

`chassis.trackWidth` sets both axles' track unless an axle sets its own
`trackWidth`. The wheels, the roll-centre transfer and the Ackermann
geometry all use the axle's own track; most cars run a slightly wider
track at one end.

## Solid axles

`suspension.kind` is `"independent"` (the default) or `"solid"`. On an
independent axle each wheel stands on the body: when the body rolls the
wheels lean with it, and the outer tire runs at positive camber on top of
whatever static camber it was given. On a solid axle the wheels stand on
the beam, which is the line through the axle's two contact points: whatever
the body does, the wheels stay upright to the road, and a one-wheel bump
tilts both wheels together. If a wheel is off the ground the axle has no
beam to stand on and the wheel falls back to the body's axis.

Only the camber geometry changes. The springs, dampers, anti-roll bar and
travel are still those of the two corner struts, so the beam has no mass of
its own (there is no unsprung mass in the model) and the axle's roll
stiffness is set the same way as an independent one. Pair it with a
`rollCenterHeight` for the geometry of a real beam axle: a leaf-sprung or
four-link rear sits its roll centre high, which is why trucks and older
rear-drive cars take so much of their transfer at the back.

The `kart` preset has a solid rear axle with the roll centre on the ground:
a kart has no suspension, so the corner springs are very stiff and the rear
tires stay square to the track while the frame rolls on tire compliance;
the same axle is a spool in the [drivetrain](/concepts/drivetrain). The
`pickup4x4` preset has an independent front with a 0.1 m roll centre and a
solid rear with 0.4 m, which with its high centre of mass is most of what
makes it drive like a truck.
