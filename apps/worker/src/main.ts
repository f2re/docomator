import { loadWorkerConfig } from "@docomator/config";

import { runWorkerLoop } from "./loop.js";

const config = loadWorkerConfig();
const controller = new AbortController();

function log(level: "info" | "error", message: string, extra = {}): void {
  process.stdout.write(
    `${JSON.stringify({
      level,
      service: "worker",
      message,
      version: config.version,
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
    llmEnabled: config.llmEnabled
  });

  await runWorkerLoop({
    pollIntervalMs: config.pollIntervalMs,
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    signal: controller.signal,
    onPoll: async () => {
      // Bootstrap behavior only. Queue claiming and scheduler execution are
      // implemented in the automation milestone described in docs/ROADMAP.md.
    },
    onHeartbeat: () => log("info", "worker heartbeat")
  });

  log("info", "worker stopped");
} catch (error) {
  log("error", "worker failed", {
    error: error instanceof Error ? error.message : String(error)
  });
  process.exitCode = 1;
}
