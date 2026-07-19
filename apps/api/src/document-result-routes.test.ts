import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ContentAddressedObjectStore,
  DocumentGenerationRegistry,
  SqliteStore
} from "@docomator/storage";
import Fastify from "fastify";

import { registerDocumentGenerationRoutes } from "./document-generation-routes.js";

const NOW = "2026-07-19T12:00:00.000Z";

function createResultSchema(store: SqliteStore): void {
  store.execute((connection) => {
    connection.exec(`
      CREATE TABLE spaces(id TEXT PRIMARY KEY, key TEXT NOT NULL, name TEXT NOT NULL);
      CREATE TABLE template_releases(
        id TEXT PRIMARY KEY, title TEXT NOT NULL, format TEXT NOT NULL
      );
      CREATE TABLE audience_snapshots(
        id TEXT PRIMARY KEY, member_count INTEGER NOT NULL
      );
      CREATE TABLE worker_jobs(id TEXT PRIMARY KEY, state TEXT NOT NULL);
      CREATE TABLE document_generation_jobs(
        id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL,
        active_release_id TEXT NOT NULL,
        snapshot_id TEXT NOT NULL,
        target_mode TEXT NOT NULL,
        state TEXT NOT NULL,
        expected_count INTEGER NOT NULL,
        generated_count INTEGER NOT NULL,
        failed_count INTEGER NOT NULL,
        worker_job_id TEXT NOT NULL,
        archive_file_id TEXT,
        archive_sha256 TEXT,
        error_json TEXT,
        created_by TEXT,
        correlation_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE document_generation_units(
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        unit_key TEXT NOT NULL,
        primary_entity_id TEXT,
        state TEXT NOT NULL,
        output_file_id TEXT,
        output_sha256 TEXT,
        output_name TEXT,
        error_json TEXT,
        started_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE document_schedules(id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE document_schedule_runs(
        id TEXT PRIMARY KEY, schedule_id TEXT, period_key TEXT
      );
      CREATE TABLE document_result_items(
        id TEXT PRIMARY KEY,
        document_job_id TEXT NOT NULL UNIQUE,
        state TEXT NOT NULL,
        origin TEXT NOT NULL,
        schedule_run_id TEXT,
        available_at TEXT NOT NULL,
        viewed_at TEXT,
        collected_at TEXT,
        deleted_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE audit_log(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        occurred_at TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_id TEXT,
        action TEXT NOT NULL,
        object_type TEXT NOT NULL,
        object_id TEXT,
        correlation_id TEXT NOT NULL,
        details_json TEXT NOT NULL
      );
      CREATE TABLE domain_events(
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        source TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        entity_id TEXT,
        dedupe_key TEXT NOT NULL UNIQUE,
        published_at TEXT,
        created_at TEXT NOT NULL,
        dispatch_state TEXT NOT NULL,
        dispatch_attempts INTEGER NOT NULL,
        max_dispatch_attempts INTEGER NOT NULL,
        next_dispatch_at TEXT NOT NULL,
        dispatch_locked_by TEXT,
        dispatch_locked_at TEXT,
        dispatch_lease_expires_at TEXT,
        dispatch_last_error_json TEXT
      );
    `);
  });
}

async function setupApp(options: { archive?: boolean } = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "docomator-result-api-"));
  const store = new SqliteStore({ databasePath: path.join(dataDir, "docomator.db") });
  const objectStore = new ContentAddressedObjectStore(path.join(dataDir, "objects"));
  const stored = await objectStore.putBuffer(Buffer.from("generated-document"));
  createResultSchema(store);
  store.execute((connection) => {
    connection.exec(`
      INSERT INTO spaces VALUES ('space-a', 'alpha', 'Отдел разработки');
      INSERT INTO template_releases VALUES (
        'release-a', 'Личная карточка сотрудника', 'docx'
      );
      INSERT INTO audience_snapshots VALUES ('snapshot-a', 1);
      INSERT INTO worker_jobs VALUES ('worker-a', 'completed');
    `);
    connection
      .prepare(`
        INSERT INTO document_generation_jobs(
          id, space_id, active_release_id, snapshot_id, target_mode, state,
          expected_count, generated_count, failed_count, worker_job_id,
          archive_file_id, archive_sha256, error_json, created_by,
          correlation_id, created_at, started_at, completed_at, updated_at
        ) VALUES (
          'job-a', 'space-a', 'release-a', 'snapshot-a', 'aggregate', 'completed',
          1, 1, 0, 'worker-a', NULL, ?, NULL, 'operator-1',
          'generation-a', ?, ?, ?, ?
        )
      `)
      .run(options.archive === true ? stored.sha256 : null, NOW, NOW, NOW, NOW);
    connection
      .prepare(`
        INSERT INTO document_generation_units(
          id, job_id, position, unit_key, primary_entity_id, state,
          output_file_id, output_sha256, output_name, error_json,
          started_at, completed_at, updated_at
        ) VALUES (
          'unit-a', 'job-a', 0, 'aggregate-a', NULL, 'completed',
          NULL, ?, 'Личная карточка.docx', NULL, ?, ?, ?
        )
      `)
      .run(stored.sha256, NOW, NOW, NOW);
    connection
      .prepare(`
        INSERT INTO document_result_items(
          id, document_job_id, state, origin, schedule_run_id,
          available_at, viewed_at, collected_at, deleted_at, updated_at
        ) VALUES ('result-a', 'job-a', 'new', 'manual', NULL, ?, NULL, NULL, NULL, ?)
      `)
      .run(NOW, NOW);
  });

  const app = Fastify({ logger: false });
  registerDocumentGenerationRoutes(
    app,
    objectStore,
    new DocumentGenerationRegistry(store, objectStore)
  );
  return { app, dataDir, objectStore, store, stored };
}

