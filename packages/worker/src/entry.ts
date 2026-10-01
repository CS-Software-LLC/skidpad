/**
 * Worker entry: `import "@skidpad/worker/entry"` as the whole body of a
 * worker module, or point `new Worker` at this file. It serves one world on
 * the worker's own message channel.
 */
import { serveWorld } from "./serve.js";
import type { Endpoint } from "./protocol.js";

serveWorld(globalThis as unknown as Endpoint);
