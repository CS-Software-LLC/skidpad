# Roadmap

Each milestone ends with a playable demo, updated validation and benchmark
pages, a changelog entry, and at least one ADR.

| Milestone                                         | Scope                                                                                                                                                       | Status |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| M0 Foundation                                     | Monorepo, CI with cross-browser determinism, licences and community files, deterministic math module, sandbox, docs, benchmark page                         | Done   |
| M1 Tire lab and bicycle model                     | Feel and Magic Formula tires with `.tir` import, combined slip, load sensitivity, aligning moment, single-track model, tire explorer, understeer validation | Done   |
| M2 Four wheels, suspension, Rapier, chassis proxy | Rapier adapter, independent suspension, load transfer, chassis proxy, R3F sandbox track, telemetry overlay, benchmark baseline                              | Done   |
| M3 Stability and determinism                      | Standstill and slope tests, locked-brake behaviour, timestep sweep, snapshot and hash on the full model, cross-browser test on a real drive                 | Done   |
| M4 Drivetrain                                     | Drivetrain graph with implicit solver, engine, clutch, gearboxes, differentials, AWD, electric motors                                                       | Next   |
| M5 Steering, input, FFB, assists                  | Rack force, wheel calibration, touch, assists layer, WebHID force feedback                                                                                  |        |
| M6 Surfaces, aero, solid axles, tooling           | Surface table, aero, solid axle, tuning editor, validation runner with all manoeuvres, reference vehicles                                                   |        |
| M7 Scale                                          | LOD, batched stepping, worker mode, replays and ghosts, AI helper, Jolt adapter, Babylon example                                                            |        |
| M8 1.0                                            | API freeze, docs complete, performance targets met or revised, format version 1                                                                             |        |

Post-1.0, not committed: tire thermals, wear and pressure; trailers; motorcycles;
tracked vehicles; a rollback netcode example; native bindings.
