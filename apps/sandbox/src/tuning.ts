/**
 * The fields of a vehicle definition for the tuning panel. The definition
 * is walked generically; each scalar is paired with its entry in the JSON
 * Schema (`@skidpad/core/schema`) for the tooltip, the bounds and the enum
 * options. `$ref`s into `$defs` are followed and `oneOf` alternatives are
 * picked by their `const` discriminator (`tire.model`, `powerUnit.kind`).
 */
import type { VehicleDefinition } from "@skidpad/core";
import schema from "@skidpad/core/schema" with { type: "json" };

type SchemaNode = Record<string, unknown>;
export type FieldPath = (string | number)[];

export interface Field {
  /** Path from the definition root, e.g. `["axles", 0, "tire", "radius"]`. */
  path: FieldPath;
  key: string;
  label: string;
  kind: "number" | "boolean" | "enum" | "const" | "list";
  value: unknown;
  /** `enum` fields: the choices. */
  options?: string[];
  /** `number` fields: the input step, from the magnitude of the value. */
  step?: number;
  min?: number;
  max?: number;
  tooltip: string;
}

export interface FieldGroup {
  title: string;
  fields: Field[];
}

/** Top-level keys the panel does not edit. */
const SKIP = new Set(["formatVersion", "name", "dataSheet"]);
const AXLE_NAMES = ["Front", "Rear", "Third", "Fourth"];

/** Readable names where splitting the camelCase is not enough. */
const LABELS: Record<string, string> = {
  abs: "ABS",
  cgHeight: "CG height",
  cgToFrontAxle: "CG to front axle",
  fz0: "Fz0",
  longvl: "Reference speed (longvl)",
  lsd: "LSD",
  maxRpm: "Max rpm",
  idleRpm: "Idle rpm",
  redlineRpm: "Redline rpm",
  clutchBiteRpm: "Clutch bite rpm",
  substepRateHz: "Substep rate Hz",
};

/** Group titles for nested blocks whose key alone would be unclear. */
const TITLES: Record<string, string> = {
  "drivetrain.powerUnit": "Power unit",
  "drivetrain.transmission": "Transmission",
  "drivetrain.front": "Front differential",
  "drivetrain.rear": "Rear differential",
  "drivetrain.center": "Centre differential",
};

const root = schema as SchemaNode;
const defs = (root.$defs ?? {}) as Record<string, SchemaNode>;

