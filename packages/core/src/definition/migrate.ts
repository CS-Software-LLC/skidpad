import type { PartialVehicleDefinition } from "./types.js";
import { CURRENT_FORMAT_VERSION } from "./types.js";

type Migration = (def: Record<string, unknown>) => Record<string, unknown>;

/**
 * Forward migrations, keyed by the version they migrate *from*. Every format
 * change ships one. Version 0 is the pre-release format, which is identical
 * to version 1 apart from the field itself.
 */
const MIGRATIONS: Record<number, Migration> = {
  0: (def) => ({ ...def, formatVersion: 1 }),
};

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

/**
 * Bring a definition of any supported past version up to the current format.
 * Returns a new object; the input is not mutated. A definition without a
 * `formatVersion` is treated as version 0.
 */
export function migrateDefinition(input: unknown): PartialVehicleDefinition {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new MigrationError("definition must be a JSON object");
  }
  let def: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  let version = typeof def.formatVersion === "number" ? def.formatVersion : 0;
  if (version > CURRENT_FORMAT_VERSION) {
    throw new MigrationError(
      `definition formatVersion ${version} is newer than this package supports (${CURRENT_FORMAT_VERSION}); upgrade @skidpad/core`,
    );
  }
  while (version < CURRENT_FORMAT_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) throw new MigrationError(`no migration from formatVersion ${version}`);
    def = step(def);
    version = def.formatVersion as number;
  }
  return def as PartialVehicleDefinition;
}

/** True when the definition is already at the current format version. */
export function isCurrentFormat(def: unknown): boolean {
  return (
    typeof def === "object" &&
    def !== null &&
    (def as { formatVersion?: unknown }).formatVersion === CURRENT_FORMAT_VERSION
  );
}
