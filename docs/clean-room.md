# Clean-room policy

Skidpad is written from published literature only.

- No code, structure, or parameter sets ported or derived from commercial
  vehicle physics packages (Vehicle Physics Pro, UnityCar, Edy's Vehicle
  Physics, or any other). No decompilation of closed-source products.
- Behavioural comparison of outputs (drive the same scenario and compare the
  telemetry) is allowed and encouraged. Record it in `docs/validation/`.
- Physics comes from published sources, cited in code comments and docs:
  - H. B. Pacejka, _Tire and Vehicle Dynamics_, 2nd/3rd ed. (Magic Formula,
    relaxation length, aligning moment).
  - W. F. Milliken and D. L. Milliken, _Race Car Vehicle Dynamics_ (load
    transfer, understeer gradient, friction ellipse).
  - T. D. Gillespie, _Fundamentals of Vehicle Dynamics_ (bicycle model,
    steady-state cornering).
  - R. Rajamani, _Vehicle Dynamics and Control_ (bicycle model derivation).
  - ISO 4138, ISO 7401, ISO 3888 (validation manoeuvres).
  - E. Bakker, L. Nyborg, H. B. Pacejka, "Tyre Modelling for Use in Vehicle
    Dynamics Studies", SAE 870421 (original Magic Formula).
  - J. E. Bernard and C. L. Clover, "Tire Modeling for Low-Speed and
    High-Speed Calculations", SAE 950311 (low-speed relaxation handling).
- Validation data must have a clear licence and a recorded source in
  `data/PROVENANCE.md`.
