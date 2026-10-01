# Slip ratio and slip angle

A tire only produces force while it slips a little. Longitudinal force comes
from **slip ratio**, the difference between how fast the wheel turns and how
fast the ground goes by:

`κ = (ω·R − Vx) / |Vx|`

Positive when driving, negative when braking. Lateral force comes from **slip
angle**, the angle between where the wheel points and where it actually
travels:

`α = atan(Vy / |Vx|)`

Both curves share a shape: a linear region where force is proportional to
slip, a peak, and a falloff to a sliding value. The slope at the origin is the
**stiffness**, the peak height is **peak friction × load**, and the ratio of
the sliding value to the peak is the **falloff**.

Sign convention is ISO 8855: positive slip angle means the contact patch
moves toward the left, and the tire pushes back to the right, so the lateral
force is negative. The explorer plots `−Fy` so the curve reads upward.

## Explore

Drag the load and watch the peak move but the curve _flatten_ relative to load:
that is load sensitivity, and it is why load transfer changes a car's balance.
Add camber to see the lateral curve shift. Add braking slip to see the lateral
curve collapse: that is [combined slip](/concepts/combined-slip).

<ClientOnly><TireExplorer /></ClientOnly>

The explorer runs the real core, so what you see is what the car feels.

## Sources

Pacejka, _Tire and Vehicle Dynamics_, ch. 1–4. Milliken & Milliken, _Race
Car Vehicle Dynamics_, ch. 2.
