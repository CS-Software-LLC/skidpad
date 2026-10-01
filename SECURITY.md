# Security policy

Skidpad is a simulation library; it does not handle credentials or network
traffic. The realistic security surface is:

- Parsing untrusted vehicle definitions and `.tir` files (denial of service via
  pathological inputs, NaN propagation).
- The experimental WebHID force-feedback package, which talks to USB devices.

## Reporting a vulnerability

Please do not open a public issue for security problems. Email the maintainers
at the address listed on the GitHub organisation profile, or use GitHub's
private vulnerability reporting on this repository. We aim to acknowledge
reports within 72 hours.

## Supported versions

Until 1.0, only the latest 0.x minor release receives fixes.
