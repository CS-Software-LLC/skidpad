# Kickoff: a time-trial game on the published Skidpad packages

This file is the brief for a new repository. Read all of it before writing
code. It explains why the project exists, what to build first, how the
Skidpad packages fit together, and the rules that make this project useful to
Skidpad as well as being a game.

The working name below is `skidpad-time-trial`. Rename it freely.

## Why this project exists

Skidpad (github.com/CS-Software-LLC/skidpad) is a deterministic vehicle
physics library: a Rust core compiled to WebAssembly, with TypeScript
packages around it. Its milestones 0 to 7 are done and validated inside its
own monorepo. Milestone 8 is dogfooding: build a small game **outside** the
Skidpad repo, using only the packages published to npm, and record every bit
of API, packaging and docs friction it exposes. Skidpad 1.0 cannot ship until
at least one outside project like this one exists.

So this project has two deliverables of equal weight:

1. A small, fun, polished browser time-trial game.
2. `FRICTION.md`: an honest log of everything about Skidpad that was confusing,
   missing, awkward or broken while building it.

A workaround that hides a Skidpad problem without logging it defeats the
purpose. When in doubt, log it.

## Ground rules

- **Install Skidpad from npm only.** Use normal semver ranges on the `0.x`
  line (0.7.0 at the time of writing). No `workspace:`, `file:`, `link:` or
  git dependencies, no copying Skidpad source into this repo, no patching
  `node_modules`. If a fix is needed in Skidpad, log it, work around it
  locally if you must (and log the workaround), and pick up the fixed version
  once it is published.
- **Learn Skidpad the way an outside developer would.** Start from the npm
  READMEs, the type definitions shipped in the packages, and the Skidpad docs
  site (the `apps/docs` guides in the Skidpad repo: getting started, vehicle
  definitions, Rapier, replays and ghosts, many cars / LOD, worker mode,
  determinism contract, force feedback). Reading the Skidpad source or its
  sandbox app is allowed, but each time you have to do it to answer a
  question, that is a docs gap: log it.
- **Keep every friction entry concrete.** Say what you tried, what happened,
  what you expected, which package and version, and the workaround (see the
  format at the end of this file).
- **Keep scope small.** One good track beats three rough ones. Do not build
  features listed under "Out of scope".

## Stack

The owner's usual stack, which also matches the integration Skidpad documents:

- pnpm workspace, TypeScript everywhere, strict mode.
- **Client:** Vite + React + React Three Fiber (three.js). Rapier via
  `@dimforge/rapier3d-compat` for the free-roam level. The owner develops
  on macOS.
- **Server:** Node + Express + TypeScript, PostgreSQL for the leaderboard.
  Use a simple query layer or a light ORM; no heavy framework.
- **Tests:** Vitest. Playwright for one end-to-end smoke test that loads the
  game and drives a lap with scripted inputs.

Suggested layout:

- `apps/web`: the game client.
- `apps/server`: the Express API and leaderboard verifier.
- `packages/sim`: the **deterministic game simulation**, shared by client and
  server (details below). It depends on `@skidpad/core`, `@skidpad/presets`
  and `@skidpad/replay`, and has no DOM, three.js or Rapier dependency.
- `packages/tracks`: track data (centreline, widths, checkpoints, surfaces,
  start grid) as plain data, shared by client and server.

## The Skidpad packages and what to take from each

All are published under the `@skidpad` scope.

- **`@skidpad/core`**: `init()` loads the WASM once and returns the Skidpad
  object; `createWorld(capacity)` makes a world; `addVehicle(definition)`
  returns a vehicle index. Each host step you `setInput` and `step(dt)`, then
  read telemetry by channel name (`read`, `readAll`). It also has
  `stateHash`/`worldHash`, `snapshot`/`restore`, surfaces (`setSurfaces`,
  `setSurface`), level of detail (`setLod`, `LodController`), a built-in
  path-following driver (`setAi`), `stepMany`, and `validateDefinition`. If
  the bundler struggles to serve the separate `.wasm` file, the
  `@skidpad/core/compat` entry inlines it; note in the friction log if you
  needed it.
- **`@skidpad/presets`**: six reference vehicles (`hatchbackFwd`,
  `sportsRwd`, `kart`, `pickup4x4`, `crossoverEv`, `openWheeler`) and a
  reference surface table (dry and wet asphalt, concrete, cobbles, gravel,
  dirt, grass, sand, snow, ice) with `surfaceTable()` and `surfaceId(name)`.
- **`@skidpad/input`**: keyboard, gamepad, steering wheel (with calibration
  and saved profiles) and touch, all producing one normalised input frame.
  Also force feedback: a scaler from the core's steering torque to a sink,
  a gamepad rumble sink, and a Logitech WebHID sink (Chromium only).
