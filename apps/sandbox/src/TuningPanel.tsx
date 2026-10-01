/**
 * Live tuning: every scalar of the running definition as an input, applied
 * to the car as it drives (the core keeps the state across a definition
 * swap). Invalid edits are reported and not applied. The definition can be
 * reset to its preset, copied, downloaded, or replaced from a JSON file.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { validateDefinition, type VehicleDefinition } from "@skidpad/core";
import type { Sim } from "./sim.js";
import { download } from "./record.js";
import { definitionGroups, withValue, type Field, type FieldPath } from "./tuning.js";

const APPLY_DELAY_MS = 100;

export function TuningPanel({
  sim,
  revision,
  onApplied,
}: {
  sim: Sim;
  /** Bumped by the app when the definition changed outside this panel. */
  revision: number;
  /** Called after an edit went live, so the rest of the app can re-render. */
  onApplied: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<VehicleDefinition>(() => structuredClone(sim.definition));
  const [filter, setFilter] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const latest = useRef(draft);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement | null>(null);

  // Re-read the live definition when the preset changes, when something
  // else applied one, and whenever the panel opens.
  useEffect(() => {
    const d = structuredClone(sim.definition);
    latest.current = d;
    setDraft(d);
  }, [sim, revision, open]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const groups = useMemo(() => definitionGroups(draft), [draft]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({
        title: g.title,
        fields: g.title.toLowerCase().includes(q)
          ? g.fields
          : g.fields.filter(
              (f) => f.label.toLowerCase().includes(q) || f.key.toLowerCase().includes(q),
            ),
      }))
      .filter((g) => g.fields.length > 0);
  }, [groups, filter]);

  /** Validate and apply the given definition now. */
  const apply = (def: VehicleDefinition, note = ""): boolean => {
    const v = validateDefinition(def);
    setWarnings(v.warnings);
    if (!v.ok) {
      setErrors(v.errors);
      return false;
    }
    try {
      sim.applyDefinition(structuredClone(def));
    } catch (e) {
      setErrors([String(e)]);
      return false;
    }
    setErrors([]);
    setMessage(note);
    onApplied();
    return true;
  };

  const edit = (path: FieldPath, value: unknown): void => {
    const next = withValue(latest.current, path, value);
    latest.current = next;
    setDraft(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => apply(latest.current), APPLY_DELAY_MS);
  };

  const replace = (def: VehicleDefinition, note: string): void => {
    clearTimeout(timer.current);
    latest.current = def;
    setDraft(def);
    apply(def, note);
  };

  const loadFile = async (file: File): Promise<void> => {
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
        throw new Error("not a JSON object");
      replace(parsed as VehicleDefinition, `Loaded ${file.name}.`);
    } catch (e) {
      setErrors([`${file.name}: ${String(e)}`]);
    }
  };

  const json = () => JSON.stringify(draft, null, 2);
  const fileName = () =>
    `${(draft.name || sim.presetId).toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`;

  return (
    <div className={`panel${open ? " open" : ""}`}>
      <button className="panel-toggle" onClick={() => setOpen(!open)}>
        {open ? "Close tuning" : "Tuning"}
      </button>
      {open && (
        <div className="panel-body tuning">
          <div className="row">
            <button onClick={() => replace(sim.presetDefinition(sim.presetId), "Reset to preset.")}>
              Reset to preset
            </button>
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(json());
                setMessage("Copied the definition as JSON.");
              }}
            >
              Copy JSON
            </button>
            <button
              onClick={() => download(new Blob([json()], { type: "application/json" }), fileName())}
            >
              Download JSON
            </button>
            <button onClick={() => fileInput.current?.click()}>Load JSON…</button>
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void loadFile(f);
              }}
            />
          </div>
          <div className="row">
            <input
              className="tuning-filter"
              type="search"
              placeholder="Filter fields…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          {errors.length > 0 && (
            <div className="row error">
              Not applied:{"\n"}
              {errors.join("\n")}
            </div>
          )}
          {warnings.length > 0 && <div className="row message">{warnings.join("\n")}</div>}
          {message && errors.length === 0 && <div className="row small">{message}</div>}
          {shown.map((g) => (
            <section key={g.title}>
              <h2>{g.title}</h2>
              <div className="tuning-grid">
                {g.fields.map((f) => (
                  <FieldRow key={f.path.join(".")} field={f} onChange={(v) => edit(f.path, v)} />
                ))}
              </div>
            </section>
          ))}
          {shown.length === 0 && <div className="row small">No field matches the filter.</div>}
        </div>
      )}
    </div>
  );
}

function FieldRow({ field, onChange }: { field: Field; onChange: (value: unknown) => void }) {
  const id = `tune-${field.path.join("-")}`;
  const label = (
    <label htmlFor={id} title={field.tooltip}>
      {field.label}
    </label>
  );
  switch (field.kind) {
    case "number":
      return (
        <>
          {label}
          <NumberInput id={id} field={field} onChange={onChange} />
        </>
      );
    case "boolean":
      return (
        <>
          {label}
          <input
            id={id}
            type="checkbox"
            checked={field.value === true}
            onChange={(e) => onChange(e.target.checked)}
          />
        </>
      );
    case "enum":
      return (
        <>
          {label}
          <select id={id} value={String(field.value)} onChange={(e) => onChange(e.target.value)}>
            {field.options?.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </>
      );
    case "list":
      return (
        <>
          {label}
          <textarea
            id={id}
            readOnly
            rows={Math.min(4, 1 + Math.ceil(JSON.stringify(field.value).length / 56))}
            value={JSON.stringify(field.value)}
            title={`${field.tooltip} · read-only here; edit the JSON to change it`}
          />
        </>
      );
    default:
      return (
        <>
          {label}
          <span className="const" title={field.tooltip}>
            {String(field.value)}
          </span>
        </>
      );
  }
}

/**
 * A number input that keeps what the user typed ("1.", "-") while only
 * passing on finite values, and follows the field when it changes outside.
 */
function NumberInput({
  id,
  field,
  onChange,
}: {
  id: string;
  field: Field;
  onChange: (value: number) => void;
}) {
  const value = field.value as number;
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText((t) => (Number(t) === value ? t : String(value)));
  }, [value]);
  return (
    <input
      id={id}
      type="number"
      step={field.step}
      min={field.min}
      max={field.max}
      value={text}
      onChange={(e) => {
        const s = e.target.value;
        setText(s);
        const n = Number(s);
        if (s.trim() !== "" && Number.isFinite(n)) onChange(n);
      }}
    />
  );
}
