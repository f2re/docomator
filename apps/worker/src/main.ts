import path from "node:path";

import { loadWorkerConfig } from "@docomator/config";
import {
  ContentAddressedObjectStore,
  DocumentDeliveryRegistry,
  DocumentEmailDeliveryRegistry,
  DocumentGenerationRegistry,
  DocumentPreflightRegistry,
  DocumentScheduleRegistry,
  EmailRecipientRegistry,
  RuntimeStatusRegistry,
  ScheduleNetworkDeliveryRegistry,
  SpaceRegistry,
  SqliteStore,
  TemplatePreviewActivationRegistry,
  WorkerQueue
} from "@docomator/storage";

import { createDocumentEmailHandler } from "./document-email-handler.js";
import { createDocumentGenerationHandler } from "./document-generation-handler.js";
import { runWorkerLoop } from "./loop.js";
import { JobHandlerRegistry, processNextJob } from "./processor.js";
import { processScheduleTick } from "./schedule-processor.js";
import { createTemplatePreviewHandler } from "./template-preview-handler.js";

const config = loadWorkerConfig();
const controller = new AbortController();
const store = new SqliteStore({
  databasePath: path.join(config.dataDir, "docomator.db")
});
const objectStore = new ContentAddressedObjectStore(
  path.join(config.dataDir, "objects")
);
const networkDeliveryRootValue = process.env.DOCOMATOR_NETWORK_DELIVERY_ROOT?.trim();
const networkDeliveryRoot =
  networkDeliveryRootValue === undefined || networkDeliveryRootValue.length === 0
    ? null
    : path.resolve(networkDeliveryRootValue);
const queue = new WorkerQueue(store);
const runtimeStatus = new RuntimeStatusRegistry(store);
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
const emailDeliveryRegistry = new DocumentEmailDeliveryRegistry(store, { queue });
const networkDeliveryRegistry = new DocumentDeliveryRegistry(store);
const scheduleRegistry = new DocumentScheduleRegistry(store);
const scheduleNetworkRegistry = new ScheduleNetworkDeliveryRegistry(store);
const spaceRegistry = new SpaceRegistry(store);
const preflightRegistry = new DocumentPreflightRegistry(store);
const recipientRegistry = new EmailRecipientRegistry(store);
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
handlers.register(
  "document.email.send",
  createDocumentEmailHandler({
    registry: emailDeliveryRegistry,
    objectStore,
    config,
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

function publishRuntimeState(
  state: "starting" | "running" | "stopping" | "failed",
  extra: Record<string, unknown> = {}
): void {
  try {
    runtimeStatus.heartbeat({
      serviceType: "worker",
      instanceId: config.workerId,
      version: config.version,
      state,
      details: {
        pid: process.pid,
        queueDepth: queue.getDepths(),
        pollIntervalMs: config.pollIntervalMs,
        heartbeatIntervalMs: config.heartbeatIntervalMs,
        smtpEnabled: config.smtp.enabled,
        networkDeliveryEnabled: networkDeliveryRoot !== null,
        previewEnabled: config.previewEnabled,
        ...extra
      }
    });
  } catch (error) {
    log("error", "worker runtime heartbeat failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function stop(signal: NodeJS.Signals): void {
  publishRuntimeState("stopping", { signal });
  log("info", "shutdown requested", { signal });
  controller.abort();
}

process.once("SIGTERM", () => stop("SIGTERM"));
process.once("SIGINT", () => stop("SIGINT"));

try {
  publishRuntimeState("starting");
  log("info", "worker started", {
    pollIntervalMs: config.pollIntervalMs,
    leaseDurationMs: config.leaseDurationMs,
    llmEnabled: config.llmEnabled,
    previewEnabled: config.previewEnabled,
    smtpEnabled: config.smtp.enabled,
    networkDeliveryEnabled: networkDeliveryRoot !== null,
    schedulesEnabled: true,
    libreOfficeBinary: path.basename(config.libreOfficeBinary)
  });

  await runWorkerLoop({
    pollIntervalMs: config.pollIntervalMs,
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    signal: controller.signal,
    onPoll: async () => {
      try {
        const schedules = await processScheduleTick({
          schedules: scheduleRegistry,
          spaces: spaceRegistry,
          preflight: preflightRegistry,
          generations: generationRegistry,
          emails: emailDeliveryRegistry,
          recipients: recipientRegistry,
          networkSettings: scheduleNetworkRegistry,
          deliveries: networkDeliveryRegistry,
          objectStore,
          networkDeliveryRoot,
          config,
          workerId: config.workerId,
          maxRunsPerTick: 20
        });
        if (
          schedules.dueCreated > 0 ||
          schedules.processed > 0 ||
          schedules.failed > 0
        ) {
          log(schedules.failed > 0 ? "error" : "info", "schedule tick processed", {
            ...schedules
          });
        }
      } catch (error) {
        log("error", "schedule tick failed", {
          error: error instanceof Error ? error.message : String(error)
        });
      }

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
    onHeartbeat: () => {
      publishRuntimeState("running");
      log("info", "worker heartbeat", { queueDepth: queue.getDepths() });
    }
  });

  publishRuntimeState("stopping");
  log("info", "worker stopped");
} catch (error) {
  publishRuntimeState("failed", {
    error: error instanceof Error ? error.message : String(error)
  });
  log("error", "worker failed", {
    error: error instanceof Error ? error.message : String(error)
  });
  process.exitCode = 1;
} finally {
  store.close();
}
