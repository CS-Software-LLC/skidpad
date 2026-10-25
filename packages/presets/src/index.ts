/**
 * @skidpad/presets — reference vehicle definitions and the surface table.
 * Each vehicle carries a `dataSheet` with its sources; see
 * `data/PROVENANCE.md` in the repository.
 *
 * Presets are partial definitions: what they leave out (many tire and
 * differential details, static toe, per-axle track widths) takes the core's
 * defaults when a world adds the car. `sp.completeDefinition(preset(id))`
 * gives the full definition the core runs. Their `chassis` is always
 * complete.
 *
 * Assists: `sportsRwd` and `openWheeler` ship ABS, traction and stability
 * control on, `crossoverEv` traction control on; `hatchbackFwd`, `kart`
 * and `pickup4x4` ship no `assists` block, so every assist is off (the
 * core's default). Turn assists on or off in a copy's `assists`.
 */
import type { ChassisDefinition, PartialVehicleDefinition, SurfaceDefinition } from "@skidpad/core";
import hatchbackFwd from "./vehicles/hatchback-fwd.json" with { type: "json" };
import sportsRwd from "./vehicles/sports-rwd.json" with { type: "json" };
import kart from "./vehicles/kart.json" with { type: "json" };
import pickup4x4 from "./vehicles/pickup-4x4.json" with { type: "json" };
import crossoverEv from "./vehicles/crossover-ev.json" with { type: "json" };
import openWheeler from "./vehicles/open-wheeler.json" with { type: "json" };

/**
 * A preset: a partial definition (see the module notes) whose name and
 * chassis are always complete.
 */
export type PresetDefinition = PartialVehicleDefinition & {
  name: string;
  chassis: ChassisDefinition;
};

export const presets = {
  hatchbackFwd: hatchbackFwd as PresetDefinition,
  sportsRwd: sportsRwd as PresetDefinition,
  kart: kart as PresetDefinition,
  pickup4x4: pickup4x4 as PresetDefinition,
  crossoverEv: crossoverEv as PresetDefinition,
  openWheeler: openWheeler as PresetDefinition,
} as const;

export type PresetId = keyof typeof presets;

export const presetIds = Object.keys(presets) as PresetId[];

/** Deep-clone a preset so callers can edit it freely. */
export function preset(id: PresetId): PresetDefinition {
  return structuredClone(presets[id]);
}

export type SurfaceId =
  | "asphaltDry"
  | "concrete"
  | "asphaltWet"
  | "cobbles"
  | "gravel"
  | "dirt"
  | "grass"
  | "sand"
  | "snow"
  | "ice"
  | "kerb";

/** One named surface of the reference table (ADR-0014). */
export interface NamedSurface extends SurfaceDefinition {
  id: SurfaceId;
  name: string;
  /** Where the numbers come from. */
  source: string;
}

/**
 * The reference surface table, in the order of its ids: index `i` is the
 * surface id a wheel contact carries. Pass {@link surfaceTable} to
 * `World.setSurfaces()` and tag colliders with {@link surfaceId}.
 *
 * Grip is the friction coefficient of the surface relative to dry asphalt,
 * from the ranges published for passenger-car tires (J. Y. Wong, *Theory
 * of Ground Vehicles*, ch. 1, peak and sliding coefficients by surface;
 * T. D. Gillespie, *Fundamentals of Vehicle Dynamics*, ch. 10, wet and dry
 * pavement). Rolling-resistance scales follow Wong's coefficients by
 * surface relative to a hard road. Ploughing drag is an order-of-magnitude
 * figure for the motion resistance of a tire on a deformable surface (Wong
 * ch. 2, terramechanics), chosen so a car coasts to a stop on sand in a few
 * car lengths.
 *
 * Roughness is a road class from ISO 8608 (the displacement spectral
 * density at 0.1 cycles/m, in 10⁻⁶ m³, whose class limits are 32, 128, 512
 * and 2048 for A to D); which class each surface sits in, and the kerb and
 * sett ridges, are estimates. The core sees them only through
 * `surfaceTable({ texture: true })` (ADR-0036).
 */
