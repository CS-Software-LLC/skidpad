# Data provenance

Every data file used for validation or shipped as a preset must be listed here
with its source and licence. Files without an entry are not merged.

| File                                                         | What it is                                               | Source                                                                                                                                                                 | Licence           | Notes                                                               |
| ------------------------------------------------------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------- |
| `crates/skidpad-core/tests/fixtures/synthetic_passenger.tir` | Magic Formula parameter set for a generic passenger tire | Written for this project by hand; coefficients chosen to give a ~1.0 peak friction coefficient at ~7° slip angle and ~12% slip ratio at the nominal load               | MIT OR Apache-2.0 | Synthetic. Not measured data. Do not use for engineering decisions. |
| `packages/presets/src/vehicles/*.json`                       | Reference vehicle definitions                            | Mass, dimensions, and power figures from manufacturer press material and public spec sheets; tire feel parameters tuned to match published skidpad and braking figures | MIT OR Apache-2.0 | Each file carries a `dataSheet` field with its sources.             |

Behavioural comparisons against other simulators (driving the same scenario and
comparing telemetry) are fine and should be recorded in `docs/validation/` with
the scenario, the other simulator's version, and the date.
