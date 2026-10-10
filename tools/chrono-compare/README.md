# @skidpad/chrono-compare

Behavioural comparison of Skidpad against [Project Chrono](https://projectchrono.org)'s
multibody `BMW_E90`. Both simulators drive the same manoeuvres with the same
inputs, and the results are compared metric by metric and trace by trace.
Results and findings: [docs/validation/chrono-bmw-e90.md](../../docs/validation/chrono-bmw-e90.md).

```sh
pnpm compare     # run every manoeuvre, print the tables, write out/
pnpm fit         # refit the anti-roll bars, then compare
pnpm toe-check   # planar four-wheel model with and without Chrono's static toe
pnpm compare --fixed-geometry   # the car before ADR-0026, without travel curves
pnpm compare --toe-curve        # with the toe curves as well (see the report)
pnpm test        # regression guard (CI runs it)
```

## Layout

- `chrono/common.py` drives Chrono; `chrono/bmw_e90.py` describes the car and writes
  `reference/bmw_e90/`. `chrono/maneuvers.json` holds the manoeuvres both harnesses run.
- `chrono/kc.py bmw_e90` holds the parked car's chassis and moves it in heave and
  roll, as a kinematics-and-compliance rig does, and writes `reference/bmw_e90/kc.csv`:
  each wheel's travel, toe and camber.
- `reference/bmw_e90/` holds Chrono's rows at 100 Hz and its static state. They are
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
- `src/fit.ts` fits the anti-roll bars, the only parameters taken from
  Chrono's behaviour.

## Regenerating the reference

The Chrono environment takes about 8 GB and a run about 3 minutes:

```sh
micromamba create -p /opt/mm/chrono -c projectchrono -c conda-forge python=3.12 pychrono=9.0.1 numpy
/opt/mm/chrono/bin/python tools/chrono-compare/chrono/bmw_e90.py            # all manoeuvres
/opt/mm/chrono/bin/python tools/chrono-compare/chrono/bmw_e90.py stepSteer  # one
/opt/mm/chrono/bin/python tools/chrono-compare/chrono/kc.py bmw_e90      # kinematics sweep
```

A manoeuvre added to `chrono/maneuvers.json` runs in both harnesses. Add its
metrics to `src/compare.ts` with a tolerance chosen before the first run.
