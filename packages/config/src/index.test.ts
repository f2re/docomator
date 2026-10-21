import assert from "node:assert/strict";
import test from "node:test";

import { loadApiConfig, loadWorkerConfig } from "./index.js";

test("api config applies safe defaults", () => {
  const config = loadApiConfig({ DOCOMATOR_DATA_DIR: "./tmp-data" });
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 8080);
  assert.equal(config.llmEnabled, false);
  assert.equal(config.llmBaseUrl, "http://127.0.0.1:8081");
  assert.equal(config.llmApiKey, null);
  assert.equal(config.llmModel, "qwen2.5-7b-instruct");
  assert.equal(config.llmTimeoutMs, 30_000);
  assert.equal(config.llmTemperature, 0.1);
  assert.equal(config.releaseMetadataPath, null);
  assert.match(config.dataDir, /tmp-data$/);
});

test("llm remote server configuration is parsed accurately", () => {
  const config = loadApiConfig({
    DOCOMATOR_DATA_DIR: "./tmp-data",
    DOCOMATOR_LLM_ENABLED: "true",
    DOCOMATOR_LLM_ENDPOINT: "http://192.168.1.100:8081/v1/",
    DOCOMATOR_LLM_API_KEY: "secret-token-123",
    DOCOMATOR_LLM_MODEL: "custom-instruct-model",
    DOCOMATOR_LLM_TIMEOUT_MS: "45000",
    DOCOMATOR_LLM_TEMPERATURE: "0.2"
  });
  assert.equal(config.llmEnabled, true);
  assert.equal(config.llmBaseUrl, "http://192.168.1.100:8081/v1/");
  assert.equal(config.llmApiKey, "secret-token-123");
  assert.equal(config.llmModel, "custom-instruct-model");
  assert.equal(config.llmTimeoutMs, 45_000);
  assert.equal(config.llmTemperature, 0.2);
});

test("invalid llm parameters are rejected", () => {
  assert.throws(
    () =>
      loadApiConfig({
        DOCOMATOR_DATA_DIR: "./tmp-data",
        DOCOMATOR_LLM_TEMPERATURE: "3.5"
      }),
    /DOCOMATOR_LLM_TEMPERATURE must be a number in range 0\.\.2/
  );
  assert.throws(
    () =>
      loadApiConfig({
        DOCOMATOR_DATA_DIR: "./tmp-data",
        DOCOMATOR_LLM_TIMEOUT_MS: "500"
      }),
    /DOCOMATOR_LLM_TIMEOUT_MS must be an integer in range 1000\.\.300000/
  );
});

test("api config resolves installed release metadata path", () => {
  const config = loadApiConfig({
    DOCOMATOR_DATA_DIR: "./tmp-data",
    DOCOMATOR_RELEASE_METADATA_PATH: "./release.json"
  });
  assert.match(config.releaseMetadataPath ?? "", /release\.json$/u);
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