/** `camelCaseName` → `Camel case name`. */
export function readable(key: string): string {
  const known = LABELS[key];
  if (known) return known;
  const words = key
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Follow `$ref`s and pick the `oneOf` alternative whose `const`s match `value`. */
function resolve(node: unknown, value: unknown): SchemaNode | undefined {
  let n = node;
  for (let guard = 0; guard < 8 && isObject(n); guard++) {
    const ref = n.$ref;
    if (typeof ref === "string") {
      const m = /^#\/\$defs\/(.+)$/.exec(ref);
      n = m ? defs[m[1]!] : undefined;
      continue;
    }
    const alts = n.oneOf ?? n.anyOf;
    if (Array.isArray(alts)) {
      const match = alts.map((a) => resolve(a, value)).find((a) => a && discriminates(a, value));
      n = match ?? resolve(alts[0], value);
      if (!isObject(n) || n.oneOf || n.anyOf) return isObject(n) ? n : undefined;
      continue;
    }
    return n;
  }
  return isObject(n) ? n : undefined;
}

function discriminates(alt: SchemaNode, value: unknown): boolean {
  if (!isObject(value) || !isObject(alt.properties)) return false;
  const consts = Object.entries(alt.properties).filter(
    ([, p]) => isObject(p) && p.const !== undefined,
  );
  return consts.length > 0 && consts.every(([k, p]) => value[k] === (p as SchemaNode).const);
}

function propertySchema(node: SchemaNode | undefined, key: string, value: unknown) {
  if (!node) return undefined;
  const props = isObject(node.properties) ? node.properties : undefined;
  const own = props?.[key];
  if (own !== undefined) return resolve(own, value);
  return resolve(node.additionalProperties, value);
}

/** A step near 1 % of the magnitude, as a power of ten. */
export function niceStep(value: number, fallback?: number): number {
  const ref = Math.abs(value) || Math.abs(fallback ?? 0) || 1;
  const exp = Math.min(3, Math.max(-6, Math.round(Math.log10(ref)) - 2));
  return Number((10 ** exp).toFixed(6));
}

function tooltip(key: string, node: SchemaNode | undefined): string {
  const parts: string[] = [];
  const d = node?.description;
  parts.push(typeof d === "string" ? d : `${key}`);
  if (node?.default !== undefined && !Array.isArray(node.default))
    parts.push(`default ${String(node.default)}`);
  const min = node?.minimum ?? node?.exclusiveMinimum;
  const max = node?.maximum ?? node?.exclusiveMaximum;
  if (typeof min === "number" || typeof max === "number")
    parts.push(
      `range ${typeof min === "number" ? min : "…"} to ${typeof max === "number" ? max : "…"}`,
    );
  return parts.join(" · ");
}

function scalarField(path: FieldPath, key: string, value: unknown, node?: SchemaNode): Field {
  const base = { path, key, label: readable(key), value, tooltip: tooltip(key, node) };
  if (typeof value === "boolean") return { ...base, kind: "boolean" };
  if (typeof value === "number") {
    const f: Field = {
      ...base,
      kind: "number",
      step: niceStep(value, typeof node?.default === "number" ? node.default : undefined),
    };
    if (typeof node?.minimum === "number") f.min = node.minimum;
    if (typeof node?.maximum === "number") f.max = node.maximum;
    return f;
  }
  if (Array.isArray(node?.enum)) return { ...base, kind: "enum", options: node.enum.map(String) };
  if (Array.isArray(value)) return { ...base, kind: "list" };
  return { ...base, kind: "const" };
}

/**
 * Group the editable fields of a definition by section: the top-level
 * blocks, each nested block ("Drivetrain · Transmission"), and per axle
 * "Front axle", "Front tire", "Front suspension".
 */
export function definitionGroups(def: VehicleDefinition): FieldGroup[] {
  const groups: FieldGroup[] = [];
  const walk = (
    value: Record<string, unknown>,
    node: SchemaNode | undefined,
    path: FieldPath,
    title: string,
    childTitle: (key: string) => string,
  ): void => {
    const fields: Field[] = [];
    const nested: Array<() => void> = [];
    for (const [key, v] of Object.entries(value)) {
      if (path.length === 0 && SKIP.has(key)) continue;
      if (v === undefined || v === null) continue;
      const sub = propertySchema(node, key, v);
      const p = [...path, key];
      if (Array.isArray(v) && v.every(isObject)) {
        const items = resolve(sub?.items, v[0]);
        v.forEach((item, i) => {
          // "Front axle", "Front tire", "Front suspension".
          const name =
            key === "axles" ? (AXLE_NAMES[i] ?? `Axle ${i + 1}`) : `${readable(key)} ${i + 1}`;
          const singular = readable(key).toLowerCase().replace(/s$/, "");
          nested.push(() =>
            walk(
              item,
              resolve(items, item),
              [...p, i],
              `${name} ${singular}`,
              (k) => `${name} ${readable(k).toLowerCase()}`,
            ),
          );
        });
      } else if (isObject(v)) {
        const title = TITLES[p.join(".")] ?? childTitle(key);
        nested.push(() => walk(v, sub, p, title, (k) => `${title} · ${readable(k)}`));
      } else {
        fields.push(scalarField(p, key, v, sub));
      }
    }
    if (fields.length > 0) groups.push({ title, fields });
    for (const n of nested) n();
  };
  walk(def as unknown as Record<string, unknown>, root, [], "Vehicle", (k) => readable(k));
  return groups;
}

/** A copy of `def` with the value at `path` replaced. */
export function withValue(
  def: VehicleDefinition,
  path: FieldPath,
  value: unknown,
): VehicleDefinition {
  const next = structuredClone(def) as unknown as Record<string, unknown>;
  let cursor: unknown = next;
  for (let i = 0; i < path.length - 1; i++) {
    cursor = (cursor as Record<string | number, unknown>)[path[i]!];
  }
  (cursor as Record<string | number, unknown>)[path[path.length - 1]!] = value;
  return next as unknown as VehicleDefinition;
}
