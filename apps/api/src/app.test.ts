import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadApiConfig } from "@docomator/config";

import { buildApp } from "./app.js";

test("health endpoint reports the API service", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "docomator-api-"));
  const app = buildApp(
    loadApiConfig({
      DOCOMATOR_DATA_DIR: dataDir,
      DOCOMATOR_VERSION: "test-version",
      DOCOMATOR_LOG_LEVEL: "fatal"
    })
  );

  const response = await app.inject({ method: "GET", url: "/healthz" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().service, "api");
  assert.equal(response.json().version, "test-version");
  await app.close();
});

test("readiness stays degraded before migrations create the database", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "docomator-ready-"));
  const app = buildApp(
    loadApiConfig({
      DOCOMATOR_DATA_DIR: dataDir,
      DOCOMATOR_LOG_LEVEL: "fatal"
    })
  );

  const response = await app.inject({ method: "GET", url: "/readyz" });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().checks.database, "error");
  await app.close();
});
