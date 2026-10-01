# Relaxation length

A tire does not produce its steady-state force the instant slip appears. The
carcass has to deflect, which takes about a third of a metre of rolling: the
**relaxation length**. The core models this as a first-order lag on each slip
quantity with time constant `σ / V`.

Two things follow:

1. Steering feels progressive rather than instant, and the lag grows at low
   speed.
2. At very low speed the time constant would go to infinity and the slip
   definition would divide by zero. The core floors the speed used in both
   ([ADR-0005](https://github.com/csummers88/skidpad/blob/main/docs/adr/0005-tire-low-speed-handling.md)),
   so a parked car behaves like a spring between the contact patch and the
   road instead of a limit cycle. That is what makes standstill stable.

The transient slips are part of the snapshot and appear in telemetry as
`SlipRatio_*` and `SlipAngle_*`.
