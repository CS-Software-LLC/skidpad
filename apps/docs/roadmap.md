# Roadmap

Each milestone ends with a playable demo, updated validation and benchmark
pages, a changelog entry, and at least one ADR.

| Milestone                                         | Scope                                                                                                                                                                                                                                              | Status |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| M0 Foundation                                     | Monorepo, CI with cross-browser determinism, licences and community files, deterministic math module, sandbox, docs, benchmark page                                                                                                                | Done   |
| M1 Tire lab and bicycle model                     | Feel and Magic Formula tires with `.tir` import, combined slip, load sensitivity, aligning moment, single-track model, tire explorer, understeer validation                                                                                        | Done   |
| M2 Four wheels, suspension, Rapier, chassis proxy | Rapier adapter, independent suspension, load transfer, chassis proxy, R3F sandbox track, telemetry overlay, benchmark baseline                                                                                                                     | Done   |
| M3 Stability and determinism                      | Standstill and slope tests, locked-brake behaviour, timestep sweep, snapshot and hash on the full model, cross-browser test on a real drive                                                                                                        | Done   |
| M4 Drivetrain                                     | Drivetrain graph with implicit solver, engine, clutch, gearboxes, differentials, AWD, electric motors                                                                                                                                              | Done   |
| M5 Steering, input, FFB, assists                  | Steering geometry, rack force, jacking; assists layer (ABS, TC, ESC, speed-sensitive steering); input calibration, wheel profiles, touch; force feedback over WebHID in Chromium, Logitech G PRO first (HID++), other wheels as community packages | Done   |
| M6 Surfaces, aero, solid axles, tooling           | Surface table, aero, solid axle, tuning editor, validation runner with all manoeuvres, reference vehicles                                                                                                                                          | Done   |
| M7 Scale                                          | LOD, batched stepping, worker mode, replays and ghosts, AI helper, Jolt adapter, Babylon example                                                                                                                                                   | Next   |
| M8 1.0                                            | API freeze, docs complete, performance targets met or revised, format version 1                                                                                                                                                                    |        |

Post-1.0, not committed: tire thermals, wear and pressure; trailers; motorcycles;
tracked vehicles; a rollback netcode example; native bindings.

Force feedback targets WebHID in Chromium-based browsers: the core produces the
steering torque, the input package delivers it per device, starting with the
Logitech G PRO over HID++ (the G923 and G29 families share the path), with
other makers' protocols as community packages and a torque-to-rumble fallback
for gamepads. An Electron example with `node-hid` is the desktop route.
