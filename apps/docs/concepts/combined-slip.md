# Combined slip

A tire has one friction budget. Braking in a corner spends some of it
longitudinally, leaving less for lateral force, and vice versa. On a plot of
lateral against longitudinal force the limit is roughly a circle (the
**friction circle**), slightly squashed because the longitudinal peak is
usually higher.

The feel model uses the **resultant slip** method: normalise each slip by its
peak location, combine them into one resultant slip, evaluate each curve at
that resultant, and split the force by direction. The Magic Formula model uses
Pacejka's weighting functions `Gxα` and `Gyκ`.

Both give the behaviour that matters for driving:

- Trail-braking into a corner reduces front grip while the brakes are on,
  then hands it back as the brake releases.
- Spinning the rear wheels under power removes rear lateral grip: power
  oversteer.
- A locked wheel has no lateral grip at all. That is why ABS exists and why the
  core solves brakes as constraints that lock cleanly rather than chattering.

Go back to the [explorer](/concepts/slip) and set a braking slip ratio to see
the lateral curve collapse.
