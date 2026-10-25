# ADR-0036: Road texture from surface roughness and ridges

- Status: Proposed
- Date: 2026-10-25
- Supersedes / superseded by: none; builds on ADR-0014 (surface table),
  ADR-0028 (unsprung mass) and ADR-0030 (steering lift)

## Context

Every surface was perfectly flat, so between steering inputs the rim was
dead, and a kerb was a 35 mm platform that the wheel felt only as a step.
Item 10 of the force-feedback polish list asked for road texture. There
were two ways to get it: a synthetic vibration in the force-feedback layer
(ACC's "road effects", iRacing's kerb rumble), or a physical road that the
tires roll over. Skidpad's force feedback is the model's own steering
torque, and Colin chose the physical road, with a sandbox slider to make
its fast part stronger at the wheel (2026-10-25).

Constraints: deterministic and the same in every replay; no change at all
for a smooth surface; cheap enough for the bench gate; no change to the
host contact record or the snapshot layout.

## Decision

**Three new numbers per surface**, all zero by default:

- `roughness`: the ISO 8608 road class, given as the displacement spectral
  density at the reference spatial frequency `n0 = 0.1` cycles/m in
  10⁻⁶ m³, the unit of the standard's class table (class A up to 32, B
  32–128, C 128–512, D 512–2048). The spectrum is `Gd(n) = Gd(n0)·(n/n0)⁻²`.
- `ridgeHeight` and `ridgeSpacing`: a grid of crests, such as a kerb's
  ripples or the setts of a cobbled road. The height is
  `H·(r(x) + r(y))/2` with `r(u) = (1 − cos 2πu/λ)/2`: a wheel rolling
  along a world axis crosses crests `H/2` high every `λ`, a wheel rolling
  diagonally crests `H` high every `λ√2`. The grid is in world axes because
  the contact record carries no direction for the surface.

**A fixed height field over the world plane.** The roughness is a sum of 27
cosines: nine half-octave bands from 0.25 to 4 cycles/m (wavelengths from
4 m, below which the circuit's own crests take over, to 0.25 m, about
where a tire's footprint starts to bridge the bumps), three waves per band
60° apart so no direction of travel is smooth. Each band's waves carry the
band's variance `Gd(n)·Δn`; the table is generated once and written out as
literals, so the profile is identical on every platform, and it scales by
`√roughness`. A point's height and slope depend only on where it is, so
the same spot is the same bump every lap, the rear wheels follow the
fronts, and a replay or a restored snapshot meets the same road without
any new state.

**Where it acts** (four-wheel model only; the single-track model has no
wheels to put on it):

1. The contact pass raises the ground under each ray hit by the height
   there and adds the rate the contact moves across its slope to the
   suspension rate (or, with unsprung mass, to the tire deflection rate).
   The springs, dampers and tire then carry it as load: on a car with
   unsprung mass mostly through the stiff tire, as on a real car.
2. The slope tilts the ground under the tire, so the load pushes the wheel
   back as it climbs a rise and forward as it drops off one:
   `Fx = −Fz · (∇h · forward)`. It acts on the chassis at the contact and,
   because it is a force through the wheel centre, on the kingpin with the
   lever `scrubRadius + R·tan(KPI)` (the axis's offset at hub height). That
   is the classic kick-back through the rim on a kerb. It counts in the
   scrub-radius share of the torque breakdown (ADR-0031).
3. Everything else follows from the load: the caster and inclination lift
   of ADR-0030 stop cancelling between the wheels when one is loaded more
   than the other, and the tire's `Fy` and `Mz` move with load.

When both front wheels meet the same ridge at once the kicks cancel through
the rack, as on a real car squarely on a kerb; with one side on the kerb
they do not.

**The sandbox turns it on.** `surfaceTable()` in `@skidpad/presets` still
returns the friction and drag only, so existing applications run exactly as
before; `surfaceTable({ texture: true })` adds the texture, and the sandbox
uses it with a **Road texture** toggle. The reference classes and the kerb
and sett ridges are estimates, marked so in the table's sources.

**Road detail at the wheel.** `FfbScaler` gains `detail` (default 1) and
`detailCutoff` (default 10 Hz): the torque is split by a first-order
low-pass at the cutoff and the fast part is multiplied by `detail` before
the gain. At 1 the torque is untouched, bit for bit. The sandbox shows it
as **Road detail**, 0 to 4×. It scales what the model produced; it adds no
signal of its own.

## Alternatives considered

- **A synthetic effect in the force-feedback layer** (surface id, speed and
  load to a vibration). Quick and easy to make strong, but not physics: the
  car does not feel it, it is absent from telemetry and replays, and it
  goes against the design of taking the torque from the model. The Road
  detail slider covers the case where the physical texture turns out too
  subtle.
- **Texture along each wheel's travelled distance.** It would let ridges
  always run across the wheel's path, but it needs new per-wheel state in
  the snapshot and loses "same spot, same bump".
- **A direction or texture coordinate in the host contact record**, so
  kerb ridges could follow the kerb. An ABI change for one feature; the
  world-axis grid is close enough for feel.
- **Tire enveloping** (averaging the road over the footprint). The band
  limit at 0.25 m and the 0.1 m minimum ridge spacing stand in for it.

## Consequences

- A smooth surface (all three zero, the default) skips the texture with
  one comparison per wheel: every existing result, golden and determinism
  hash is unchanged, and a test checks a table holding rough surfaces that
  no wheel touches is bit-identical.
- Cost on a textured surface: 27 sine-cosine pairs per wheel per substep,
  about 3 µs per car-substep natively (2.4 µs to 5.4 µs for the hatchback).
  Fine for the player's car; a host running many full-detail cars on
  textured surfaces pays it per car. The bench (all smooth) moved 0–5 %,
  within noise of the gate.
- WASM grows by about 1 KB gzipped.
- On the hatchback at 25 m/s with the left wheels on rough asphalt (class A, 8) the rim torque varies by about 0.06 N·m RMS; class B (64) about
  0.17 N·m; the kerb ridges about 0.35 N·m RMS at 50 Hz. Presets without
  scrub radius, inclination or caster (the kart, the open-wheeler) feel it
  only through the tire's load sensitivity, so very little.
- The validation stops stay on the smooth surfaces. A light car on stiff
  tires is sensitive to texture when braking: the kart, braked on textured
  wet asphalt, swaps ends where it did not before.
