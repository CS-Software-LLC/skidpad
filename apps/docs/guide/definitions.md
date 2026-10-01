# Vehicle definitions

A vehicle is plain JSON described by a published JSON Schema
(`@skidpad/core/schema`). It has a `formatVersion`, and
`migrateDefinition()` brings older files forward. Every field has a default
and SI units; the only non-SI fields end in `Deg`.

## Components

| Component    | What it holds                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `chassis`    | Mass, yaw, roll and pitch inertia, wheelbase, centre-of-mass position and height, track width                                                                      |
| `axles`      | Front then rear. Each has a tire, a `suspension` (with its `kind` and roll-centre height), wheel inertia, `driven`, `steered`, brake torque, static camber and toe |
| `steering`   | Maximum road-wheel angle, steering ratio, Ackermann fraction                                                                                                       |
| `brakes`     | Handbrake torque                                                                                                                                                   |
| `drivetrain` | Power unit (`direct`, `combustion` or `electric`), transmission, axle and centre differentials (ADR-0011)                                                          |
| `aero`       | Drag coefficient, frontal area, air density, lift coefficient per axle, height of the drag line above the centre of mass (ADR-0015)                                |
| `simulation` | Internal substep rate and `model`: `"fourWheel"` (default) or `"singleTrack"`                                                                                      |
| `dataSheet`  | Sources for reference vehicles                                                                                                                                     |

Tire and suspension parameters are quoted **per wheel**. The single-track
model evaluates one tire at half the axle load and doubles the result, so the
same definition drives either model.

## Suspension

Each axle's `suspension` holds the per-wheel spring rate, bump and rebound
damping, bump and droop travel from the static ride height, the anti-roll bar
stiffness, and the bump-stop stiffness. Ride height is `chassis.cgHeight`;
the spring is preloaded to hold it, so changing the spring rate changes
stiffness, not height. See [suspension](/concepts/suspension) for what each
does and the [tuning guide](/tuning/) for which to touch.

Two fields describe the geometry rather than the springs, and only the
four-wheel model reads them. `kind` is `"independent"` (default) or
`"solid"`: a solid axle keeps both wheels upright to the line through their
contacts instead of leaning with the body. `rollCenterHeight` (m, default 0) is the axle's roll-centre height above the ground; the share
`rollCenterHeight / cgHeight` of that axle's lateral load transfer then goes
through the links to the tires instead of rolling the body
([roll centres](/concepts/suspension#roll-centres)). It is accepted within
±1 m.

## Aero

`aero` has the drag coefficient, the frontal area every coefficient is
referenced to, and the air density. `liftCoefficientFront` and
`liftCoefficientRear` (default 0, accepted within ±10) give a lift force at
each axle from the forward speed squared; negative is downforce.
`dragHeightAboveCg` (m, default 0) is how far above the centre of mass the
drag acts, which pitches the nose up at speed. See
[aerodynamics](/concepts/aero).

`validateDefinition()` warns when the static load would compress a spring
beyond its bump travel, which means the car rests on its bump stops.

When you specify an axle, set `driven` and `steered` explicitly. The core
default for both is the front-axle setting, and `validateDefinition()` warns
when either is missing.

## Tires

`tire.model` is `"feel"` or `"magicFormula"`.

The feel model is parameterised by things you can reason about: peak friction,
where the peaks occur, stiffness, falloff after the peak, load sensitivity,
camber stiffness, pneumatic trail. See the
[slip explainer](/concepts/slip) to see what each does.

The Magic Formula model takes lower-cased `.tir` coefficient names. Build one
with `importTir(text)`, which returns the parameters and a list of warnings
for every coefficient outside the supported subset. Sign convention is ISO
8855, the same as `.tir` files: positive slip angle gives negative lateral
force, and `PKY1` is negative.

## Validation

`validateDefinition()` explains problems in plain language
("chassis.cgToFrontAxle must be less than the wheelbase") rather than a
schema path dump, and runs before anything reaches the core.
