/**
 * Best lap and its ghost per preset, in `localStorage`. Every access is
 * guarded: in a private window or with storage blocked the circuit still
 * works, it just forgets.
 */
import { decodeGhost, encodeGhost, gunzip, gzip, type Ghost } from "@skidpad/replay";
import type { LapRecord } from "./timing.js";

const PREFIX = "skidpad.sandbox.circuit.v1.";

interface Stored {
  time: number;
  sectors: [number, number, number];
  profile: number[];
  /** Base64 of the gzipped, encoded ghost. */
  ghost?: string;
}

export interface StoredBest {
  lap: LapRecord;
  ghost: Ghost | null;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function loadBest(key: string): Promise<StoredBest | null> {
  let raw: string | null = null;
  try {
    raw = globalThis.localStorage?.getItem(PREFIX + key) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Stored;
    const lap: LapRecord = {
      time: s.time,
      sectors: s.sectors,
      valid: true,
      profile: new Float32Array(s.profile),
    };
    const ghost = s.ghost ? decodeGhost(await gunzip(fromBase64(s.ghost))) : null;
    return { lap, ghost };
  } catch {
    return null;
  }
}

export async function saveBest(key: string, lap: LapRecord, ghost: Ghost | null): Promise<void> {
  const s: Stored = { time: lap.time, sectors: lap.sectors, profile: Array.from(lap.profile) };
  try {
    if (ghost) s.ghost = toBase64(await gzip(encodeGhost(ghost)));
    globalThis.localStorage?.setItem(PREFIX + key, JSON.stringify(s));
  } catch {
    // Full or blocked: try once more without the ghost, then give up.
    try {
      delete s.ghost;
      globalThis.localStorage?.setItem(PREFIX + key, JSON.stringify(s));
    } catch {
      /* the circuit works without storage */
    }
  }
}

export function clearBest(key: string): void {
  try {
    globalThis.localStorage?.removeItem(PREFIX + key);
  } catch {
    /* nothing stored, nothing to clear */
  }
}
