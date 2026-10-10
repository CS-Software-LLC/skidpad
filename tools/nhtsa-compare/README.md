# @skidpad/nhtsa-compare

Skidpad against instrumented tests of a real car: the 1997 Jeep Cherokee Sport that NHTSA's
Vehicle Research and Test Center drove for the National Advanced Driving Simulator, as published
in SAE 2000-01-0700. Results and findings:
[docs/validation/nhtsa-jeep-cherokee.md](../../docs/validation/nhtsa-jeep-cherokee.md).

```sh
pnpm compare             # the estimated build: run every manoeuvre, print the tables, write out/estimated/
pnpm fit                 # fit three unknowns on the slowly increasing steer, then compare: out/fitted/
pnpm fit --compliance    # the same with a compliance per m/s² at the published ratio: out/fitted-compliance/
pnpm compare --body-fixed-ay  # compare Skidpad's body-fixed LatAccel as it is (the first run's comparison)
pnpm compare --measured  # the measured metrics only
pnpm test                # regression guards (CI runs them)
```

## Layout

- `reference/jeep_cherokee/` holds the measured traces, one CSV per manoeuvre, channel and
  series (`exp` measured mean, `front`/`rear` roll, `nads` the paper's own simulation), in the
  paper's SAE axes and time base. They are committed, so nothing here needs the paper.
- `digitise/digitise.py` wrote them: it reads each curve's polyline straight out of the PDF's
  vector plots and calibrates each axis from its tick marks. `digitise/figures.json` says which
  plot and stroke is which file. To regenerate (needs `pdfplumber`):
  `python3 -I digitise/digitise.py <jeep_valid.pdf> reference/jeep_cherokee`, or `--list` to
  see every plot it finds.
- `src/jeep.ts` is the car, each value with its published source or marked ESTIMATE.
- `src/run.ts` drives it with the measured hand-wheel angle at the test's speed.
- `src/compare.ts` holds the metrics and the tolerances set before the first run.
- `src/fit.ts` fits the steering ratio (or, with `--compliance`, a compliance per m/s² of lateral
  acceleration), front anti-roll bar and tire peak friction on the slowly increasing steer only.
