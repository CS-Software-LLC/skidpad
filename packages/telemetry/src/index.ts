/**
 * @contactpatch/telemetry — a ring-buffer recorder for telemetry records and
 * exporters to CSV and JSON. Channel names follow iRacing / Assetto Corsa
 * conventions where equivalents exist so external tools can diff exports.
 */

export interface Channel {
  name: string;
  unit: string;
}

export interface RecorderOptions {
  /** Channels in record order. */
  channels: readonly Channel[];
  /** Capacity in samples. Default is 60 s at 60 Hz. */
  capacity?: number;
}

/** Fixed-capacity ring buffer of flat `f64` records. No allocation on write. */
export class TelemetryRecorder {
  readonly channels: readonly Channel[];
  readonly capacity: number;
  private readonly stride: number;
  private readonly data: Float64Array;
  private head = 0;
  private count = 0;
  private readonly index: Map<string, number>;

  constructor(options: RecorderOptions) {
    this.channels = options.channels;
    this.capacity = Math.max(1, options.capacity ?? 60 * 60);
    this.stride = options.channels.length;
    this.data = new Float64Array(this.capacity * this.stride);
    this.index = new Map(options.channels.map((c, i) => [c.name, i]));
  }

  get length(): number {
    return this.count;
  }

  /** Append one record (a view into WASM memory is fine; it is copied). */
  record(record: ArrayLike<number>): void {
    const o = this.head * this.stride;
    for (let i = 0; i < this.stride; i++) this.data[o + i] = record[i] ?? NaN;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }

  /** Sample `i` counted from the oldest retained sample. */
  sample(i: number): Float64Array {
    if (i < 0 || i >= this.count) throw new RangeError(`sample ${i} out of range (${this.count})`);
    const start = (this.head - this.count + this.capacity) % this.capacity;
    const o = ((start + i) % this.capacity) * this.stride;
    return this.data.subarray(o, o + this.stride);
  }

  /** The most recent sample, or undefined when empty. */
  latest(): Float64Array | undefined {
    return this.count === 0 ? undefined : this.sample(this.count - 1);
  }

  channelIndex(name: string): number {
    const i = this.index.get(name);
    if (i === undefined) throw new Error(`unknown channel "${name}"`);
    return i;
  }

  /** Copy one channel's history, oldest first. */
  series(name: string, out?: Float64Array): Float64Array {
    const ci = this.channelIndex(name);
    const res = out && out.length >= this.count ? out : new Float64Array(this.count);
    for (let i = 0; i < this.count; i++) res[i] = this.sample(i)[ci] ?? NaN;
    return res;
  }

  /** Export as CSV with a header row of `Name [unit]`. */
  toCSV(options: { precision?: number } = {}): string {
    const p = options.precision ?? 6;
    const header = this.channels.map((c) => `${c.name} [${c.unit}]`).join(",");
    const lines = [header];
    for (let i = 0; i < this.count; i++) {
      const s = this.sample(i);
      const row = new Array<string>(this.stride);
      for (let j = 0; j < this.stride; j++) row[j] = formatNumber(s[j] ?? NaN, p);
      lines.push(row.join(","));
    }
    return lines.join("\n") + "\n";
  }

  /** Export as a JSON document: channel metadata plus column arrays. */
  toJSON(): { channels: Channel[]; samples: number; data: Record<string, number[]> } {
    const data: Record<string, number[]> = {};
    this.channels.forEach((c) => {
      data[c.name] = Array.from(this.series(c.name));
    });
    return { channels: this.channels.map((c) => ({ ...c })), samples: this.count, data };
  }
}

function formatNumber(v: number, precision: number): string {
  if (!Number.isFinite(v)) return "";
  const s = v.toFixed(precision);
  // Trim trailing zeros for compactness while keeping it parseable.
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/** Parse a CSV produced by {@link TelemetryRecorder.toCSV}. */
export function parseCSV(text: string): { channels: Channel[]; rows: number[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return { channels: [], rows: [] };
  const channels = lines[0]!.split(",").map((h) => {
    const m = /^(.*?) \[(.*)\]$/.exec(h);
    return m ? { name: m[1]!, unit: m[2]! } : { name: h, unit: "" };
  });
  const rows = lines.slice(1).map((l) => l.split(",").map((v) => (v === "" ? NaN : Number(v))));
  return { channels, rows };
}
