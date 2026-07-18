import path from "node:path";

import {
  ContentAddressedObjectStore,
  DocumentGenerationRegistry,
  SqliteStore,
  WorkerQueue
} from "@docomator/storage";

import { createDocumentGenerationHandler } from "../../apps/worker/dist/document-generation-handler.js";
import {
  JobHandlerRegistry,
  processNextJob
} from "../../apps/worker/dist/processor.js";

const dataDir = process.env.DOCOMATOR_DATA_DIR;
if (typeof dataDir !== "string" || dataDir.length === 0) {
  throw new Error("DOCOMATOR_DATA_DIR is required");
}
const workerId = process.env.DOCOMATOR_WORKER_ID ?? "release-gate-crash-worker";
const store = new SqliteStore({
  databasePath: path.join(dataDir, "docomator.db")
});
const objectStore = new ContentAddressedObjectStore(path.join(dataDir, "objects"));
const queue = new WorkerQueue(store);
const registry = new DocumentGenerationRegistry(store, objectStore, { queue });
const originalCompleteUnit = registry.completeUnit.bind(registry);
let reported = false;

registry.completeUnit = async (...args) => {
  await originalCompleteUnit(...args);
  if (!reported) {
    reported = true;
    process.send?.({ type: "unit-completed", unitId: args[0] });
    await new Promise(() => undefined);
  }
};

const handlers = new JobHandlerRegistry();
handlers.register(
  "document.generate",
  createDocumentGenerationHandler({
    registry,
    objectStore,
    workerId
  })
);

try {
  const result = await processNextJob({
    queue,
    handlers,
    workerId,
    leaseDurationMs: 1_000,
    retryBaseMs: 100,
    retryMaxMs: 1_000,
    signal: new AbortController().signal
  });
  throw new Error(
    `Crash probe finished before it was terminated: ${result.status}`
  );
} finally {
  store.close();
}
