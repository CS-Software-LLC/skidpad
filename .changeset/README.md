# Changesets

Every user-visible change gets a changeset (`pnpm changeset`). Breaking changes
are allowed while the packages are 0.x but must be called out in the changeset
text. Changes that alter simulated behaviour must say so in a line beginning
with `physics:` so the release notes can collect them into a "Physics changes"
section and link the validation diff.
