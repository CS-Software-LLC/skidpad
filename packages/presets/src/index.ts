/**
 * @contactpatch/presets — reference vehicle definitions. Each carries a
 * `dataSheet` with its sources; see `data/PROVENANCE.md` in the repository.
 */
import type { VehicleDefinition } from "@contactpatch/core";
import hatchbackFwd from "./vehicles/hatchback-fwd.json" with { type: "json" };
import sportsRwd from "./vehicles/sports-rwd.json" with { type: "json" };
import kart from "./vehicles/kart.json" with { type: "json" };

export const presets = {
  hatchbackFwd: hatchbackFwd as VehicleDefinition,
  sportsRwd: sportsRwd as VehicleDefinition,
  kart: kart as VehicleDefinition,
} as const;

export type PresetId = keyof typeof presets;

export const presetIds = Object.keys(presets) as PresetId[];

/** Deep-clone a preset so callers can edit it freely. */
export function preset(id: PresetId): VehicleDefinition {
  return structuredClone(presets[id]);
}

/**
 * Surface presets land in milestone 6. The table is declared now so the
 * definition format and the host contract can reference surface IDs.
 */
export interface SurfaceDefinition {
  id: string;
  name: string;
  gripScale: number;
  rollingResistanceScale: number;
}

export const surfaces: readonly SurfaceDefinition[] = [
  { id: "asphalt-dry", name: "Dry asphalt", gripScale: 1.0, rollingResistanceScale: 1.0 },
];
