import assert from "node:assert/strict";
import test from "node:test";

import { loadApiConfig, loadWorkerConfig } from "./index.js";

test("api config applies safe defaults", () => {
  const config = loadApiConfig({ DOCOMATOR_DATA_DIR: "./tmp-data" });
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 8080);
  assert.equal(config.llmEnabled, false);
  assert.match(config.dataDir, /tmp-data$/);
});

test("invalid ports are rejected", () => {
  assert.throws(
    () => loadApiConfig({ DOCOMATOR_PORT: "70000" }),
    /DOCOMATOR_PORT must be an integer/
  );
  assert.equal(loadApiConfig({ DOCOMATOR_PORT: "0" }).port, 0);
});

test("worker queue timings and identity are configurable", () => {
  const config = loadWorkerConfig({
    DOCOMATOR_WORKER_ID: "worker-test",
    DOCOMATOR_WORKER_POLL_MS: "250",
    DOCOMATOR_WORKER_HEARTBEAT_MS: "5000",
    DOCOMATOR_WORKER_LEASE_MS: "20000",
    DOCOMATOR_WORKER_RETRY_BASE_MS: "500",
    DOCOMATOR_WORKER_RETRY_MAX_MS: "10000"
  });
  assert.equal(config.workerId, "worker-test");
  assert.equal(config.pollIntervalMs, 250);
  assert.equal(config.heartbeatIntervalMs, 5000);
  assert.equal(config.leaseDurationMs, 20_000);
  assert.equal(config.retryBaseMs, 500);
  assert.equal(config.retryMaxMs, 10_000);
});

test("worker retry range must be coherent", () => {
  assert.throws(
    () =>
      loadWorkerConfig({
        DOCOMATOR_WORKER_RETRY_BASE_MS: "2000",
        DOCOMATOR_WORKER_RETRY_MAX_MS: "1000"
      }),
    /must not exceed/
  );
});
