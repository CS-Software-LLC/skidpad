import type { Ghost } from "./ghost.js";
import { GHOST_STRIDE } from "./ghost.js";
import type { Replay, ReplayKeyframe } from "./replay.js";

/**
 * Binary containers for replays and ghosts. Layout: a 4-byte magic, a u32
 * format version, a u32 length and a UTF-8 JSON header, then the binary
 * blocks the header describes, each starting on an 8-byte boundary, all
 * little-endian. Compress with `CompressionStream("gzip")` if size matters:
 * recorded inputs compress well.
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

interface ReplayHeader {
  coreVersion: string;
  vehicles: number[];
  definitions?: unknown[];
  meta?: Record<string, unknown>;
  steps: number;
  dt: BlockRef;
  inputs: BlockRef;
  lod: BlockRef;
  lodRate: BlockRef;
  keyframes: { step: number; hashes: string[]; snapshots: BlockRef[] }[];
}

/** Encode a replay into one binary blob. */
export function encodeReplay(r: Replay): Uint8Array {
  const w = new Writer();
  const header: ReplayHeader = {
    coreVersion: r.coreVersion,
    vehicles: r.vehicles,
    steps: r.steps,
    dt: w.add(bytesOf(r.dt)),
    inputs: w.add(bytesOf(r.inputs)),
    lod: w.add(r.lod),
    lodRate: w.add(bytesOf(r.lodRate)),
    keyframes: r.keyframes.map((k) => ({
      step: k.step,
      hashes: k.hashes,
      snapshots: k.snapshots.map((s) => w.add(s)),
    })),
  };
  if (r.definitions) header.definitions = r.definitions;
  if (r.meta) header.meta = r.meta;
  return w.finish(REPLAY_MAGIC, r.version, header);
}

/** Decode a blob from {@link encodeReplay}. */
export function decodeReplay(bytes: Uint8Array): Replay {
  const { version, header, body } = read(bytes, REPLAY_MAGIC);
  const h = header as ReplayHeader;
  const keyframes: ReplayKeyframe[] = h.keyframes.map((k) => ({
    step: k.step,
    hashes: k.hashes,
    snapshots: k.snapshots.map((s) => block(body, s).slice()),
  }));
  const r: Replay = {
    version,
    coreVersion: h.coreVersion,
    vehicles: h.vehicles,
    steps: h.steps,
    dt: f64(body, h.dt),
    inputs: f64(body, h.inputs),
    lod: block(body, h.lod).slice(),
    lodRate: f64(body, h.lodRate),
    keyframes,
  };
  if (h.definitions) r.definitions = h.definitions as NonNullable<Replay["definitions"]>;
  if (h.meta) r.meta = h.meta;
  const n = r.vehicles.length;
  if (
    r.dt.length !== r.steps ||
    r.inputs.length !== r.steps * n * 6 ||
    r.lod.length !== r.steps * n
  ) {
    throw new Error("replay blocks do not match its step and vehicle counts");
  }
  return r;
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
