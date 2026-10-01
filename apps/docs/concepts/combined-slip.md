# Combined slip

A tire has one friction budget. Braking in a corner spends some of it
longitudinally, leaving less for lateral force, and vice versa. On a plot of
lateral against longitudinal force the limit is roughly a circle (the
**friction circle**), slightly squashed because the longitudinal peak is
usually higher.

The feel model uses the **resultant slip** method on the brush model's
_theoretical_ slips, `σx = κ / (1 + κ)` and `σy = tan α / (1 + κ)`: normalise
each by its peak location, combine them into one resultant slip, evaluate
each curve at that resultant, and split the force by direction. The `1 + κ`
denominator is what makes braking and driving differ: a braked tire
(`κ < 0`) is further along its curves than a driven one at the same slip, so
it reaches its lateral peak at a smaller slip angle and falls off sooner past
the limit. The Magic Formula model uses Pacejka's weighting functions `Gxα`
and `Gyκ`.

Both give the behaviour that matters for driving:

- Trail-braking into a corner reduces front grip while the brakes are on,
  then hands it back as the brake releases.
- Spinning the rear wheels under power removes rear lateral grip: power
  oversteer.
- A locked wheel has no lateral grip at all. That is why ABS exists and why the
  core solves brakes as constraints that lock cleanly rather than chattering.

Go back to the [explorer](/concepts/slip) and set a braking slip ratio to see
the lateral curve collapse.
