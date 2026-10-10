# Friction log

Problems and good surprises found while building Skidpad Time Trial on the
published `@skidpad` packages. Newest entries first. See `KICKOFF.md` for the
entry format.

## Summary

Built over phases 1 to 7 (ranked track and laps, input breadth, ghosts and
replays, server leaderboard, free roam on Rapier, sound, settings and a
production build) on `@skidpad/*` 0.7.0, the latest release throughout.
Thirty problems (F-01 to F-30), one experiment (E-01) and twelve good
surprises (G-01 to G-12) are logged below. They group into these issues,
most severe first, each ready to file against the Skidpad repo.

### Issues to file

**Blockers**

1. **`@skidpad/worker`: the documented `import "@skidpad/worker/entry"` is
   tree-shaken out of production builds.** The package declares
   `"sideEffects": false`; the worker chunk comes out empty and
   `WorkerWorld.create` never resolves, silently. Fix:
   `"sideEffects": ["./dist/entry.js"]`. [F-28]
2. **`@skidpad/input`: the Logitech WebHID sink can report `connected` and
   send no force.** It defaults to HID++ for every wheel (wrong for a G29),
   does not pick the protocol from the product id, fixes its torque scale
   at construction, and does not surface a missing force-feedback feature.
   [F-14]

**Annoying**

3. **Docs: no READMEs in any npm package, and no bundling guidance.** The
   JSDoc carried everything; bundling the core into a Node server breaks
   its WASM path without a word in the docs. [F-01, F-29]
4. **`@skidpad/replay`: `ReplayPlayer` cannot follow game logic on the
   host.** Surface changes become keyframe desyncs, so verification and
   seeking both had to be rebuilt on the game's own sim. A
   `beforeStep(step, world)` hook (or recording host changes) would fix
   both. [F-02, F-19]
5. **`@skidpad/core`: the built-in host takes one surface per vehicle, not
   per wheel.** [F-03]
6. **Version identity: nothing says which core build produced a replay.**
   `Skidpad.version` is `"0.1.0"` in 0.7.0 and `package.json` is not in
   `exports`. [F-05, F-21]
7. **`@skidpad/input`: devices do not compose.** Each has its own gear
   counter with undocumented automatic-gearbox semantics, `GamepadInput`
   has no reverse and reads a wheel as a gamepad, and the generic wheel
   profile matches Logitech gamepads. Every game writes the same mixer.
   [F-07, F-12, F-13, F-15]
8. **`@skidpad/presets`: presets ship no assists and are typed as complete
   definitions they are not**, which `createChassisBody` (wanting a full
   one) then trips over. [F-04, F-22]
9. **`@skidpad/worker`: a worker world cannot host a Rapier car, and
   `LodController` cannot drive a `WorkerWorld`** (its `lod()` is async).
   [F-23, F-24]

**Minor**

10. `@skidpad/replay`: replays are 66 bytes per step, not the documented 48,
    with no compression helper; ghost recorders cannot restart per lap and
    `sliceGhost` has float-boundary edges; the ghost angle order is
    undocumented. [F-17, F-18, F-20]
11. `@skidpad/core` small API gaps: wheel positions are zero before the first
    step and stale after a restore; `restore` keeps the step counter so
    `worldHash` changes; `resetVehicle` takes a yaw angle (needs `atan2` in
    deterministic code); `/compat` exports less than the main entry.
    [F-06, F-09, F-10, F-19]
12. `@skidpad/core` behaviour: the single-track model holds first gear at
    part throttle; a kart asked for reverse drives forwards. [F-08, F-25]
13. `@skidpad/rapier`: the docs suggest collider user data, which Rapier
    lacks; the deterministic Rapier build needs a type cast. [F-26, F-27]
14. `@skidpad/input`: `AxisFinder` cannot leave out assigned axes. [F-16]
15. `@skidpad/core`: no sound metadata in definitions, no per-wheel
    grip-usage channel, no shift events. [F-30]
16. Two stale or wrong doc comments. [F-11]

### Keep stable

What worked first time and should not change: WASM loading with no bundler
configuration in Vite and Node [G-01]; cross-engine determinism of the core
through the game's own logic [G-02], end to end from a Chromium lap to Node
verification in a worker thread [G-09]; `setAi` [G-03]; loud failures on
unknown channels [G-04]; `TouchInput` as a pure state machine [G-05]; the
force-feedback safety defaults [G-06]; plain-data calibration and profiles
[G-07]; complete snapshot and restore [G-08]; `@skidpad/rapier` [G-10];
`WorkerWorld.step(dt, count)` [G-11]; telemetry rich enough for sound
[G-12].

### Deterministic Rapier experiment [E-01]

A 30 s scripted drive over ramps, bumps, a wall hit and five surfaces ends
bit-identical in Node on Linux x86-64, in Chromium, and in Node on the
owner's Mac (deterministic build). Verifying a ranked Rapier track by
rebuilding the scene on the server looks viable; Firefox and WebKit are
still to run (`E2E_ALL_BROWSERS=1 pnpm e2e`).

### Not yet verified

- Wheels and force feedback on real hardware: everything was exercised with
  fake `Gamepad` and WebHID devices.
- The deterministic Rapier run in Firefox and WebKit, and whether the
  standard Rapier build also matches on arm64.
- `World.setDefinition` (live definition changes) was never needed.

## Entries

### F-30 Sound has to be guessed or derived

