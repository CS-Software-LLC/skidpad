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
 */
export const surfaces: readonly NamedSurface[] = [
  {
    id: "asphaltDry",
    name: "Dry asphalt",
    grip: 1,
    rollingResistance: 1,
    drag: 0,
    source: "The reference surface the tire parameters describe.",
  },
  {
    id: "concrete",
    name: "Concrete",
    grip: 0.95,
    rollingResistance: 0.9,
    drag: 0,
    source:
      "Wong ch. 1: peak coefficients on dry concrete a little below dry asphalt; rolling resistance slightly lower.",
  },
  {
    id: "asphaltWet",
    name: "Wet asphalt",
    grip: 0.65,
    rollingResistance: 1.1,
    drag: 0,
    source:
      "Gillespie ch. 10: wet pavement peak 0.5–0.8 of dry depending on tread depth and speed; the middle of that range.",
  },
  {
    id: "cobbles",
    name: "Cobblestones",
    grip: 0.75,
    rollingResistance: 1.6,
    drag: 0,
    source: "Wong ch. 1: dry cobbles 0.6–0.8 of asphalt; rolling resistance well above asphalt.",
  },
  {
    id: "gravel",
    name: "Gravel",
    grip: 0.6,
    rollingResistance: 2,
    drag: 0.02,
    source:
      "Wong ch. 1: loose gravel 0.55–0.65; rolling resistance about twice asphalt; light ploughing.",
  },
  {
    id: "dirt",
    name: "Packed dirt",
    grip: 0.65,
    rollingResistance: 1.5,
    drag: 0.01,
    source: "Wong ch. 1: hard-packed earth road 0.6–0.7 of asphalt.",
  },
  {
    id: "grass",
    name: "Grass",
    grip: 0.45,
    rollingResistance: 2.5,
    drag: 0.03,
    source: "Wong ch. 1: dry grass 0.4–0.5; soft ground raises the rolling resistance severalfold.",
  },
  {
    id: "sand",
    name: "Sand",
    grip: 0.4,
    rollingResistance: 3,
    drag: 0.12,
    source:
      "Wong ch. 2: the motion resistance of a tire sinking into loose sand is of the order of a tenth of the load.",
  },
  {
    id: "snow",
    name: "Packed snow",
    grip: 0.3,
    rollingResistance: 1.5,
    drag: 0.04,
    source: "Wong ch. 1, Gillespie ch. 10: packed snow 0.2–0.35.",
  },
  {
    id: "ice",
    name: "Ice",
    grip: 0.12,
    rollingResistance: 0.8,
    drag: 0,
    source: "Wong ch. 1, Gillespie ch. 10: smooth ice near freezing 0.1–0.15.",
  },
  {
    id: "kerb",
    name: "Kerb",
    grip: 0.9,
    rollingResistance: 1.2,
    drag: 0,
    source: "Painted concrete kerbing, a little below dry asphalt.",
  },
];

export const surfaceIds: readonly SurfaceId[] = surfaces.map((s) => s.id);

/** The numeric id (table index) of a named surface. */
export function surfaceId(id: SurfaceId): number {
  const i = surfaces.findIndex((s) => s.id === id);
  return i < 0 ? 0 : i;
}

/** The table as plain `{grip, rollingResistance, drag}` entries for `World.setSurfaces()`. */
export function surfaceTable(): SurfaceDefinition[] {
  return surfaces.map(({ grip, rollingResistance, drag }) => ({ grip, rollingResistance, drag }));
}
