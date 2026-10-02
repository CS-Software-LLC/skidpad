# Relaxation length

A tire does not produce its steady-state force the instant slip appears. The
carcass has to deflect, which takes about a third of a metre of rolling: the
**relaxation length**. The core models this as a first-order lag on each slip
quantity with time constant `σ / V`.

Two things follow:

1. Steering feels progressive rather than instant, and the lag grows at low
   speed.
2. At very low speed the time constant goes to infinity, which is right: the
   core integrates the **contact-patch deflection** itself, driven by the
   slip velocity and decaying at the rolling speed
   ([ADR-0010](https://github.com/CS-Software-LLC/skidpad/blob/main/docs/adr/0010-contact-patch-deflection-at-standstill.md)).
   At speed that is the lag above; at standstill it is a spring between the
   contact patch and the road, so a parked car holds a static deflection on
   a slope instead of creeping. A damping term that fades out by
   `lowSpeedDampingFade` keeps that spring from ringing, and the deflection
   is capped at the force peak so a car pushed past its grip slides.

The transient slips (the deflections divided by the relaxation lengths) are
part of the snapshot and appear in telemetry as `SlipRatio_*` and
`SlipAngle_*`.