- **Package and version:** `@skidpad/core 0.7.0`, `@skidpad/presets 0.7.0`
- **Category:** API design
- **What I tried / what happened / what I expected:** Built engine, tyre,
  surface and wind sound from telemetry (`apps/web/src/audio/carAudio.ts`).
  `EngineRpm`, `ThrottleEffective`, `Gear`, and per-wheel `SlipRatio_*`,
  `SlipAngle_*`, `WheelContact_*` and `SurfaceId_*` were all there and
  enough (G-12). Missing: anything about the engine's sound in the
  definition (cylinder count or firings per revolution, so the note's
  pitch is a guess per car); a channel for how far past its grip limit a
  tyre is (per-wheel force-limit channels exist only per axle as
  `TireFmax_F`/`_R`); and shift or rev-limiter events (found by watching
  `Gear` change).
- **Workaround:** a per-car voice table in the game
  (`apps/web/src/audio/voices.ts`); squeal from each wheel's slip ratio and
  angle divided by the tyre's own peak values, read from the definition
  with the core's defaults filled in.
- **Suggested fix:** an optional `sound` block in the definition (firings
  per revolution at least), a per-wheel combined-slip or grip-usage channel,
  and per-wheel `TireFmax_*`.
- **Severity:** minor

### F-29 Bundling `@skidpad/core` for Node loses the WASM file

- **Package and version:** `@skidpad/core 0.7.0`
- **Category:** packaging
- **What I tried / what happened / what I expected:** Bundled the server
  with esbuild for production. With `@skidpad/core` bundled in, `init()`
  fails: `defaultWasmUrl()` resolves `../wasm/skidpad.wasm` against the
  bundle's own location (ENOENT next to the output file); esbuild does not
  carry `new URL(…, import.meta.url)` assets. The `/compat` entry bundles
  and runs (920 KB, WASM inlined). Nothing in the package says which to use
  for a bundled server.
- **Workaround:** `@skidpad/*` stays external in the server bundle and loads
  from `node_modules` (`apps/server/build.mjs`).
- **Suggested fix:** document bundling (keep it external, or use `/compat`,
  or pass `init({ wasm })` a path), ideally in a README (F-01).
- **Severity:** annoying

### F-28 `@skidpad/worker/entry` is tree-shaken out of production builds

- **Package and version:** `@skidpad/worker 0.7.0`
- **Category:** packaging (bug)
- **What I tried / what happened / what I expected:** The traffic worker
  was the documented one-liner, `import "@skidpad/worker/entry"`. It worked
  in the Vite dev server; in the production build the worker chunk was
  **0 bytes** and `WorkerWorld.create` never resolved, with no error
  anywhere. The package declares `"sideEffects": false`, so the bundler
  drops a side-effect-only import of `entry.js`, which is nothing but a
  side effect (`serveWorld(globalThis)`).
- **Workaround:** the worker calls `serveWorld(globalThis)` itself
  (`apps/web/src/workers/traffic.worker.ts`), and `pnpm e2e:prod` runs the
  whole suite against the production build so this kind of thing shows up.
- **Suggested fix:** `"sideEffects": ["./dist/entry.js"]` in
  `@skidpad/worker`'s package.json, and a production-build test of the
  documented usage.
- **Severity:** blocker (the documented usage silently does nothing in
  production)

### E-01 Experiment: deterministic Rapier replay (phase 6 stretch)

- **Package and version:** `@skidpad/rapier 0.7.0`, `@skidpad/core 0.7.0`,
  `@dimforge/rapier3d-compat` and `@dimforge/rapier3d-deterministic-compat`
  0.21.0
- **Category:** experiment
- **What I tried:** The free-roam level (`packages/freeroam/src/level.ts`:
  100 ground tiles of 9 surfaces, a kicker and landing ramp, a washboard,
  kerbs, a banked bowl, walls) is built in a fixed order from plain data
  with arithmetic only (arcs by the rational circle parametrisation, no
  `sin`/`cos`), the car spawns at yaw 0, Rapier's timestep is fixed at
  1/60 s, and every step runs `beforeStep`, world step, `afterStep`, scene
  step. A scripted 30 s drive (`smoothWave` inputs) goes over the
  washboard and the jump (2.8 m up), brakes into the east wall, and weaves
  across asphalt, concrete, snow, ice and kerbs. The state is hashed every
  2.5 s from the core's `worldHash` plus the exact bits of the Rapier body's
  pose and velocities (`packages/freeroam/src/determinism.ts`).
- **What happened:** Both builds repeat bit for bit run to run, and
  Chromium matches Node at every checkpoint, for **both** builds
  (`apps/web/e2e/determinism.spec.ts`). `@skidpad/rapier` plugged into the
  deterministic build unchanged (apart from a type cast, F-27).
- **What it does not show yet:** Chromium and Node are both V8 on the same
  x86-64 machine, which is why even the standard build agrees; this
  environment cannot install Firefox or WebKit or run on ARM. The
  experiment is not settled until it runs on SpiderMonkey, JavaScriptCore
  and Apple Silicon. Everything is in place for that:
  `pnpm determinism` prints the Node hashes, `packages/freeroam/test/golden.test.ts`
  pins the Linux x86-64 result for the deterministic build, and
  `E2E_ALL_BROWSERS=1 pnpm e2e` adds Firefox and WebKit projects for the
  determinism test.
