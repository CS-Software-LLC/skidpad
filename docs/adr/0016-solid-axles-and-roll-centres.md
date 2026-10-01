# ADR-0016: Solid axles and roll-centre heights on the raycast suspension

- Status: Accepted
- Date: 2026-10-01
- Supersedes / superseded by: none; amends ADR-0009 (raycast suspension)

## Context

The raycast strut of ADR-0009 puts the roll centre of every axle on the
ground: the only path for a lateral tire force into the body is the contact
patch, so the whole lateral load transfer rolls the body on its springs and
anti-roll bars. Real suspensions have a roll centre somewhere above the
ground, and the share of the transfer below it goes through the links
without rolling the body (Milliken & Milliken, _Race Car Vehicle Dynamics_,
ch. 17 and 18). A solid beam axle has two further properties the strut
cannot show: its wheels stay upright to the road while the body rolls,
and its roll centre sits high, at the Panhard rod or spring seats. The kart
preset has carried a "solid rear axle arrives in milestone 6" note since
milestone 2, and the pickup preset needs one.

Constraints: stay on the raycast model (no unsprung mass, no new stiff
modes); stable at every substep rate; defaults reproduce the old physics
exactly; the total lateral load transfer must stay `m · a_y · h / t`, only
its path changes; the snapshot and determinism contract must hold.

## Decision

**Roll-centre height per axle, as a geometric couple through the contacts.**
`suspension.rollCenterHeight` is the height of the axle's roll centre above
the ground at ride height, metres. Each substep the axle's lateral tire force
`F_y` from the previous substep moves `F_y · h_rc / t` of load from the inner
wheel to the outer one directly, as a couple applied to the body through the
two contact normals, and the tire loads see it before the tire forces are
evaluated. The body then rolls only under `F_y (h_cg − h_rc)`, the elastic
part, and the springs and bars split that between the axles as before. The
sum over both axles of the outer-minus-inner load difference is unchanged at
`2 m a_y h_cg / t`; the axle with the higher roll centre takes a larger share
of it, which is the handling lever Milliken describes. The previous-substep
lateral force is state and goes into the snapshot (two values; snapshot
format version 3). Its loop gain, `h_rc / t` times the load sensitivity, is
far below one, so the lag is harmless at any substep rate. Telemetry reports
`GeometricTransfer_F` and `GeometricTransfer_R`.

**Solid axles keep their wheels on the beam.** `suspension.kind: "solid"`
tells the four-wheel model that the two wheels are the ends of a rigid beam.
The strut at each end still finds the ground, compresses the spring, and
carries the damper, bar and bump stop as before (a beam on two springs is
still two springs); what changes is the wheel plane. An independent wheel's
lateral axis is the body's, so the wheel leans with the body and its camber
to the road is the roll angle; a beam's wheels take their lateral axis from
the line through the axle's two contact points, rotated about the contact
normal by the steer angle for a steered beam. On flat ground that line lies
in the road, so the wheels stay square to it whatever the body does, and
static camber is kept relative to the beam. When only one wheel of a solid
axle touches the ground the axle falls back to the body's axis. A high roll
centre is set separately with `rollCenterHeight`, since a solid axle's roll
centre depends on how it is located (Panhard rod, Watt's link, leaf springs)
rather than on being solid.

## Alternatives considered

- **A real beam body with its own mass and roll freedom.** The right
  long-term answer for axle tramp and wheel hop, and the reason ADR-0009
  left an unsprung-mass option open. It adds a stiff mode per axle that the
  supported substep rates would not all survive; not for this milestone.
- **Roll centre by moving the lateral force's application point** up to
  `h_rc` on the body. Equivalent as a body moment, but then the geometric
  share never reaches the tire loads, which is the half of the effect that
  changes handling. Applying it as a couple through the contacts gives both.
- **Camber compliance from the beam's tilt on a one-wheel bump.** Comes for
  free: the contact line tilts, both wheels camber the same way in the body
  frame, which is what a beam does over a bump.
- **Tying the two wheels' travel** so one wheel's bump is the other's
  droop. With massless wheels on rays the beam is already the line between
  the two ground hits; the springs measure the body's distance from it at
  each end. Nothing to add.

## Consequences

- Defaults (`independent`, roll centre 0) reproduce the old physics exactly;
  the axle tests assert it.
- The presets get published roll-centre values (a MacPherson front near
  80 mm, a multilink rear near 100 to 130 mm, a leaf-sprung solid rear near
  400 mm), which reduces their roll angles and moves the skidpad gradients
  by a few hundredths of a degree per g; the kart's rear is a solid axle,
  as its data sheet promised; the pickup's rear is a solid axle with a high
  roll centre.
- The snapshot grows by two values and its format version is 3.
- Guarded by tests: roll centres cut the body roll by a quarter or more
  while the total outer-minus-inner load difference stays within a few
  percent of `2 m a_y h / t`, with the higher-roll-centre axle taking the
  larger share; a solid axle's wheels show near-zero camber to the road
  while the independent front leans with the body; static camber on a solid
  axle is kept; a car with roll centres still parks on a cross slope; the
  lagged state round-trips through a snapshot and continues bit-identically;
  out-of-range heights are rejected.
