// A real worker thread serving a world, from the built package.
import { parentPort } from "node:worker_threads";
import { serveWorld, nodeEndpoint } from "../../dist/index.js";

serveWorld(nodeEndpoint(parentPort));
