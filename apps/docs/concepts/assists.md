# Driving assists

The assists sit on top of the same physics and run inside the core, so a
replay reproduces them and a hash sees them
([ADR-0013](https://github.com/CS-Software-LLC/skidpad/blob/main/docs/adr/0013-assists-layer.md)).
They are all off in the core's default definition; a preset may switch some
on (the RWD sports car ships with ABS, traction and stability control, the
electric crossover with traction control). Each is a stateless stage between the input
and the wheel solve: every substep it reads the current slips, speed and yaw
rate and scales this substep's brake capacities, throttle and steer angle.

| Assist             | Reads                           | Acts on                                  | Telemetry                         |
| ------------------ | ------------------------------- | ---------------------------------------- | --------------------------------- |
| `abs`              | each wheel's braking slip ratio | that wheel's brake capacity (never to 0) | `AbsActivity`                     |
| `tractionControl`  | the largest driven drive slip   | the throttle to the power unit           | `TcActivity`, `ThrottleEffective` |
| `stabilityControl` | yaw rate against neutral steer  | one wheel's brake, the throttle          | `EscYawError`, `EscBrakeTorque`   |
| `steeringAssist`   | speed                           | the road-wheel angle                     | `SteerAssistScale`                |

**ABS** scales a wheel's brake capacity from 1 at the slip target (the tire's
peak, 0.12 by default) down to a floor at the release slip (0.3), and stands
down below 2 m/s so the car can lock its wheels to a stop. It is an ideal,
continuous ABS without the cycling of a production system; the validation
page reports the stopping distance with and without it.

**Traction control** uses the same shape on the largest driven-wheel drive
slip to scale the throttle. It governs the launch; the inertia a clutch
dumps into the wheels on an upshift is the transmission's business, and the
automatic lifts the throttle during the shift for that reason.

**Stability control** compares the yaw rate with the neutral-steer
reference `V · tan δ / L`, capped at what the tires' friction allows, and
past a dead band brakes the outer front wheel when the car yaws faster than
the reference (oversteer) or the inner rear when slower (understeer), with a
torque proportional to the error, and cuts the throttle. The brake goes
through the ordinary bounded constraint, so the wheel can still lock exactly.

**The steering assist** caps the road-wheel angle at `L · a_lim / V²`, the
angle a steady turn at the chosen lateral acceleration needs, so a keyboard
gets full lock at walking pace and a few degrees at speed. The sandbox turns
it on for keyboard driving.