- **`@skidpad/rapier`**: `createChassisBody` and `RapierVehicle`, which let a
  Rapier rigid body be the car on real 3D geometry. Its guide covers the
  per-step order (`beforeStep`, world step, `afterStep`, scene step) and how
  to map colliders to surface ids.
- **`@skidpad/replay`**: replays (recorded inputs plus periodic keyframes,
  re-simulated bit for bit, seekable, encodable to bytes) and ghosts (pose
  tracks, no simulation, cheap to play back, survive core upgrades).
- **`@skidpad/telemetry`**: a ring-buffer recorder with CSV and JSON export.
- **`@skidpad/worker`**: runs a world in a Web Worker with synchronous reads
  of the last step's telemetry.
- `@skidpad/jolt` exists too; this project does not need it.

Facts that are easy to get wrong:

- The core uses **ISO axes**: x forward, y left, z up, SI units. three.js is
  y-up. Convert in exactly one place. The Skidpad sandbox maps core
  `(x, y, z)` to three.js `(x, z, −y)`.
- Step the core at a **fixed host step** (1/60 s) from an accumulator in the
  render loop; the core substeps internally (1 kHz on the full model). Never
  pass the frame delta straight to `step`.
- Place the body from the position and quaternion channels and each wheel
  from its steer, suspension-travel and spin-angle channels. Get the exact
  channel names from the package (types, schema or `readAll`), not from
  memory.
- **Determinism covers the core only.** The core is bit-exact across
  Chromium, Firefox, WebKit and Node given the same inputs. Your own
  JavaScript is not: `Math.sin`, `Math.atan2`, `Math.hypot` and friends can
  differ in the last bit between engines. Any game logic that changes what
  the simulation sees (surfaces, resets, lap timing) must use basic
  arithmetic only (`+ − × ÷`, comparisons, `Math.sqrt`, `Math.abs`,
  `Math.min/max`). `@skidpad/core` exports `triangleWave` and `smoothWave`
  for scripted inputs.
- **Rapier-hosted cars cannot be replayed** by `@skidpad/replay`, because
  the replay cannot re-create the host scene. Use ghosts for them. Rapier's
  normal build is not cross-platform deterministic.

## The game, version 1

A single-player time trial in the browser.

- **Ranked track:** one flat circuit of about 1 to 1.5 km, with corners of
  varied speed, a chicane, and run-off areas on a lower-grip surface (grass or
  gravel) so going wide costs time. It runs on Skidpad's **built-in flat-ground
  host** so laps can be verified on the server.
- **Free-roam level (unranked):** a small Rapier scene with ramps, bumps,
  kerbs, a banked turn and mixed surfaces, to exercise `@skidpad/rapier` on
  real geometry. Ghosts only, no leaderboard.
- **Cars:** three of the presets to choose from, for example `hatchbackFwd`,
  `sportsRwd` and `kart`. Keep each preset's shipped assist settings as the
  default, with a toggle. Assists are part of the core, so replays reproduce
  them.
- **Laps:** a start/finish line plus ordered checkpoints. A lap counts only if
  every checkpoint is crossed in order. The lap time is **steps × dt**, an
  exact integer number of steps, not wall-clock time.
- **Ghost:** race against your personal best on each car, and optionally
  against the leaderboard leader's ghost, downloaded from the server.
- **HUD:** speed, gear, rpm, current and best lap, live delta to the best lap,
  and a small input display (steer, throttle, brake).
- **Input:** keyboard first, then gamepad, then a steering wheel with the
  input package's calibration flow, then touch for phones. Force feedback on
  a wheel through the Logitech WebHID sink when available, with gamepad
  rumble as the fallback. Respect the input package's safety defaults for
  force feedback.
- **AI traffic (stretch):** a handful of AI cars on the free-roam level using
  `setAi` along a path and `LodController`, to exercise level of detail.
  Keep AI out of ranked runs.
- **Sound (stretch):** an engine note that follows the engine-speed channel,
  and tire squeal from combined slip. The Skidpad sandbox does this with Web
  Audio synthesis; build your own version and log any missing channels.

## Architecture

### `packages/sim`: the deterministic core of the game

This one module decides everything that affects the ranked simulation, and
both the client and the server run it:

- Create the world, set the surface table, add the chosen preset, place it on
  the start grid.
- Each step: apply the input frame, decide each car's surface from the track
  data (on track or off track, using basic arithmetic against the centreline
  and widths), step the world, then advance lap and checkpoint state by
  testing the car's position against checkpoint segments.
- Report events (checkpoint crossed, lap completed with its step count,
  invalid lap) as plain data.

