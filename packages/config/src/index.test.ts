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
});

test("worker intervals are configurable", () => {
  const config = loadWorkerConfig({
    DOCOMATOR_WORKER_POLL_MS: "250",
    DOCOMATOR_WORKER_HEARTBEAT_MS: "5000"
  });
  assert.equal(config.pollIntervalMs, 250);
  assert.equal(config.heartbeatIntervalMs, 5000);
});
