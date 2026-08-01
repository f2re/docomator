import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import {
  ContentAddressedObjectStore,
  ObjectCleanupRegistry,
  SqliteStore
} from "@docomator/storage";
import Fastify from "fastify";

import { registerObjectReconciliationRoutes } from "./object-reconciliation-routes.js";

async function fixture(t: TestContext) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "docomator-reconciliation-api-")
  );
  const store = new SqliteStore({ databasePath: ":memory:" });
  store.execute((connection) => {
    connection.exec(`
      CREATE TABLE files (
        id TEXT PRIMARY KEY,
        sha256 TEXT NOT NULL UNIQUE,
        original_name TEXT NOT NULL,
        media_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        storage_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_by TEXT
      );
    `);
  });
  const objectStore = new ContentAddressedObjectStore(
    path.join(directory, "objects")
  );
  const app = Fastify({ logger: false });
  registerObjectReconciliationRoutes(
    app,
    new ObjectCleanupRegistry(store, objectStore)
  );
  await app.ready();
  t.after(async () => {
    await app.close();
    store.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { app, store, objectStore };
}

test("GET /api/v1/storage/reconciliation возвращает read-only отчёт", async (t) => {
  const { app, store, objectStore } = await fixture(t);
  const stored = await objectStore.putBuffer(Buffer.from("api object"));
  store.execute((connection) => {
    connection
      .prepare(`
        INSERT INTO files (
          id, sha256, original_name, media_type,
          size_bytes, storage_path, created_at, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        "file-api",
        stored.sha256,
        "api.bin",
        "application/octet-stream",
        stored.sizeBytes,
        stored.relativePath,
        "2026-08-01T00:00:00.000Z",
        "test"
      );
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/storage/reconciliation?maxDetails=20"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  const payload = response.json();
  assert.equal(payload.data.healthy, true);
  assert.equal(payload.data.databaseObjectCount, 1);
  assert.equal(payload.data.physicalObjectCount, 1);
  assert.equal(payload.data.matchedObjectCount, 1);
  assert.equal(typeof payload.correlationId, "string");

  const persisted = await objectStore.getBuffer(stored.sha256);
  assert.equal(persisted.toString("utf8"), "api object");
});

test("API отклоняет недействительный лимит до запуска сверки", async (t) => {
  const { app } = await fixture(t);
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/storage/reconciliation?maxDetails=0"
  });
  assert.equal(response.statusCode, 400);
});
