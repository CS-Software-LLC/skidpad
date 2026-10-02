# Why substepping and the chassis proxy matter

Tire forces are stiff: a few millimetres of slip change the force by a large
fraction of the load. Integrating that at 60 Hz either explodes or needs so
much damping that the car feels dead. The core therefore runs 1000 internal
substeps per second for player cars.

Substepping the tire alone is not enough. If the chassis only sees the summed
force once per host step, the tire spends sixteen milliseconds pushing against
a chassis that does not respond, which is the classic source of low-speed
jitter. The core keeps a **proxy** of the chassis velocity state and
integrates it every substep; at the end of the host step it hands the host one
net impulse
([ADR-0002](https://github.com/CS-Software-LLC/skidpad/blob/main/docs/adr/0002-chassis-proxy.md)).

Wheel spin is integrated **implicitly** with respect to the tire's
longitudinal stiffness, so the stiff wheel–tire mode is unconditionally
stable. The drivetrain graph in milestone 4 extends the same idea to the whole
driveline, so a locked differential between two small inertias cannot become a
spring that rings.

The validation runner's timestep sweep (milestone 3) checks that results
converge as rates rise and that nothing goes unstable across the supported
range.
