# @skidpad/chrono-compare

Behavioural comparison of Skidpad against two of [Project Chrono](https://projectchrono.org)'s
multibody cars: the `BMW_E90` and the `Sedan`. Both simulators drive the same manoeuvres with
the same inputs, and the results are compared metric by metric and trace by trace.
Results and findings: [docs/validation/chrono-bmw-e90.md](../../docs/validation/chrono-bmw-e90.md)
and [docs/validation/chrono-sedan.md](../../docs/validation/chrono-sedan.md).

```sh
pnpm compare     # the E90: run every manoeuvre, print the tables, write out/bmw_e90/
pnpm fit         # refit the E90's anti-roll bars, then compare
pnpm toe-check   # planar four-wheel model with and without Chrono's static toe
pnpm compare --fixed-geometry   # without travel curves (the E90 before ADR-0026)
pnpm compare --toe-curve        # with the toe curves as well (see the reports)
pnpm compare:sedan              # the Sedan (pnpm compare --car sedan); takes the same flags but --fit
pnpm test        # both cars' regression guards (CI runs them)
```

## Layout

- `chrono/common.py` drives Chrono; `chrono/bmw_e90.py` describes the car and writes
  `reference/bmw_e90/`. `chrono/maneuvers.json` holds the manoeuvres both harnesses run.
- `chrono/kc.py bmw_e90` holds the parked car's chassis and moves it in heave and
  roll, as a kinematics-and-compliance rig does, and writes `reference/bmw_e90/kc.csv`:
  each wheel's travel, toe and camber.
- `chrono/sedan.py` describes the Sedan and writes `reference/sedan/`; `chrono/kc.py sedan`
  sweeps it, also logging each spindle's position and the spring and damper lengths.
- `chrono/equilibrium.py <car>` measures each car's ride height at its true static equilibrium,
  tires off the ground and each spindle pushed up by its static load, and writes
  `reference/<car>/equilibrium.json`. The travel curves are read from there: a parked car rests
  where its tires' static friction propped it.
- `reference/<car>/` holds Chrono's rows at 100 Hz and its static state. They are
  committed, so nothing here needs Chrono installed.
- `src/chrono-e90.ts` holds the constants from Chrono's source, with the file
  each one comes from.
- `src/tire-fit.ts` carries TMsimple into the Magic Formula.
- `src/geometry.ts` computes roll-centre heights and anti-pitch fractions
  from the hardpoints.
- `src/kinematics.ts` builds the travel curves (ADR-0026): toe and camber from
  `reference/bmw_e90/kc.csv`, roll-centre height and anti fraction from `geometry.ts`
  swept over travel. It also solves each upright's 3D pose from the
  hardpoints, kept as a cross-check.
- `src/vehicle.ts` builds the Skidpad definition and lists the structural
  differences between the models.
- `src/run.ts` is the Skidpad harness.
- `src/compare.ts` holds the metrics and their tolerances.
- `src/fit.ts` fits the E90's anti-roll bars, the only parameters taken from
  Chrono's behaviour.
- `src/chrono-sedan.ts`, `src/pac02.ts`, `src/sedan-kc.ts` and `src/sedan.ts` are the Sedan's
  constants, its tire as Chrono computes it and the fit carrying it into Skidpad, its geometry
  from the kinematics sweep, and its Skidpad definition. Nothing is fitted to its behaviour.

## Regenerating the reference

The Chrono environment takes about 8 GB and a run about 3 minutes:

```sh
micromamba create -p /opt/mm/chrono -c projectchrono -c conda-forge python=3.12 pychrono=9.0.1 numpy
/opt/mm/chrono/bin/python tools/chrono-compare/chrono/bmw_e90.py            # all manoeuvres
/opt/mm/chrono/bin/python tools/chrono-compare/chrono/bmw_e90.py stepSteer  # one
/opt/mm/chrono/bin/python tools/chrono-compare/chrono/kc.py bmw_e90      # kinematics sweep
/opt/mm/chrono/bin/python tools/chrono-compare/chrono/sedan.py           # the Sedan
/opt/mm/chrono/bin/python tools/chrono-compare/chrono/kc.py sedan
/opt/mm/chrono/bin/python tools/chrono-compare/chrono/equilibrium.py bmw_e90   # after each car's run
/opt/mm/chrono/bin/python tools/chrono-compare/chrono/equilibrium.py sedan
```

A manoeuvre added to `chrono/maneuvers.json` runs in both harnesses, for both cars. Add its
metrics to `src/compare.ts` with a tolerance chosen before the first run.