- **Cross-platform result (owner's MacBook Air, Node, 2026-10-03):**
  `packages/freeroam/test/golden.test.ts` passed: the deterministic build
  ends the 30 s drive in exactly the state pinned on Linux x86-64
  (`86b0eb539438b22a:9ba4101c6e2c3160`), core hash and Rapier body bits
  alike. Assumed Apple Silicon (arm64), to be confirmed with `uname -m`.
  Still open: Firefox and WebKit, and whether the standard build also
  matches on arm64 (`pnpm determinism` prints both).
- **Implication so far:** a Node server on x86-64 can re-run a Rapier
  scene recorded on an arm64 Mac bit for bit with the deterministic build,
  so verifying a ranked Rapier track by rebuilding the scene looks viable.
  The free-roam course stays unranked until the browser engines pass too.

### F-27 The deterministic Rapier build does not type-check against `@skidpad/rapier`

- **Package and version:** `@skidpad/rapier 0.7.0`
- **Category:** types
- **What I tried / what happened / what I expected:** `@skidpad/rapier`
  imports its Rapier types from `@dimforge/rapier3d-compat` and declares it
  as a peer dependency. Passing `@dimforge/rapier3d-deterministic-compat`
  (same API, separate package) to `createChassisBody` / `RapierVehicle`
  needs `as unknown as typeof RAPIER`, and a project that only uses the
  deterministic build still has to install the standard one for the types.
- **Workaround:** the cast, in one place per caller
  (`packages/freeroam/scripts/determinism.ts`, `apps/web/src/ui/DeterminismPage.tsx`).
- **Suggested fix:** type the module parameter structurally (an interface
  of the members used), and list the deterministic build as an alternative
  peer.
- **Severity:** minor

### F-26 "Keep the surface id in the collider's user data": Rapier colliders have none

- **Package and version:** `@skidpad/rapier 0.7.0` with
  `@dimforge/rapier3d-compat 0.21.0`
- **Category:** docs wrong
- **What I tried / what happened / what I expected:** The `surfaceId`
  option's doc suggests keeping the id in the collider's user data. Rapier
  JS colliders have no `userData` field.
- **Workaround:** a `Map` from collider handle to surface id
  (`FreeRoamScene` in `packages/freeroam/src/scene.ts`).
- **Suggested fix:** suggest a handle-keyed map, or accept a
  `Map<number, number>` directly.
- **Severity:** minor

### F-25 Single-track model holds first gear at part throttle

- **Package and version:** `@skidpad/core 0.7.0`, `@skidpad/presets 0.7.0`
- **Category:** feel
- **What I tried / what happened / what I expected:** AI traffic cruising
  at 12 m/s (throttle about 0.23) in `hatchbackFwd`: on the four-wheel model
  the automatic picks second at about 3100 rpm; after `setLod(car,
"singleTrack")` it stays in first at about 5700 rpm. At full throttle both
  models shift alike (148 km/h, fourth, after 20 s). Harmless for
  far-away traffic, but audible once engine sound follows the rpm channel.
- **Workaround:** none.
- **Suggested fix:** use the four-wheel model's shift logic on the
  single-track model, or document the difference.
- **Severity:** minor

### F-24 `LodController` cannot drive a `WorkerWorld`

- **Package and version:** `@skidpad/core 0.7.0`, `@skidpad/worker 0.7.0`
- **Category:** API design
- **What I tried / what happened / what I expected:** The traffic runs in
  a `WorkerWorld`; `LodController` takes a `LodTarget`, whose `lod()` is
  synchronous, while `WorkerWorld.lod()` returns a promise, so the two do
  not fit.
- **Workaround:** an adapter that keeps each vehicle's level locally and
  forwards `setLod` to the worker (`WorkerLodTarget` in
  `apps/web/src/game/traffic.ts`).
- **Suggested fix:** make `WorkerWorld` a `LodTarget` by caching levels it
  sets (it already counts vehicles locally).
- **Severity:** minor

### F-23 A `WorkerWorld` cannot host a Rapier car

- **Package and version:** `@skidpad/worker 0.7.0`, `@skidpad/rapier 0.7.0`
- **Category:** API design
- **What I tried / what happened / what I expected:** Wanted the whole
  free-roam simulation off the main thread. The worker protocol has no
  external-host calls (`setHostMode`, `writeHostBody`,
  `writeWheelContact`, `readHostImpulse` are not in `CALLABLE`), and
  `RapierVehicle` needs a synchronous `World` anyway, so a Rapier-hosted car
  must run on the thread that owns the Rapier scene. Only built-in-host
  vehicles can go to the worker.
- **Workaround:** the player's car and the Rapier scene stay on the main
  thread; the AI traffic runs on the built-in host in a `WorkerWorld`
  (flat ring road), mirrored into Rapier as kinematic boxes so the player
  can hit it (`apps/web/src/game/traffic.ts`).
- **Suggested fix:** document it in the worker guide; longer term, a
  worker entry that runs a Rapier scene and a `RapierVehicle` together.
- **Severity:** annoying

### F-22 `createChassisBody` wants a full definition the presets do not provide

- **Package and version:** `@skidpad/rapier 0.7.0`, `@skidpad/presets 0.7.0`
- **Category:** types
- **What I tried / what happened / what I expected:** `createChassisBody`
  and the scene need a `VehicleDefinition`; the game's car definitions are
  `PartialVehicleDefinition` (presets plus assists, F-04).
- **Workaround:** a shallow merge over `sp.defaultDefinition()`
  (`FreeRoamScene`), which is only correct because the fields read are
  complete in every preset.
- **Suggested fix:** take a `PartialVehicleDefinition` and complete it the
  way `addVehicle` does, or export the core's completion function.
- **Severity:** minor

### F-21 The installed core's npm version cannot be read

- **Package and version:** `@skidpad/core 0.7.0`
- **Category:** packaging
- **What I tried / what happened / what I expected:** The kickoff has the
  server check that a replay was recorded on the same `@skidpad/core` as
  the server's. `Skidpad.version` says `"0.1.0"` (F-05), so I tried to read
  the package's own version instead: both `import("@skidpad/core/package.json")`
  and `require.resolve` fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`, because
  the `exports` map leaves `./package.json` out. Neither the client nor the
  server can report which build they run.
- **Workaround:** the server compares `replay.coreVersion` with its own
  `Skidpad.version` (in the verification worker) and stores it with each
  lap; leaderboards only rank laps from the server's current core
  (`apps/server/src/app.ts`, `repo.ts`). Both sides pin `^0.7.0` from the
  same lockfile, which is the real guarantee for now.
- **Suggested fix:** add `"./package.json": "./package.json"` to `exports`
  in every package, and make `Skidpad.version` the package version (or add
  a `simulationVersion` that changes whenever results can).
- **Severity:** annoying

### F-20 Replays are bigger than the docs say, and nothing compresses them

- **Package and version:** `@skidpad/replay 0.7.0`
- **Category:** docs wrong (and API design)
- **What I tried / what happened / what I expected:** The package header
  says a replay is "48 bytes per car per step before compression". A
  two-lap run of the hatchback (8638 steps) encodes to 571,908 bytes: 66
  bytes per step, because every step also stores its `dt` (8 bytes), level
  of detail (1) and substep-rate override (8), plus 15 keyframes. Gzip
  takes it to 108 KB. A one-lap ghost is 151 KB and gzip only gets it to
  141 KB (float32 pose noise). There is no compression helper, and the
  kickoff asks for compressed submissions.
- **Workaround:** none yet; records are stored raw in IndexedDB
  (`apps/web/src/game/records.ts`). Phase 5 will gzip with
  `CompressionStream` before upload.
- **Suggested fix:** correct the figure; store `dt`, LOD and rate as runs
  (they almost never change); optionally quantise ghost frames; offer
  `encodeReplay(r, { compress: true })` on top of `CompressionStream`.
- **Severity:** minor

### F-19 Seeking a game's replay means rebuilding the player

- **Package and version:** `@skidpad/replay 0.7.0`, `@skidpad/core 0.7.0`
- **Category:** API design
- **What I tried / what happened / what I expected:** The replay viewer
  needs seek. `ReplayPlayer.seek` exists, but it cannot play a game that
  changes surfaces (F-02), so the game re-implements playback with
  seeking on its own `Run`: periodic `world.snapshot()` plus the run's
  timing state, restore the nearest earlier one, play forward. It works
  and is bit-exact (unit-tested), but two details surfaced:
  `World.restore` does not restore the world's step counter, so
  `worldHash()` after a backward seek differs from straight playback
  (`stateHash(vehicle)` matches); and `wheelPositionsView` is stale until
  the next step after a restore (like F-06).
- **Workaround:** `RunPlayback` (`packages/sim/src/playback.ts`) with
  `Run.saveState`/`restoreState`; tests compare `stateHash`; the viewer
  draws the static wheel layout on the frame after a seek.
- **Suggested fix:** the `beforeStep` hook from F-02 would let
  `ReplayPlayer` (keyframes and all) do this; a world-level snapshot that
  includes the step counter would keep `worldHash` meaningful.
- **Severity:** minor

### F-18 Ghost angles: composition order undocumented

- **Package and version:** `@skidpad/replay 0.7.0`
- **Category:** docs gap
- **What I tried / what happened / what I expected:** `GhostPose` has
  `yaw`, `pitch` and `roll` "in radians" but not the order they compose
  in, and no quaternion. Drawing a ghost needs a rotation; I compared both
  common orders against the core's `Quat*` channels over a lap: z-y-x
  (yaw, then pitch, then roll) matches to 4e-16, x-y-z is off by up to
  4e-4.
- **Workaround:** `ghostToPose` in `apps/web/src/game/pose.ts` composes
  z-y-x.
- **Suggested fix:** say so in the `GhostPose` doc, or add a
  `quaternion` helper next to `GhostPlayer.poseAt`.
- **Severity:** minor

### F-17 A ghost recorder records one stretch; laps need slicing or a new recorder

- **Package and version:** `@skidpad/replay 0.7.0`
- **Category:** API design
- **What I tried / what happened / what I expected:** Wanted the ghost of
  each lap. `GhostRecorder` has no reset, so either record the whole run
  and `sliceGhost(from, to)` by time, or build a new recorder at each lap
  start. Slicing compares float32 frame times against float64 bounds with
  `>=`/`<=`, so whether the boundary frames make it in depends on rounding;
  and each frame's time is the time _after_ its step, which the docs do not
  say, so lining a ghost up with a lap clock takes a probe.
- **Workaround:** `Run` starts a new `GhostRecorder` on the step that
  crosses the line and samples the crossing step into both laps' ghosts,
  so ghost time `t` is exactly `t / DT` steps into the lap
  (`packages/sim/src/run.ts`, tested in `packages/sim/test/playback.test.ts`).
- **Suggested fix:** `GhostRecorder.restart()` (or `finish({ reset: true })`)
  and a step-index based `sliceGhost`.
- **Severity:** minor

### F-16 `AxisFinder` cannot leave out axes already assigned

- **Package and version:** `@skidpad/input 0.7.0`
- **Category:** API design
- **What I tried / what happened / what I expected:** Built the wheel set-up
  flow on `AxisFinder` (which axis is moving) and `AxisCalibrator` (its end
  stops). The finder has no way to exclude axes assigned in earlier steps,
  so brushing the throttle during the brake step can pick the throttle
  again, and it does not expose the range it saw, so the flow keeps an
  `AxisCalibrator` per axis alongside it to get the calibration of
  whichever axis wins.
- **Workaround:** the flow ignores a result that names an assigned axis
  and runs one calibrator per axis (`apps/web/src/input/setup.ts`).
- **Suggested fix:** `result({ exclude })`, and a way to get the
  calibration of the found axis directly (or an `AxisFinder` that returns
  an `AxisBinding`).
- **Severity:** minor

### F-15 The built-in generic wheel profile matches Logitech gamepads

- **Package and version:** `@skidpad/input 0.7.0`
- **Category:** bug
- **What I tried / what happened / what I expected:** `builtinProfiles()`
  ends with a "generic wheel" whose `match.wheel` is
  `(?i)wheel|racing|046d|…`. `046d` is Logitech's vendor id, which Chromium
  puts in the id of Logitech gamepads too (F310, F710), so `WheelInput`
  would treat such a gamepad as a wheel with throttle on axis 1 (the left
  stick's Y). Separately, `WheelProfile.match` is documented as "regular
  expressions", but `(?i)` is not valid JavaScript regex syntax; the
  package strips it as its own case-insensitive marker, which is
  undocumented, so a profile written by hand with a normal regex flag
  cannot express case-insensitivity.
- **Workaround:** only gamepads whose `mapping` is not `"standard"` are
  offered to `WheelInput` (`InputManager.update` in
  `apps/web/src/input/manager.ts`); real wheels report a non-standard
  mapping in Chromium.
- **Suggested fix:** skip standard-mapping pads in `WheelInput.match`, and
  document (or replace with a `flags` field) the `(?i)` convention.
- **Severity:** annoying

### F-14 The Logitech sink can be "connected" and send no force

- **Package and version:** `@skidpad/input 0.7.0`
- **Category:** API design
- **What I tried / what happened / what I expected:** Attached
  `LogitechWebHidSink` to a fake HID device with a G29 product id
  (`0xc24f`). The sink defaults to the HID++ protocol, the G29 needs the
  classic one, nothing picks it from the product id, and after the HID++
  feature query times out the sink still reports `connected === true`;
  every `update()` afterwards sends nothing. The only trace is a line in
  `diagnostics`. Changing `sink.protocol` before `attach()` is possible (it
  is a public field), but `peakTorque` was already fixed from the
  constructor's protocol (11 N·m for HID++ against 2.5 for classic), so the
  scaling would be four times off.
- **Workaround:** the game asks for the device with WebHID itself, guesses
  the protocol from the product id (`apps/web/src/input/protocol.ts`, ids
  from Linux `hid-ids.h`), builds a fresh sink for that protocol and
  attaches it (`InputManager.attachWheel`). The Controls panel lets the
  player force either protocol.
- **Suggested fix:** pick the protocol from the product id by default,
  derive `peakTorque` from the protocol actually used, and expose whether
  the force path is working (for example `ready: boolean` or a rejected
  `attach()` when the feature is missing).
- **Severity:** annoying (a blocker for any wheel owner whose model gets the
  wrong default)

### F-13 `GamepadInput` has no reverse and reads whatever pad comes first

- **Package and version:** `@skidpad/input 0.7.0`
- **Category:** API design
- **What I tried / what happened / what I expected:** `GamepadInput.map()`
  always returns `gear: 0`, so a gamepad player cannot select reverse in an
  automatic, and `poll()` reads the first connected pad, which is the wheel
  when a wheel is plugged in. It also does not say which pad it read, so a
  `GamepadRumbleSink` cannot be pointed at the same pad without
  re-implementing the selection.
- **Workaround:** the game picks the first standard-mapping pad itself,
  calls `map(axes, buttons)`, handles Y (toggle reverse), View (restart) and
  Menu (back) itself, and gives the rumble sink that pad's actuator
  (`apps/web/src/input/manager.ts`).
- **Suggested fix:** a gear model like the keyboard's (shift buttons, or a
  reverse toggle), and `poll()` returning or exposing the pad it used.
- **Severity:** annoying

### F-12 Devices cannot be combined

- **Package and version:** `@skidpad/input 0.7.0`
- **Category:** API design
- **What I tried / what happened / what I expected:** The game supports
  keyboard, gamepad, wheel and touch at once, switching to whichever the
  player touches. `@skidpad/input` gives a class per device, each with its
  own `gear` counter, and nothing to choose between them or to keep one gear
  for the car. (This compounds F-07: each counter has to be clamped for an
  automatic.)
- **Workaround:** `InputMixer` (`apps/web/src/input/mixer.ts`, unit-tested)
  switches to the last device that moved, turns any device's gear change
  into one car gear, clamps it for automatics, and writes it back into every
  device's counter.
- **Suggested fix:** a small `InputMixer`-like helper in the package, or a
  shared gear state the device classes can take.
- **Severity:** minor

### F-11 Two doc comments are stale or wrong

- **Package and version:** `@skidpad/core 0.7.0`, `@skidpad/input 0.7.0`
- **Category:** docs wrong
- **What I tried / what happened / what I expected:** The `LodController`
  JSDoc example calls `lod.update((car) => distanceToCamera(car), playerCar)`
  with two arguments; the signature takes one (`distance`), and pinning the
  player's car is a separate `pin()` call. The `GamepadInput` JSDoc says
  "the calibration flow arrives in milestone 5", but `calibration.d.ts`
  already ships it.
- **Workaround:** none needed; read the signatures.
- **Suggested fix:** update both comments; type-check doc examples (for
  example with `twoslash` or by extracting them into a compiled file).
- **Severity:** minor

### F-10 `@skidpad/core/compat` exports a subset of the main entry

- **Package and version:** `@skidpad/core 0.7.0`
- **Category:** API design
- **What I tried / what happened / what I expected:** Compared `compat.d.ts`
  with `index.d.ts` while deciding which entry to use. The compat entry has
  no `LodController`, `chooseLod`, `validateSurfaces`, `migrateLegacyDrive`
  or `defaultWasmUrl`, and its `init()` takes no options. Switching entries
  to work around a bundler problem would break imports elsewhere. I
  expected the two entries to differ only in how the WASM is loaded.
- **Workaround:** this repo uses the main entry (it loaded fine, see G-01).
- **Suggested fix:** re-export the same surface from both entries.
- **Severity:** minor

### F-09 `resetVehicle` takes a yaw angle

- **Package and version:** `@skidpad/core 0.7.0`
- **Category:** API design
- **What I tried / what happened / what I expected:** Wanted a "reset to
  track" key that puts the car back on the centreline facing along it. The
  direction is a vector from the track data; turning it into the `yaw`
  that `resetVehicle(vehicle, x, y, yaw)` needs takes `Math.atan2`, which
  the determinism contract forbids in anything that feeds the ranked sim,
  and the core then presumably takes `sin`/`cos` of it again.
- **Workaround:** no reset-to-track in ranked runs. Restart puts the car
  back on the grid, which sits on an exactly straight part of the main
  straight along +x so the spawn yaw is exactly 0
  (`packages/tracks/src/layouts/riverside.ts`, `packages/sim/src/run.ts`).
- **Suggested fix:** accept a heading vector (or a quaternion) as an
  alternative to the yaw angle.
- **Severity:** minor

### F-08 A kart asked for reverse drives forwards

- **Package and version:** `@skidpad/presets 0.7.0`, `@skidpad/core 0.7.0`
- **Category:** bug (or docs gap)
- **What I tried / what happened / what I expected:** `gear: -1` with full
  throttle on `kart` (its transmission has `reverse: 0`). The `Gear`
  channel reads 1 and the kart accelerates forwards to 13 m/s in 5 s. I
  expected either no drive at all or an error, not forward motion with the
  driver asking for reverse.
- **Workaround:** none yet; the HUD shows the gear the core reports, so the
  player at least sees "1".
- **Suggested fix:** with no reverse ratio, treat a reverse request as
  neutral, and document it.
- **Severity:** minor

### F-07 Keyboard gear counter and automatic gearboxes don't agree

- **Package and version:** `@skidpad/input 0.7.0`, `@skidpad/core 0.7.0`
- **Category:** API design
- **What I tried / what happened / what I expected:** All three cars use
  `mode: "automatic"`. The core treats any forward gear request as drive
  (requests of 0, 1, 3 and 9 all ended in the same gear in a probe), but
  `KeyboardInput` counts E presses up to `MAX_GEAR` (10). After a few
  presses of E, getting reverse takes as many presses of Q, with nothing on
  screen changing in between. Neither package documents how gear requests
  map onto an automatic.
- **Workaround:** the game's `InputMixer` owns the gear, clamps it to
  −1 … 0 for automatics and writes it back into every device's counter
  each step (`apps/web/src/input/mixer.ts`).
- **Suggested fix:** document the automatic's gear semantics in
  `VehicleInput.gear`, and give `KeyboardInput` a mode (or a max gear) so it
  can be told it drives an automatic.
- **Severity:** annoying

### F-06 Wheel positions are zero until the first step

- **Package and version:** `@skidpad/core 0.7.0`
- **Category:** API design
- **What I tried / what happened / what I expected:** Read
  `wheelPositionsView()` right after `addVehicle` and `resetVehicle` to place
  the wheels and decide the starting surface. Every value is 0 until the
  first `step`. Position, quaternion and the other channels are valid
  before stepping.
- **Workaround:** the sim uses the road surface on step 0
  (`packages/sim/src/run.ts`); the renderer places wheels from the
  definition's geometry until the first step (`apps/web/src/game/geometry.ts`).
- **Suggested fix:** fill the wheel positions on `addVehicle`,
  `resetVehicle` and `restore`, or document the behaviour.
- **Severity:** minor

### F-05 `Skidpad.version` is "0.1.0" in `@skidpad/core` 0.7.0

- **Package and version:** `@skidpad/core 0.7.0`
- **Category:** docs gap
- **What I tried / what happened / what I expected:** `sp.version` returns
  `"0.1.0"`. `ReplayRecorder` stores it as `coreVersion`, and the kickoff
  plan is for the server to reject replays whose core version differs. I
  expected it to match the npm version, or at least to be documented as
  something else (the Rust crate's version? an ABI version?). If it is the
  crate version and it does not move when the simulation changes, comparing
  it says nothing about whether a replay reproduces.
- **Workaround:** the verifier compares `replay.coreVersion` with the
  server's own `sp.version` (`packages/sim/src/verify.ts`), which is at
  least consistent. Phase 5 will also pin the exact npm version on both
  sides.
- **Suggested fix:** document what `version` is and what changes it; ideally
  expose a "simulation version" that changes whenever results can change.
- **Severity:** annoying

### F-04 Presets ship no assists, and their type over-promises

- **Package and version:** `@skidpad/presets 0.7.0`
- **Category:** types (and docs gap)
- **What I tried / what happened / what I expected:** The kickoff (from the
  Skidpad side) says to keep "each preset's shipped assist settings as the
  default". None of the six presets has an `assists` block, so all of them
  run with the core default: every assist off. Separately, `presets.*` and
  `preset()` are typed as the full `VehicleDefinition`, but the objects
  have no `assists` block, and no `staticToeDeg` or `trackWidth` on
  their axles; TypeScript happily lets you read `preset("kart").assists.abs`,
  which throws at runtime.
- **Workaround:** the game defines its own "assists on" (ABS, traction and
  stability control at the core's default tuning) and uses the preset
  untouched for "off" (`packages/sim/src/cars.ts`).
- **Suggested fix:** type presets as `PartialVehicleDefinition` (or fill
  them in completely), and either ship sensible assist settings per preset
  or say in the docs that presets have none.
- **Severity:** annoying

### F-03 The built-in flat host takes one surface per vehicle

- **Package and version:** `@skidpad/core 0.7.0`
- **Category:** API design
- **What I tried / what happened / what I expected:** Run-off areas should
  cost time when a car puts two wheels on the grass. `World.setSurface`
  sets one surface id for the whole vehicle on the built-in host, even
  though the telemetry reports `SurfaceId_FL` … `SurfaceId_RR` per wheel and
  the external host takes one per wheel contact. So on the built-in host a
  car is either fully on asphalt or fully on grass.
- **Workaround:** the sim locates each wheel's contact point on the track,
  ranks the four surfaces by grip and applies the second-lowest to the
  whole car: two wheels on the grass put the car on the grass, a single
  wheel over the kerb does not (`Run.chooseSurface` in
  `packages/sim/src/run.ts`).
- **Suggested fix:** `setWheelSurface(vehicle, wheel, id)` (or an array
  form) on the built-in host.
- **Severity:** annoying

### F-02 `ReplayPlayer` cannot follow host-side game logic

- **Package and version:** `@skidpad/replay 0.7.0`
- **Category:** API design
- **What I tried / what happened / what I expected:** Recorded a 1500-step
  run in which the game switches the surface (asphalt → gravel → grass) with
  `setSurface`, then played it back with `createReplayWorld` +
  `ReplayPlayer` and the same surface table. Result: 2 desyncs (both
  keyframes after the start), and the final world hash differs because the
  steps after the last keyframe diverge. This is as the docs describe ("a
  surface change is caught by the keyframes"), but it means the stock
  player cannot verify or faithfully replay any game whose logic changes
  what the core sees; keyframe re-sync hides the divergence rather than
  reproducing it.
- **Workaround:** verification feeds the replay's recorded inputs into the
  game's own `Run`, which makes the same surface decisions
  (`verifyRun` in `packages/sim/src/verify.ts`). The replay is used as an
  input container only.
- **Suggested fix:** either record per-step host changes the recorder can
  see (surface ids, ground slope, resets) alongside the inputs, or give
  `ReplayPlayer` a `beforeStep(step, world)` hook so the application can
  re-apply its own logic during playback and seeking.
- **Severity:** annoying (blocker for anyone who expects the player alone
  to verify a game)

### F-01 No READMEs in the npm packages

- **Package and version:** all of `@skidpad/core`, `presets`, `input`,
  `replay`, `telemetry`, `rapier`, `worker` 0.7.0
- **Category:** docs gap
- **What I tried / what happened / what I expected:** Started "the way an
  outside developer would", from the npm READMEs. None of the packages has a
  README (the npm pages are empty) and none links to the docs site. The
  `.d.ts` JSDoc is good and carried everything so far: the `index.d.ts`
  headers of core and replay have working quick-start snippets, and
  `telemetryLayout` lists every channel with units at runtime. But the
  exact channel names, the wheel order (`WHEEL_ORDER`), the layout of
  `wheelPositionsView` and the meaning of `gear` all had to be found by
  reading types and probing in Node.
- **Workaround:** read `dist/*.d.ts` and probed the API from small Node
  scripts.
- **Suggested fix:** a README per package (install, minimal example, link
  to the guide), plus a generated channel-name union type so
  `read(car, "SpinAngle_FL")` is checked at compile time.
- **Severity:** annoying

### G-12 Telemetry was rich enough for sound

- **Package and version:** `@skidpad/core 0.7.0`
- **Category:** good surprise
- Engine pitch from `EngineRpm` tracks exactly (273 Hz at 5475 rpm for
  three firings per revolution), load from `ThrottleEffective`, squeal and
  rumble from per-wheel slip, contact and `SurfaceId_*`, and all of it
  works unchanged for a Rapier-hosted car.

### G-11 `WorkerWorld.step(dt, count)` makes a pipelined loop keep real time

- **Package and version:** `@skidpad/worker 0.7.0`
- **Category:** good surprise
- Stepping the traffic once per host step only when no request was in
  flight let it fall far behind on slow frames; counting the steps owed
  and sending them as one `step(dt, count)` fixed it in three lines. The
  synchronous reads of the last answer made rendering and the kinematic
  mirrors trivial.

### G-10 `@skidpad/rapier` worked first time

- **Package and version:** `@skidpad/rapier 0.7.0`
- **Category:** good surprise
- A Rapier-hosted car drove over ramps, a washboard, kerbs and a banked
  bowl with no tuning; the y-up frame conversion matched the game's own
  mapping, the surface callback put each collider's grip under the right
  wheel, and the guide's note about stepping the scene once after building
  it saved a confusing first frame.

### G-09 A lap driven in Chromium verifies in Node, end to end

- **Package and version:** `@skidpad/core 0.7.0`, `@skidpad/replay 0.7.0`
- **Category:** good surprise
- The full-stack Playwright test drives a lap in Chromium, gzips its
  replay, and the server re-runs it through `packages/sim` in a Node
  worker thread: same lap time in steps, same final `worldHash`, accepted
  (`apps/web/e2e/leaderboard.spec.ts`). `init()` worked unchanged inside a
  `worker_threads` worker, and re-simulating a 70-second lap takes about
  0.6 s there, so verification needs no job queue at this scale. The
  replay codec carried everything the verifier needed.

### G-08 Snapshot and restore are complete

- **Package and version:** `@skidpad/core 0.7.0`
- **Category:** good surprise
- A 316-byte `world.snapshot(car)` restored mid-lap and played forward
  gives the same `stateHash` and the same lap timing as straight playback,
  after seeking to the end, back to the start and back again
  (`packages/sim/test/playback.test.ts`). Replaying a stored best lap in
  the browser ends in exactly the recorded `worldHash`
  (`apps/web/e2e/ghost-replay.spec.ts`). The replay codec round-trips
  everything the verifier needs.

### G-07 Profiles and calibration are plain, testable data

- **Package and version:** `@skidpad/input 0.7.0`
- **Category:** good surprise
- `AxisCalibration` and `WheelProfile` are plain JSON, `loadProfiles` /
  `saveProfiles` take any storage, and `WheelInput` accepts a `GamepadLike`
  that a test can build by hand. A profile produced by the game's own
  set-up flow drove `WheelInput` with no glue, and the whole flow is tested
  in Node and in Playwright with a fake wheel (`apps/web/test/input.test.ts`,
  `apps/web/e2e/wheel.spec.ts`).

### G-06 The force-feedback safety net is complete and on by default

- **Package and version:** `@skidpad/input 0.7.0`
- **Category:** good surprise
- Without any configuration the Logitech sink caps output at 40 % of the
  device's peak, rate-limits changes, zeroes the force after 0.3 s without
  updates (seen in a probe) and when the page is hidden, and the
  `FfbScaler` runaway guard latched the output at zero in a probe of a
  wheel spinning away at 1031°/s. The game keeps every default and only
  exposes gain, invert and a re-arm button. The diagnostics log is what
  revealed F-14.

### G-05 Touch input is a pure state machine

- **Package and version:** `@skidpad/input 0.7.0`
- **Category:** good surprise
- `TouchInput` takes normalised pointer positions and returns frames, with
  no DOM. The overlay that feeds it is about sixty lines
  (`apps/web/src/ui/TouchControls.tsx`) and Playwright drives it with
  synthetic pointer events.

### G-04 Unknown telemetry channels fail loudly

- **Package and version:** `@skidpad/core 0.7.0`
- **Category:** good surprise
- `world.read(car, "Speeed")` throws `unknown telemetry channel "Speeed"`
  rather than returning `NaN` or 0, and `sp.channel(name)` returns −1 for
  probing. Typos surfaced immediately.

### G-03 The path-following driver drove a new track out of the box

- **Package and version:** `@skidpad/core 0.7.0`
- **Category:** good surprise
- `world.setAi(car, centreline, { maxSpeed: 60, lateralAccel: 8 })` lapped
  the new circuit cleanly in all three cars with no tuning, and its inputs
  read back from `inputView()` replay exactly in a fresh world. That made a
  bot lap for tests and the end-to-end smoke test a few lines
  (`packages/sim/src/testing.ts`).

### G-02 Cross-engine determinism held on the first try

- **Package and version:** `@skidpad/core 0.7.0`
- **Category:** good surprise
- A ~70 s lap of bot inputs, run through the game's own sim (surface
  switching, timing) in Node and in Chromium through the real render loop,
  gives the same lap time in steps and the same `worldHash()`
  (`apps/web/e2e/smoke.spec.ts`). Two runs in Node match too
  (`packages/sim/test/run.test.ts`).

### G-01 WASM loading needed no bundler configuration

- **Package and version:** `@skidpad/core 0.7.0` with Vite 8.3 and Node 22
- **Category:** good surprise
- Plain `await init()` worked in the Vite dev server (no `optimizeDeps`
  exclusion), in `vite build` (the `.wasm` is emitted as a hashed asset and
  the inline build does not leak into the bundle) and in Node (read from
  disk). The `/compat` entry was not needed.