test("generation downloads use the shared result state and AUD-003 log", async () => {
  const { app, dataDir, store } = await setupApp();
  try {
    const jobResponse = await app.inject({
      method: "GET",
      url: "/api/v1/spaces/alpha/document-jobs/job-a"
    });
    assert.equal(jobResponse.statusCode, 200);
    assert.deepEqual(
      {
        resultId: jobResponse.json().data.resultId,
        resultUrl: jobResponse.json().data.resultUrl,
        downloadUrl: jobResponse.json().data.downloadUrl
      },
      {
        resultId: "result-a",
        resultUrl: "/api/v1/document-results/result-a",
        downloadUrl: "/api/v1/document-results/result-a/download"
      }
    );

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/v1/spaces/alpha/document-jobs"
    });
    assert.equal(listResponse.statusCode, 200);
    assert.equal(
      listResponse.json().data[0].downloadUrl,
      "/api/v1/document-results/result-a/download"
    );

    const legacyResponse = await app.inject({
      method: "GET",
      url: "/api/v1/spaces/alpha/document-jobs/job-a/download"
    });
    assert.equal(legacyResponse.statusCode, 307);
    assert.equal(
      legacyResponse.headers.location,
      "/api/v1/document-results/result-a/download"
    );

    const sharedDownload = await app.inject({
      method: "GET",
      url: "/api/v1/document-results/result-a/download",
      headers: {
        "x-correlation-id": "download-shared-a",
        "x-actor-id": "operator-1"
      }
    });
    assert.equal(sharedDownload.statusCode, 200);
    assert.deepEqual(sharedDownload.rawPayload, Buffer.from("generated-document"));
    assert.equal(sharedDownload.headers["x-content-type-options"], "nosniff");

    const unitDownload = await app.inject({
      method: "GET",
      url: "/api/v1/spaces/alpha/document-jobs/job-a/outputs/unit-a",
      headers: {
        "x-correlation-id": "download-unit-a",
        "x-actor-id": "operator-1"
      }
    });
    assert.equal(unitDownload.statusCode, 200);
    assert.deepEqual(unitDownload.rawPayload, Buffer.from("generated-document"));

    const persisted = store.execute((connection) => ({
      result: connection
        .prepare(`
          SELECT state, viewed_at, collected_at
          FROM document_result_items
          WHERE id = 'result-a'
        `)
        .get() as { state: string; viewed_at: string | null; collected_at: string | null },
      events: connection
        .prepare(`
          SELECT event_type, dedupe_key
          FROM domain_events
          ORDER BY created_at, id
        `)
        .all() as unknown as Array<{ event_type: string; dedupe_key: string }>,
      audits: connection
        .prepare(`
          SELECT action, object_type, object_id, correlation_id, details_json
          FROM audit_log
          ORDER BY id
        `)
        .all() as unknown as Array<{
        action: string;
        object_type: string;
        object_id: string;
        correlation_id: string;
        details_json: string;
      }>
    }));
    assert.equal(persisted.result.state, "collected");
    assert.notEqual(persisted.result.viewed_at, null);
    assert.notEqual(persisted.result.collected_at, null);
    assert.deepEqual(
      persisted.events.map((event) => ({
        eventType: event.event_type,
        dedupeKey: event.dedupe_key
      })),
      [
        {
          eventType: "document.result.collected",
          dedupeKey: "document.result.collected:result-a:v1"
        }
      ]
    );
    assert.deepEqual(
      persisted.audits.map((audit) => ({
        action: audit.action,
        objectType: audit.object_type,
        objectId: audit.object_id,
        correlationId: audit.correlation_id,
        details: JSON.parse(audit.details_json)
      })),
      [
        {
          action: "download",
          objectType: "document_result",
          objectId: "result-a",
          correlationId: "download-shared-a",
          details: {
            documentJobId: "job-a",
            stateBefore: "new",
            kind: "single"
          }
        },
        {
          action: "download",
          objectType: "document_result",
          objectId: "result-a",
          correlationId: "download-unit-a",
          details: {
            documentJobId: "job-a",
            stateBefore: "collected",
            kind: "unit",
            unitId: "unit-a"
          }
        }
      ]
    );
  } finally {
    await app.close();
    store.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("archive download is collected and audited as an archive", async () => {
  const { app, dataDir, store } = await setupApp({ archive: true });
  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/document-results/result-a/download",
      headers: { "x-correlation-id": "download-archive-a" }
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["content-type"], "application/zip");
    const persisted = store.execute((connection) => ({
      result: connection
        .prepare("SELECT state FROM document_result_items WHERE id = 'result-a'")
        .get() as { state: string },
      audit: connection
        .prepare(`
          SELECT correlation_id, details_json
          FROM audit_log
          WHERE object_id = 'result-a'
        `)
        .get() as { correlation_id: string; details_json: string }
    }));
    assert.equal(persisted.result.state, "collected");
    assert.equal(persisted.audit.correlation_id, "download-archive-a");
    assert.deepEqual(JSON.parse(persisted.audit.details_json), {
      documentJobId: "job-a",
      stateBefore: "new",
      kind: "archive"
    });
  } finally {
    await app.close();
    store.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("a missing object does not collect or audit a result", async () => {
  const { app, dataDir, objectStore, store, stored } = await setupApp();
  try {
    assert.equal(await objectStore.deleteObject(stored.sha256), true);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/document-results/result-a/download",
      headers: { "x-correlation-id": "download-missing-a" }
    });
    assert.equal(response.statusCode, 500);
    const persisted = store.execute((connection) => ({
      result: connection
        .prepare("SELECT state FROM document_result_items WHERE id = 'result-a'")
        .get() as { state: string },
      auditCount: Number(
        (
          connection.prepare("SELECT COUNT(*) AS count FROM audit_log").get() as {
            count: number;
          }
        ).count
      ),
      eventCount: Number(
        (
          connection.prepare("SELECT COUNT(*) AS count FROM domain_events").get() as {
            count: number;
          }
        ).count
      )
    }));
    assert.equal(persisted.result.state, "new");
    assert.equal(persisted.auditCount, 0);
    assert.equal(persisted.eventCount, 0);
  } finally {
    await app.close();
    store.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("a checksum mismatch does not collect or audit a result", async () => {
  const { app, dataDir, store, stored } = await setupApp();
  try {
    await fs.writeFile(stored.storagePath, Buffer.from("tampered-document"));
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/document-results/result-a/download",
      headers: { "x-correlation-id": "download-tampered-a" }
    });
    assert.equal(response.statusCode, 500);
    const persisted = store.execute((connection) => ({
      state: (
        connection
          .prepare("SELECT state FROM document_result_items WHERE id = 'result-a'")
          .get() as { state: string }
      ).state,
      auditCount: (
        connection.prepare("SELECT COUNT(*) AS count FROM audit_log").get() as {
          count: number;
        }
      ).count
    }));
    assert.equal(persisted.state, "new");
    assert.equal(persisted.auditCount, 0);
  } finally {
    await app.close();
    store.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("audit failure rolls back collection and the outbox event", async () => {
  const { app, dataDir, store } = await setupApp();
  try {
    store.execute((connection) => {
      connection.exec(`
        CREATE TRIGGER fail_document_result_audit
        BEFORE INSERT ON audit_log
        BEGIN
          SELECT RAISE(ABORT, 'forced audit failure');
        END;
      `);
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/document-results/result-a/download",
      headers: { "x-correlation-id": "download-audit-failure-a" }
    });
    assert.equal(response.statusCode, 500);
    const persisted = store.execute((connection) => ({
      state: (
        connection
          .prepare("SELECT state FROM document_result_items WHERE id = 'result-a'")
          .get() as { state: string }
      ).state,
      eventCount: (
        connection.prepare("SELECT COUNT(*) AS count FROM domain_events").get() as {
          count: number;
        }
      ).count
    }));
    assert.equal(persisted.state, "new");
    assert.equal(persisted.eventCount, 0);
  } finally {
    await app.close();
    store.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("deleted results stay closed through canonical and legacy links", async () => {
  const { app, dataDir, store } = await setupApp();
  try {
    store.execute((connection) => {
      connection
        .prepare(`
          UPDATE document_result_items
          SET state = 'deleted', deleted_at = ?, updated_at = ?
          WHERE id = 'result-a'
        `)
        .run(NOW, NOW);
    });
    const jobResponse = await app.inject({
      method: "GET",
      url: "/api/v1/spaces/alpha/document-jobs/job-a"
    });
    assert.equal(jobResponse.statusCode, 200);
    assert.equal(jobResponse.json().data.resultId, null);
    assert.equal(jobResponse.json().data.downloadUrl, null);

    const [canonical, legacy, unit] = await Promise.all([
      app.inject({
        method: "GET",
        url: "/api/v1/document-results/result-a/download"
      }),
      app.inject({
        method: "GET",
        url: "/api/v1/spaces/alpha/document-jobs/job-a/download"
      }),
      app.inject({
        method: "GET",
        url: "/api/v1/spaces/alpha/document-jobs/job-a/outputs/unit-a"
      })
    ]);
    assert.notEqual(canonical.statusCode, 200);
    assert.notEqual(legacy.statusCode, 200);
    assert.notEqual(unit.statusCode, 200);
    const auditCount = store.execute(
      (connection) =>
        (
          connection.prepare("SELECT COUNT(*) AS count FROM audit_log").get() as {
            count: number;
          }
        ).count
    );
    assert.equal(auditCount, 0);
  } finally {
    await app.close();
    store.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
