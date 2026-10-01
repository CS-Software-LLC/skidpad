# Vehicle definitions

A vehicle is plain JSON described by a published JSON Schema
(`@skidpad/core/schema`). It has a `formatVersion`, and
`migrateDefinition()` brings older files forward. Every field has a default
and SI units; the only non-SI fields end in `Deg`.

## Components

| Component    | What it holds                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------- |
| `chassis`    | Mass, yaw inertia, wheelbase, centre-of-mass position and height, track width                     |
| `axles`      | Front then rear. Each has a tire, wheel inertia, `driven`, `steered`, brake torque, static camber |
| `steering`   | Maximum road-wheel angle and steering ratio                                                       |
| `brakes`     | Handbrake torque                                                                                  |
| `drive`      | Interim drive model: wheel torque and fade speed, until the drivetrain graph lands                |
| `aero`       | Drag coefficient, frontal area, air density                                                       |
| `simulation` | Internal substep rate                                                                             |
| `dataSheet`  | Sources for reference vehicles                                                                    |

Tire parameters are quoted **per tire**. The single-track model evaluates one
tire at half the axle load and doubles the result, so the same definition
drives the four-wheel model later without changes.

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