export const surfaces: readonly NamedSurface[] = [
  {
    id: "asphaltDry",
    name: "Dry asphalt",
    grip: 1,
    rollingResistance: 1,
    drag: 0,
    roughness: 8,
    source:
      "The reference surface the tire parameters describe. Texture: low ISO 8608 class A (class A runs 0–32, mean 16), for a well-kept track [ESTIMATE].",
  },
  {
    id: "concrete",
    name: "Concrete",
    grip: 0.95,
    rollingResistance: 0.9,
    drag: 0,
    roughness: 8,
    source:
      "Wong ch. 1: peak coefficients on dry concrete a little below dry asphalt; rolling resistance slightly lower. Texture: low class A, like the asphalt [ESTIMATE].",
  },
  {
    id: "asphaltWet",
    name: "Wet asphalt",
    grip: 0.65,
    rollingResistance: 1.1,
    drag: 0,
    roughness: 8,
    source:
      "Gillespie ch. 10: wet pavement peak 0.5–0.8 of dry depending on tread depth and speed; the middle of that range. Texture: the dry asphalt's.",
  },
  {
    id: "cobbles",
    name: "Cobblestones",
    grip: 0.75,
    rollingResistance: 1.6,
    drag: 0,
    roughness: 256,
    ridgeHeight: 0.006,
    ridgeSpacing: 0.15,
    source:
      "Wong ch. 1: dry cobbles 0.6–0.8 of asphalt; rolling resistance well above asphalt. Texture: ISO class C (128–512) with setts about 15 cm across and 6 mm crowns [ESTIMATE].",
  },
  {
    id: "gravel",
    name: "Gravel",
    grip: 0.6,
    rollingResistance: 2,
    drag: 0.02,
    roughness: 256,
    source:
      "Wong ch. 1: loose gravel 0.55–0.65; rolling resistance about twice asphalt; light ploughing. Texture: ISO class C, the class of an unpaved road [ESTIMATE].",
  },
  {
    id: "dirt",
    name: "Packed dirt",
    grip: 0.65,
    rollingResistance: 1.5,
    drag: 0.01,
    roughness: 128,
    source:
      "Wong ch. 1: hard-packed earth road 0.6–0.7 of asphalt. Texture: class B/C boundary for a graded dirt road [ESTIMATE].",
  },
  {
    id: "grass",
    name: "Grass",
    grip: 0.45,
    rollingResistance: 2.5,
    drag: 0.03,
    roughness: 128,
    source:
      "Wong ch. 1: dry grass 0.4–0.5; soft ground raises the rolling resistance severalfold. Texture: class B/C boundary, mown verge over soil [ESTIMATE].",
  },
  {
    id: "sand",
    name: "Sand",
    grip: 0.4,
    rollingResistance: 3,
    drag: 0.12,
    roughness: 64,
    source:
      "Wong ch. 2: the motion resistance of a tire sinking into loose sand is of the order of a tenth of the load. Texture: class B; loose sand smooths itself out [ESTIMATE].",
  },
  {
    id: "snow",
    name: "Packed snow",
    grip: 0.3,
    rollingResistance: 1.5,
    drag: 0.04,
    roughness: 64,
    source:
      "Wong ch. 1, Gillespie ch. 10: packed snow 0.2–0.35. Texture: class B, packed and rutted [ESTIMATE].",
  },
  {
    id: "ice",
    name: "Ice",
    grip: 0.12,
    rollingResistance: 0.8,
    drag: 0,
    roughness: 2,
    source:
      "Wong ch. 1, Gillespie ch. 10: smooth ice near freezing 0.1–0.15. Texture: near-perfectly smooth [ESTIMATE].",
  },
  {
    id: "kerb",
    name: "Kerb",
    grip: 0.9,
    rollingResistance: 1.2,
    drag: 0,
    roughness: 8,
    ridgeHeight: 0.012,
    ridgeSpacing: 0.5,
    source:
      "Painted concrete kerbing, a little below dry asphalt. Texture: the asphalt's roughness plus ripples 12 mm high every 0.5 m, a 50 Hz buzz at 90 km/h [ESTIMATE].",
  },
];

export const surfaceIds: readonly SurfaceId[] = surfaces.map((s) => s.id);

/** The numeric id (table index) of a named surface. */
export function surfaceId(id: SurfaceId): number {
  const i = surfaces.findIndex((s) => s.id === id);
  return i < 0 ? 0 : i;
}

/**
 * The table as plain entries for `World.setSurfaces()`. The road texture
 * (roughness and ridges, ADR-0036) is left out unless `texture` is set, so
 * a table that ran before texture existed runs exactly as it did.
 */
export function surfaceTable(options: { texture?: boolean } = {}): SurfaceDefinition[] {
  return surfaces.map(({ grip, rollingResistance, drag, roughness, ridgeHeight, ridgeSpacing }) =>
    options.texture
      ? {
          grip,
          rollingResistance,
          drag,
          roughness: roughness ?? 0,
          ridgeHeight: ridgeHeight ?? 0,
          ridgeSpacing: ridgeSpacing ?? 0,
        }
      : { grip, rollingResistance, drag },
  );
}
