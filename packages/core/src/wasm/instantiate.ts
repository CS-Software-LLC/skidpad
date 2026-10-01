import type { CpExports } from "./abi.js";

/** Anything that can become a compiled module. */
export type WasmSource =
  WebAssembly.Module | ArrayBuffer | Uint8Array | Response | Promise<Response> | URL | string;

function isNode(): boolean {
  return (
    typeof process !== "undefined" &&
    typeof process.versions === "object" &&
    typeof process.versions.node === "string"
  );
}

async function readNodeFile(path: string | URL): Promise<Uint8Array> {
  // Specifiers are built at runtime so bundlers do not try to resolve the
  // Node built-ins for browser targets.
  const fsName = "node:fs/promises";
  const urlName = "node:url";
  const { readFile } = (await import(/* @vite-ignore */ fsName)) as {
    readFile(p: string | URL): Promise<Uint8Array>;
  };
  const { fileURLToPath } = (await import(/* @vite-ignore */ urlName)) as {
    fileURLToPath(u: string | URL): string;
  };
  const p = typeof path === "string" && path.startsWith("file:") ? fileURLToPath(path) : path;
  return readFile(p instanceof URL ? fileURLToPath(p) : p);
}

async function toBytesOrModule(source: WasmSource): Promise<WebAssembly.Module | BufferSource> {
  if (source instanceof WebAssembly.Module) return source;
  if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) return source;
  if (source instanceof URL || typeof source === "string") {
    const isFile = source instanceof URL ? source.protocol === "file:" : source.startsWith("file:");
    if (isNode() && (isFile || !/^https?:/.test(String(source)))) {
      return readNodeFile(source);
    }
    const res = await fetch(source);
    if (!res.ok) throw new Error(`failed to fetch WASM from ${String(source)}: ${res.status}`);
    if (
      typeof WebAssembly.compileStreaming === "function" &&
      res.headers.get("content-type")?.includes("application/wasm")
    ) {
      return WebAssembly.compileStreaming(res);
    }
    return res.arrayBuffer();
  }
  const res = await source;
  if (
    typeof WebAssembly.compileStreaming === "function" &&
    res.headers.get("content-type")?.includes("application/wasm")
  ) {
    return WebAssembly.compileStreaming(res);
  }
  return res.arrayBuffer();
}

/** Compile and instantiate the core module. The module has no imports. */
export async function instantiateCore(source: WasmSource): Promise<CpExports> {
  const compiled = await toBytesOrModule(source);
  const module =
    compiled instanceof WebAssembly.Module ? compiled : await WebAssembly.compile(compiled);
  const instance = await WebAssembly.instantiate(module, {});
  return instance.exports as unknown as CpExports;
}

/** Decode a base64 string into bytes without depending on Node's Buffer. */
export function decodeBase64(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Node without atob (very old) — fall back to Buffer.
  const g = globalThis as unknown as { Buffer?: { from(s: string, e: string): Uint8Array } };
  if (g.Buffer) return g.Buffer.from(b64, "base64");
  throw new Error("no base64 decoder available");
}
