## What

<!-- One or two sentences on what changed. -->

## Why

<!-- Link the issue or ADR. -->

## Physics-visible?

- [ ] No simulated behaviour changes.
- [ ] Yes. Golden validation results updated in this PR and the changeset has a `physics:` line.

## Checklist

- [ ] Tests added or updated.
- [ ] Changeset added (`pnpm changeset`) if user-visible.
- [ ] New parameters have schema entries with units and defaults, telemetry channels, and tuning-guide lines.
- [ ] No platform math, hash-map iteration, time, randomness, or allocation inside the step.
- [ ] Sources cited for any physics taken from literature.
