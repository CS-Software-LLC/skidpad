import type { Ghost } from "./ghost.js";
import { GHOST_STRIDE } from "./ghost.js";
import type { Replay, ReplayKeyframe } from "./replay.js";
import { SURFACE_STRIDE } from "./replay.js";

/**
 * Binary containers for replays and ghosts. Layout: a 4-byte magic, a u32
 * format version, a u32 length and a UTF-8 JSON header, then the binary
 * blocks the header describes, each starting on an 8-byte boundary, all
 * little-endian.
 *
 * A version 2 replay stores the recorded inputs as they are (48 bytes per
 * car per step) and everything that rarely changes (step lengths, levels of
 * detail and their rates, wheel surfaces) as runs, so a long recording is
 * close to 48 bytes per car per step plus its keyframes. {@link gzip}
 * typically shrinks that four to five times; a ghost's float poses barely
 * compress.
 */

const REPLAY_MAGIC = "SKRP";
const GHOST_MAGIC = "SKGH";

interface BlockRef {
  offset: number;
  length: number;
}

class Writer {
  private parts: Uint8Array[] = [];
  private size = 0;
  add(bytes: Uint8Array): BlockRef {
    const pad = (8 - (this.size % 8)) % 8;
    if (pad) this.push(new Uint8Array(pad));
    const ref = { offset: this.size, length: bytes.byteLength };
    this.push(bytes);
    return ref;
  }
  private push(b: Uint8Array): void {
    this.parts.push(b);
    this.size += b.byteLength;
  }
  finish(magic: string, version: number, header: unknown): Uint8Array {
    const json = new TextEncoder().encode(JSON.stringify(header));
    const start = 12 + json.byteLength;
    const bodyStart = start + ((8 - (start % 8)) % 8);
    const out = new Uint8Array(bodyStart + this.size);
    const dv = new DataView(out.buffer);
    for (let i = 0; i < 4; i++) out[i] = magic.charCodeAt(i);
    dv.setUint32(4, version, true);
    dv.setUint32(8, json.byteLength, true);
    out.set(json, 12);
    let o = bodyStart;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.byteLength;
    }
    return out;
  }
}

function bytesOf(a: Float64Array | Float32Array | Uint8Array): Uint8Array {
  return new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
}

function read(
  bytes: Uint8Array,
  magic: string,
): { version: number; header: unknown; body: Uint8Array } {
  if (bytes.byteLength < 12) throw new Error("data is too short");
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== magic.charCodeAt(i)) throw new Error(`not a ${magic} file`);
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = dv.getUint32(4, true);
  const len = dv.getUint32(8, true);
  if (12 + len > bytes.byteLength) throw new Error("header runs past the end of the data");
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + len))) as unknown;
  const start = 12 + len;
  const bodyStart = start + ((8 - (start % 8)) % 8);
  // Copy so typed views are aligned whatever the caller's buffer offset.
  const body = bytes.slice(bodyStart);
  return { version, header, body };
}

function block(body: Uint8Array, ref: BlockRef): Uint8Array {
  if (ref.offset + ref.length > body.byteLength)
    throw new Error("block runs past the end of the data");
  return body.subarray(ref.offset, ref.offset + ref.length);
}

function f64(body: Uint8Array, ref: BlockRef): Float64Array {
  const b = block(body, ref);
  return new Float64Array(b.buffer, b.byteOffset, b.byteLength / 8).slice();
}

/**
 * Run-length code `series` interleaved series of `length` values each,
 * stored value-major (`data[step * series + s]`): each series in turn as
 * `[value, count]` pairs.
 */
function encodeRuns(data: ArrayLike<number>, series: number, length: number): Float64Array {
  const out: number[] = [];
  for (let s = 0; s < series; s++) {
    let k = 0;
    while (k < length) {
      const v = data[k * series + s]!;
      let end = k + 1;
      while (end < length && Object.is(data[end * series + s], v)) end++;
      out.push(v, end - k);
      k = end;
    }
  }
  return Float64Array.from(out);
}

function decodeRuns<T extends Float64Array | Uint8Array>(
  runs: Float64Array,
  series: number,
  length: number,
  out: T,
): T {
  let r = 0;
  for (let s = 0; s < series; s++) {
    let k = 0;
    while (k < length) {
      const v = runs[r];
      const count = runs[r + 1];
      if (v === undefined || count === undefined || !(count > 0) || k + count > length) {
        throw new Error("replay runs do not match its step and vehicle counts");
      }
      for (let i = 0; i < count; i++) out[(k + i) * series + s] = v;
      k += count;
      r += 2;
    }
  }
  if (r !== runs.length) throw new Error("replay runs do not match its step and vehicle counts");
  return out;
}

interface ReplayHeader {
  coreVersion: string;
  simulationVersion?: string;
  startStep?: number;
  vehicles: number[];
  definitions?: unknown[];
  meta?: Record<string, unknown>;
  steps: number;
  /** Version 1: raw blocks. Version 2: runs (see {@link encodeRuns}). */
  dt: BlockRef;
  inputs: BlockRef;
  lod: BlockRef;
  lodRate: BlockRef;
  surfaces?: BlockRef;
  keyframes: { step: number; hashes: string[]; snapshots: BlockRef[]; state?: unknown }[];
}

