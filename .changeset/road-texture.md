---
"@skidpad/core": minor
"@skidpad/presets": minor
"@skidpad/input": minor
---

- physics: road texture (ADR-0036). A surface can carry a `roughness` (ISO 8608 road class, the displacement spectral density at 0.1 cycles/m in 10⁻⁶ m³) and a grid of ridges (`ridgeHeight`, `ridgeSpacing`), all 0 by default. Under a four-wheel car the texture raises the ground under each wheel and its slope pushes the wheel back up a rise, so the road reaches the suspension, the loads and the steering torque: kerbs kick through the rim through the scrub radius and kingpin inclination. Smooth surfaces run bit for bit as before.
- presets: every reference surface has an estimated texture (asphalt class A, gravel class C, kerb ripples 12 mm every 0.5 m, and so on). `surfaceTable()` still returns friction and drag only; `surfaceTable({ texture: true })` adds the texture.
- input: `FfbScaler` takes `detail` (default 1) and `detailCutoff` (default 10 Hz), a gain on the fast part of the torque for stronger road feel without heavier steering.
