import assert from "node:assert/strict";
import test from "node:test";

import { OperationCenterRegistry } from "./operation-center.js";
import { SqliteStore } from "./database.js";

function setupRegistry(): { store: SqliteStore; registry: OperationCenterRegistry } {
  const store = new SqliteStore({ databasePath: ":memory:" });
  store.execute((connection) => {
    connection.exec(`
      CREATE TABLE spaces(id TEXT PRIMARY KEY, key TEXT NOT NULL);
      CREATE TABLE worker_jobs(
        id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        max_attempts INTEGER NOT NULL,
        next_attempt_at TEXT NOT NULL
      );
      CREATE TABLE template_drafts(id TEXT PRIMARY KEY, title TEXT NOT NULL);
      CREATE TABLE template_release_candidates(
        id TEXT PRIMARY KEY,
        draft_id TEXT NOT NULL,
        format TEXT NOT NULL
      );
      CREATE TABLE template_release_previews(
        id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL,
        candidate_id TEXT NOT NULL,
        worker_job_id TEXT NOT NULL,
        state TEXT NOT NULL,
        error_json TEXT,
        correlation_id TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        completed_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE template_releases(
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        format TEXT NOT NULL
      );
      CREATE TABLE document_generation_jobs(
        id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL,
        active_release_id TEXT NOT NULL,
        state TEXT NOT NULL,
        expected_count INTEGER NOT NULL,
        generated_count INTEGER NOT NULL,
        failed_count INTEGER NOT NULL,
        worker_job_id TEXT NOT NULL,
        error_json TEXT,
        correlation_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE document_deliveries(
        id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL,
        document_job_id TEXT NOT NULL,
        state TEXT NOT NULL,
        error_json TEXT,
        correlation_id TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        completed_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE document_email_deliveries(
        id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL,
        document_job_id TEXT NOT NULL,
        worker_job_id TEXT NOT NULL,
        state TEXT NOT NULL,
        error_json TEXT,
        correlation_id TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        completed_at TEXT,
        updated_at TEXT NOT NULL
      );

      INSERT INTO spaces VALUES ('space-a', 'alpha'), ('space-b', 'beta');
      INSERT INTO worker_jobs VALUES
        ('worker-preview', 'retry', 1, 3, '2026-07-15T10:05:00.000Z'),
        ('worker-generation', 'running', 1, 5, '2026-07-15T10:00:00.000Z'),
        ('worker-email', 'completed', 1, 5, '2026-07-15T10:00:00.000Z'),
        ('worker-other', 'completed', 1, 5, '2026-07-15T10:00:00.000Z');
      INSERT INTO template_drafts VALUES ('draft-a', 'Личная карточка');
      INSERT INTO template_release_candidates VALUES ('candidate-a', 'draft-a', 'docx');
      INSERT INTO template_release_previews VALUES (
        'preview-a', 'space-a', 'candidate-a', 'worker-preview', 'pending', NULL,
        'corr-preview', '2026-07-15T09:00:00.000Z', NULL, '2026-07-15T10:04:00.000Z'
      );
      INSERT INTO template_releases VALUES ('release-a', 'Личная карточка', 'docx');
      INSERT INTO document_generation_jobs VALUES
        ('generation-a', 'space-a', 'release-a', 'running', 3, 2, 0,
         'worker-generation', NULL, 'corr-generation', '2026-07-15T09:30:00.000Z', NULL,
         '2026-07-15T10:03:00.000Z'),
        ('generation-b', 'space-b', 'release-a', 'completed', 1, 1, 0,
         'worker-other', NULL, 'corr-other', '2026-07-15T08:00:00.000Z',
         '2026-07-15T08:01:00.000Z', '2026-07-15T08:01:00.000Z');
      INSERT INTO document_deliveries VALUES (
        'network-a', 'space-a', 'generation-a', 'failed',
        '{"message":"network folder is not available"}', 'corr-network',
        '2026-07-15T10:00:00.000Z', '2026-07-15T10:02:00.000Z',
        '2026-07-15T10:02:00.000Z'
      );
      INSERT INTO document_email_deliveries VALUES (
        'email-a', 'space-a', 'generation-a', 'worker-email', 'completed', NULL,
        'corr-email', '2026-07-15T09:55:00.000Z', '2026-07-15T10:01:00.000Z',
        '2026-07-15T10:01:00.000Z'
      );
    `);
  });
  return { store, registry: new OperationCenterRegistry(store) };
}

test("operation center combines persistent workflows and isolates spaces", () => {
  const { store, registry } = setupRegistry();
  try {
    const operations = registry.list("alpha");
    assert.deepEqual(
      operations.map((operation) => [operation.kind, operation.state]),
      [
        ["template_preview", "retry"],
        ["document_generation", "running"],
        ["network_delivery", "failed"],
        ["email_delivery", "completed"]
      ]
    );
    assert.deepEqual(operations[1]?.progress, {
      expected: 3,
      completed: 2,
      failed: 0
    });
    assert.equal(operations[0]?.attempts, 1);
    assert.equal(operations[0]?.nextAttemptAt, "2026-07-15T10:05:00.000Z");
    assert.equal(registry.list("space-a", 2).length, 2);
    assert.deepEqual(
      registry.list("beta").map((operation) => operation.id),
      ["document_generation:generation-b"]
    );
  } finally {
    store.close();
  }
});

test("operation center validates its bounded limit", () => {
  const { store, registry } = setupRegistry();
  try {
    assert.throws(() => registry.list("alpha", 0), /range 1\.\.100/u);
    assert.throws(() => registry.list("alpha", 101), /range 1\.\.100/u);
  } finally {
    store.close();
  }
});
