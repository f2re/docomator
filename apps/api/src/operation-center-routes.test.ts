import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadApiConfig } from "@docomator/config";
import { SqliteStore } from "@docomator/storage";

import { buildApp } from "./app.js";

function createProjectionSchema(store: SqliteStore): void {
  store.execute((connection) => {
    connection.exec(`
      CREATE TABLE spaces(id TEXT PRIMARY KEY, key TEXT NOT NULL);
      CREATE TABLE worker_jobs(
        id TEXT PRIMARY KEY, state TEXT NOT NULL, attempts INTEGER NOT NULL,
        max_attempts INTEGER NOT NULL, next_attempt_at TEXT NOT NULL
      );
      CREATE TABLE template_drafts(id TEXT PRIMARY KEY, title TEXT NOT NULL);
      CREATE TABLE template_release_candidates(
        id TEXT PRIMARY KEY, draft_id TEXT NOT NULL, format TEXT NOT NULL
      );
      CREATE TABLE template_release_previews(
        id TEXT PRIMARY KEY, space_id TEXT NOT NULL, candidate_id TEXT NOT NULL,
        worker_job_id TEXT NOT NULL, state TEXT NOT NULL, error_json TEXT,
        correlation_id TEXT NOT NULL,
        requested_at TEXT NOT NULL, completed_at TEXT, updated_at TEXT NOT NULL
      );
      CREATE TABLE template_releases(
        id TEXT PRIMARY KEY, title TEXT NOT NULL, format TEXT NOT NULL
      );
      CREATE TABLE document_generation_jobs(
        id TEXT PRIMARY KEY, space_id TEXT NOT NULL, active_release_id TEXT NOT NULL,
        state TEXT NOT NULL, expected_count INTEGER NOT NULL,
        generated_count INTEGER NOT NULL, failed_count INTEGER NOT NULL,
        worker_job_id TEXT NOT NULL, error_json TEXT, correlation_id TEXT NOT NULL,
        created_at TEXT NOT NULL, completed_at TEXT, updated_at TEXT NOT NULL
      );
      CREATE TABLE document_deliveries(
        id TEXT PRIMARY KEY, space_id TEXT NOT NULL, document_job_id TEXT NOT NULL,
        state TEXT NOT NULL, error_json TEXT, correlation_id TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        completed_at TEXT, updated_at TEXT NOT NULL
      );
      CREATE TABLE document_email_deliveries(
        id TEXT PRIMARY KEY, space_id TEXT NOT NULL, document_job_id TEXT NOT NULL,
        worker_job_id TEXT NOT NULL, state TEXT NOT NULL, error_json TEXT,
        correlation_id TEXT NOT NULL,
        requested_at TEXT NOT NULL, completed_at TEXT, updated_at TEXT NOT NULL
      );

      INSERT INTO spaces VALUES ('space-a', 'alpha');
      INSERT INTO worker_jobs VALUES (
        'worker-a', 'running', 1, 5, '2026-07-15T11:00:00.000Z'
      );
      INSERT INTO template_releases VALUES (
        'release-a', 'Личная карточка сотрудника', 'docx'
      );
      INSERT INTO document_generation_jobs VALUES (
        'job-a', 'space-a', 'release-a', 'running', 4, 2, 0, 'worker-a', NULL,
        'operation-generation-a', '2026-07-15T10:00:00.000Z', NULL,
        '2026-07-15T10:05:00.000Z'
      );
    `);
  });
}

async function setupApp() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "docomator-operations-api-"));
  const store = new SqliteStore({ databasePath: path.join(dataDir, "docomator.db") });
  createProjectionSchema(store);
  const app = buildApp(
    loadApiConfig({
      DOCOMATOR_DATA_DIR: dataDir,
      DOCOMATOR_LOG_LEVEL: "fatal"
    }),
    { store }
  );
  return { app, dataDir, store };
}

test("operation center API returns a no-store space-scoped projection", async () => {
  const { app, dataDir, store } = await setupApp();
  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/spaces/alpha/operations?limit=10"
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.match(response.json().correlationId, /\S/u);
    assert.deepEqual(response.json().data, [
      {
        id: "document_generation:job-a",
        kind: "document_generation",
        state: "running",
        title: "Личная карточка сотрудника",
        format: "docx",
        progress: { expected: 4, completed: 2, failed: 0 },
        attempts: 1,
        maxAttempts: 5,
        nextAttemptAt: "2026-07-15T11:00:00.000Z",
        failureReason: null,
        correlationId: "operation-generation-a",
        createdAt: "2026-07-15T10:00:00.000Z",
        completedAt: null,
        updatedAt: "2026-07-15T10:05:00.000Z"
      }
    ]);
  } finally {
    await app.close();
    store.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("operation center API rejects unknown spaces and invalid query values", async () => {
  const { app, dataDir, store } = await setupApp();
  try {
    const [missing, invalid] = await Promise.all([
      app.inject({ method: "GET", url: "/api/v1/spaces/beta/operations" }),
      app.inject({ method: "GET", url: "/api/v1/spaces/alpha/operations?limit=101" })
    ]);
    assert.equal(missing.statusCode, 404);
    assert.equal(
      missing.json().error.message,
      "Пространство «beta» не найдено."
    );
    assert.equal(invalid.statusCode, 400);
    assert.match(invalid.json().error.message, /Проверьте заполнение формы/u);
  } finally {
    await app.close();
    store.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("operation center API does not expose raw stored errors", async () => {
  const { app, dataDir, store } = await setupApp();
  try {
    store.execute((connection) => {
      connection
        .prepare(`
          INSERT INTO document_deliveries(
            id, space_id, document_job_id, state, error_json, correlation_id,
            requested_at, completed_at, updated_at
          ) VALUES (?, ?, ?, 'failed', ?, ?, ?, ?, ?)
        `)
        .run(
          "delivery-a",
          "space-a",
          "job-a",
          JSON.stringify({
            message: "network folder is not available",
            path: "/restricted/internal/share"
          }),
          "operation-delivery-a",
          "2026-07-15T10:06:00.000Z",
          "2026-07-15T10:07:00.000Z",
          "2026-07-15T10:07:00.000Z"
        );
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/spaces/alpha/operations"
    });
    assert.equal(response.statusCode, 200);
    const delivery = response
      .json()
      .data.find(
        (operation: { kind?: string }) => operation.kind === "network_delivery"
      );
    assert.equal(
      delivery.failureReason,
      "Не удалось выполнить операцию. Проверьте введённые данные и повторите действие."
    );
    assert.equal("error" in delivery, false);
    assert.doesNotMatch(response.body, /restricted|network folder/iu);
  } finally {
    await app.close();
    store.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
