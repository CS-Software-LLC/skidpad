# @skidpad/chrono-compare

Behavioural comparison of Skidpad against [Project Chrono](https://projectchrono.org)'s
multibody `BMW_E90`. Both simulators drive the same manoeuvres with the same
inputs, and the results are compared metric by metric and trace by trace.
Results and findings: [docs/validation/chrono-bmw-e90.md](../../docs/validation/chrono-bmw-e90.md).

```sh
pnpm compare     # run every manoeuvre, print the tables, write out/
pnpm fit         # refit the anti-roll bars, then compare
pnpm toe-check   # planar four-wheel model with and without Chrono's static toe
pnpm test        # regression guard (CI runs it)
```

## Layout

- `chrono/bmw_e90.py` drives Chrono and writes `reference/`. `chrono/maneuvers.json`
  holds the manoeuvres both harnesses run.
- `reference/` holds Chrono's rows at 100 Hz and its static state. They are
  committed, so nothing here needs Chrono installed.
- `src/chrono-e90.ts` holds the constants from Chrono's source, with the file
  each one comes from.
- `src/tire-fit.ts` carries TMsimple into the Magic Formula.
- `src/geometry.ts` computes roll-centre heights and anti-pitch fractions
  from the hardpoints.
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
```

A manoeuvre added to `chrono/maneuvers.json` runs in both harnesses. Add its
metrics to `src/compare.ts` with a tolerance chosen before the first run.