/**
 * Encode a replay into one binary blob (format version 2 for a replay this
 * package recorded; a decoded version 1 replay is written back as version 1).
 */
export function encodeReplay(r: Replay): Uint8Array {
  const w = new Writer();
  const n = r.vehicles.length;
  const runs = r.version >= 2;
  const header: ReplayHeader = {
    coreVersion: r.coreVersion,
    vehicles: r.vehicles,
    steps: r.steps,
    dt: w.add(bytesOf(runs ? encodeRuns(r.dt, 1, r.steps) : r.dt)),
    inputs: w.add(bytesOf(r.inputs)),
    lod: w.add(runs ? bytesOf(encodeRuns(r.lod, n, r.steps)) : r.lod),
    lodRate: w.add(bytesOf(runs ? encodeRuns(r.lodRate, n, r.steps) : r.lodRate)),
    keyframes: r.keyframes.map((k) => {
      const kf: ReplayHeader["keyframes"][number] = {
        step: k.step,
        hashes: k.hashes,
        snapshots: k.snapshots.map((s) => w.add(s)),
      };
      if (k.state !== undefined) kf.state = k.state;
      return kf;
    }),
  };
  if (runs && r.surfaces) {
    header.surfaces = w.add(bytesOf(encodeRuns(r.surfaces, n * SURFACE_STRIDE, r.steps)));
  }
  if (r.simulationVersion) header.simulationVersion = r.simulationVersion;
  if (r.startStep !== undefined) header.startStep = r.startStep;
  if (r.definitions) header.definitions = r.definitions;
  if (r.meta) header.meta = r.meta;
  return w.finish(REPLAY_MAGIC, r.version, header);
}

/** Decode a blob from {@link encodeReplay} (format version 1 or 2). */
export function decodeReplay(bytes: Uint8Array): Replay {
  const { version, header, body } = read(bytes, REPLAY_MAGIC);
  const h = header as ReplayHeader;
  const n = h.vehicles.length;
  const runs = version >= 2;
  const keyframes: ReplayKeyframe[] = h.keyframes.map((k) => {
    const kf: ReplayKeyframe = {
      step: k.step,
      hashes: k.hashes,
      snapshots: k.snapshots.map((s) => block(body, s).slice()),
    };
    if (k.state !== undefined) kf.state = k.state;
    return kf;
  });
  const r: Replay = {
    version,
    coreVersion: h.coreVersion,
    vehicles: h.vehicles,
    steps: h.steps,
    dt: runs ? decodeRuns(f64(body, h.dt), 1, h.steps, new Float64Array(h.steps)) : f64(body, h.dt),
    inputs: f64(body, h.inputs),
    lod: runs
      ? decodeRuns(f64(body, h.lod), n, h.steps, new Uint8Array(h.steps * n))
      : block(body, h.lod).slice(),
    lodRate: runs
      ? decodeRuns(f64(body, h.lodRate), n, h.steps, new Float64Array(h.steps * n))
      : f64(body, h.lodRate),
    keyframes,
  };
  if (runs && h.surfaces) {
    const series = n * SURFACE_STRIDE;
    r.surfaces = decodeRuns(
      f64(body, h.surfaces),
      series,
      h.steps,
      new Uint8Array(h.steps * series),
    );
  }
  if (h.simulationVersion) r.simulationVersion = h.simulationVersion;
  if (h.startStep !== undefined) r.startStep = h.startStep;
  if (h.definitions) r.definitions = h.definitions as NonNullable<Replay["definitions"]>;
  if (h.meta) r.meta = h.meta;
  if (
    r.dt.length !== r.steps ||
    r.inputs.length !== r.steps * n * 6 ||
    r.lod.length !== r.steps * n ||
    r.lodRate.length !== r.steps * n
  ) {
    throw new Error("replay blocks do not match its step and vehicle counts");
  }
  return r;
}

async function pipe(bytes: Uint8Array, stream: GenericTransformStream): Promise<Uint8Array> {
  const piped = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

/**
 * Gzip bytes (an encoded replay or ghost) with the platform's
 * `CompressionStream`, for upload or storage. Browsers and Node 18+.
 */
export function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  return pipe(bytes, new CompressionStream("gzip"));
}

/** Undo {@link gzip}. */
export function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  return pipe(bytes, new DecompressionStream("gzip"));
}

interface GhostHeader {
  meta?: Record<string, unknown>;
  frames: BlockRef;
}

/** Encode a ghost into one binary blob. */
export function encodeGhost(g: Ghost): Uint8Array {
  const w = new Writer();
  const header: GhostHeader = { frames: w.add(bytesOf(g.frames)) };
  if (g.meta) header.meta = g.meta;
  return w.finish(GHOST_MAGIC, g.version, header);
}

/** Decode a blob from {@link encodeGhost}. */
export function decodeGhost(bytes: Uint8Array): Ghost {
  const { version, header, body } = read(bytes, GHOST_MAGIC);
  const h = header as GhostHeader;
  const b = block(body, h.frames);
  const frames = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice();
  if (frames.length % GHOST_STRIDE !== 0) throw new Error("ghost frames are not whole");
  const g: Ghost = { version, frames };
  if (h.meta) g.meta = h.meta;
  return g;
}