It must not read the clock, call `Math.random`, use transcendental `Math`
functions, or depend on frame timing. Rendering, audio and input devices sit
outside it. The client drives it from a 60 Hz accumulator; the server drives
it in a tight loop.

Unit-test it directly: the same input sequence must give the same
`worldHash` and lap times in two separate runs, and in Node and in a
browser (the Playwright smoke test can check this).

### Recording and verification

- While a ranked lap is driven, record it with `@skidpad/replay`'s
  `ReplayRecorder` (attach car, track id and game version in `meta`). Also
  record a ghost for display.
- When a lap completes, the client submits the encoded replay (compressed),
  its claimed lap time in steps, and the final state hash.
- The server decodes it, checks the core version matches the server's
  installed `@skidpad/core`, and **re-runs the lap through `packages/sim`**,
  feeding it the recorded per-step inputs. It accepts the lap only if the
  re-run completes a valid lap in the claimed number of steps with the same
  final hash. The stored time is always the server's own result, never the
  client's claim.
- Note that the stock `ReplayPlayer` only re-steps the world. It does not
  know about the game's surface changes and would see them as desyncs at
  keyframes. That is why verification runs the game's own sim. Whether the
  replay package should support host-side game logic more directly is
  exactly the kind of finding the friction log should capture.
- Store the ghost alongside each accepted lap so others can race the top
  times.

This verifies that a submitted lap is physically possible with the inputs it
contains. It does not prove a human drove it (a bot could generate inputs);
that is acceptable for this project.

### Client loop

Fixed-step accumulator, interpolate rendering between the last two states,
read the input devices once per step through `@skidpad/input`, push the
steering torque to force feedback after each step. Start the ranked track on
the main thread. Try `@skidpad/worker` for the free-roam level with AI
traffic, and record how the worker API compares.

### Server

Express with a few JSON endpoints: list tracks and cars, submit a lap, get the
leaderboard for a track and car, download a ghost. Postgres tables for
players (anonymous display name plus a random token stored by the client is
enough), laps (player, track, car, steps, game and core version, verified
flag, timestamps) and blobs for replays and ghosts (Postgres `bytea` is fine
at this scale). Validate request bodies, cap upload size, and limit how often
each player can submit. Run verification synchronously at first; move it to a
job queue only if it becomes slow.

## Phases

Each phase should end with something playable and an updated `FRICTION.md`.

1. **Car on screen.** Vite + R3F app, `init()`, one preset on the built-in
   host on a flat plane, keyboard driving, a chase camera, body and wheels
   placed correctly. This phase alone usually finds packaging friction (WASM
   loading, ESM, types), so log carefully.
2. **Track and laps.** Track data, rendered road and run-off, surfaces
   switched by `packages/sim`, checkpoints, lap timing, HUD, car selection.
3. **Input breadth.** Gamepad, wheel with calibration and saved profiles,
   touch, force feedback.
4. **Ghosts and replays.** Personal-best ghost per car saved locally, replay
   viewer with seek and a free camera.
5. **Server leaderboard.** Express + Postgres, submission and verification
   via `packages/sim`, leaderboard UI, download the leader's ghost.
6. **Free-roam on Rapier.** The Rapier scene, surfaces from colliders,
   ghosts there, optional AI traffic with LOD and the worker.
7. **Polish and deploy.** Sound, settings, loading states, a deploy of the
   client and server, a README for players and developers.

Skidpad is `0.x` and may make breaking changes between minor versions. When
you upgrade, read its changelog, note anything that broke in the friction
log, and note whether the changelog warned you.

## `FRICTION.md` format

One entry per finding, newest at the top:

- **Title:** short and specific.
- **Package and version:** for example `@skidpad/replay 0.7.0`.
- **Category:** packaging, API design, types, docs gap, docs wrong, bug,
  performance, or feel.
- **What I tried / what happened / what I expected.**
- **Workaround:** what this repo does instead, with a pointer to the code.
- **Suggested fix:** what would have prevented it.
- **Severity:** blocker, annoying, or minor.

Also log the good surprises (things that just worked); they show which
parts of the API to keep stable.

Every few phases, group the open entries into a short summary at the top of
the file so they can be turned into Skidpad issues.

## Out of scope

Multiplayer and netcode, accounts with passwords or OAuth, a track editor,
car damage, career modes, monetisation, a native mobile or desktop build, and
any change made inside the Skidpad repository from this one.

## Open questions for the owner

Ask these rather than guessing when you reach them:

- The game's name and the final track layout.
- Hosting for the client and server.
- Whether a desktop build with Electron (and `node-hid` for force feedback)
  is wanted later; it affects how the input layer is abstracted.
