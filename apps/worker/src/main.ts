import path from "node:path";

import { loadWorkerConfig } from "@docomator/config";
import {
  ContentAddressedObjectStore,
  DocumentGenerationRegistry,
  SqliteStore,
  TemplatePreviewActivationRegistry,
  WorkerQueue
} from "@docomator/storage";

import { createDocumentGenerationHandler } from "./document-generation-handler.js";
import { runWorkerLoop } from "./loop.js";
import { JobHandlerRegistry, processNextJob } from "./processor.js";
import { createTemplatePreviewHandler } from "./template-preview-handler.js";

const config = loadWorkerConfig();
const controller = new AbortController();
const store = new SqliteStore({
  databasePath: path.join(config.dataDir, "docomator.db")
});
const objectStore = new ContentAddressedObjectStore(
  path.join(config.dataDir, "objects")
);
const queue = new WorkerQueue(store);
const previewRegistry = new TemplatePreviewActivationRegistry(
  store,
  objectStore,
  { queue }
);
const generationRegistry = new DocumentGenerationRegistry(
  store,
  objectStore,
  { queue }
);
const handlers = new JobHandlerRegistry();

handlers.register("system.noop", async () => undefined);
handlers.register(
  "template.preview",
  createTemplatePreviewHandler({
    registry: previewRegistry,
    objectStore,
    config
  })
);
handlers.register(
  "document.generate",
  createDocumentGenerationHandler({
    registry: generationRegistry,
    objectStore,
    workerId: config.workerId
  })
);

function log(
  level: "info" | "error",
  message: string,
  extra: Record<string, unknown> = {}
): void {
  process.stdout.write(
    `${JSON.stringify({
      level,
      service: "worker",
      message,
      version: config.version,
      workerId: config.workerId,
      timestamp: new Date().toISOString(),
      ...extra
    })}\n`
  );
}

function stop(signal: NodeJS.Signals): void {
  log("info", "shutdown requested", { signal });
  controller.abort();
}

process.once("SIGTERM", () => stop("SIGTERM"));
process.once("SIGINT", () => stop("SIGINT"));

try {
  log("info", "worker started", {
    pollIntervalMs: config.pollIntervalMs,
    leaseDurationMs: config.leaseDurationMs,
    llmEnabled: config.llmEnabled,
    previewEnabled: config.previewEnabled,
    libreOfficeBinary: path.basename(config.libreOfficeBinary)
  });

  await runWorkerLoop({
    pollIntervalMs: config.pollIntervalMs,
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    signal: controller.signal,
    onPoll: async () => {
      const result = await processNextJob({
        queue,
        handlers,
        workerId: config.workerId,
        leaseDurationMs: config.leaseDurationMs,
        retryBaseMs: config.retryBaseMs,
        retryMaxMs: config.retryMaxMs,
        signal: controller.signal
      });
      if (result.status !== "idle") {
        log("info", "worker job processed", {
          jobId: result.job.id,
          jobType: result.job.jobType,
          state: result.status,
          attempts: result.job.attempts
        });
      }
    },
    onHeartbeat: () => log("info", "worker heartbeat", { queueDepth: queue.getDepths() })
  });

  log("info", "worker stopped");
} catch (error) {
  log("error", "worker failed", {
    error: error instanceof Error ? error.message : String(error)
  });
  process.exitCode = 1;
} finally {
  store.close();
}
