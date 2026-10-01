---
layout: home
hero:
  name: Skidpad
  text: Deterministic, sim-grade vehicle physics for the web.
  tagline: Slip-based tires, an implicit drivetrain, and bit-exact results on every browser. Built in public, from the literature.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Try the sandbox
      link: https://github.com/csummers88/skidpad#sandbox
features:
  - title: Sim-grade tires
    details: Feel model for tuning by intuition, Magic Formula 5.2 subset with .tir import, combined slip, load sensitivity, relaxation length, aligning torque.
  - title: Deterministic by construction
    details: Rust core compiled to WebAssembly with a vendored software math module. Same inputs, same bits, in Chrome, Firefox, Safari, and Node.
  - title: Validated, not vibed
    details: ISO-style manoeuvres run in CI against golden results, and the understeer gradient is checked against linear theory.
  - title: Observable
    details: Every value that influences the simulation is a telemetry channel, exportable as CSV and JSON with iRacing-style names.
---
