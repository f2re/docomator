import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SqliteStore } from "./database.js";
import { ContentAddressedObjectStore } from "./object-store.js";
import {
  ObjectReconciliationRegistry,
  ObjectReconciliationValidationError
} from "./object-reconciliation.js";

function createFilesTable(store: SqliteStore): void {
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
}

function insertFile(
  store: SqliteStore,
  values: {
    id: string;
    sha256: string;
    sizeBytes: number;
    storagePath: string;
  }
): void {
  store.execute((connection) => {
    connection
      .prepare(`
        INSERT INTO files (
          id, sha256, original_name, media_type,
          size_bytes, storage_path, created_at, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        values.id,
        values.sha256,
        `${values.id}.bin`,
        "application/octet-stream",
        values.sizeBytes,
        values.storagePath,
        "2026-08-01T00:00:00.000Z",
        "test"
      );
  });
}

async function fixture(t: test.TestContext) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "docomator-object-check-"));
  const store = new SqliteStore({ databasePath: ":memory:" });
  createFilesTable(store);
  const objectStore = new ContentAddressedObjectStore(path.join(dataDir, "objects"));
  const registry = new ObjectReconciliationRegistry(store, objectStore);
  t.after(async () => {
    store.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  return { dataDir, store, objectStore, registry };
}

test("полностью согласованное хранилище проходит сверку", async (t) => {
  const { store, objectStore, registry } = await fixture(t);
  const stored = await objectStore.putBuffer(Buffer.from("healthy object"));
  insertFile(store, {
    id: "file-healthy",
    sha256: stored.sha256,
    sizeBytes: stored.sizeBytes,
    storagePath: stored.relativePath
  });

  const report = await registry.reconcile({
    now: new Date("2026-08-01T07:00:00.000Z")
  });

  assert.equal(report.generatedAt, "2026-08-01T07:00:00.000Z");
  assert.equal(report.healthy, true);
  assert.equal(report.objectStorePresent, true);
  assert.equal(report.databaseObjectCount, 1);
  assert.equal(report.physicalObjectCount, 1);
  assert.equal(report.matchedObjectCount, 1);
  assert.equal(report.issueCount, 0);
  assert.deepEqual(report.issues, []);
});

test("находит отсутствующие, лишние и повреждённые объекты без удаления", async (t) => {
  const { store, objectStore, registry } = await fixture(t);

  const healthy = await objectStore.putBuffer(Buffer.from("healthy"));
  insertFile(store, {
    id: "file-healthy",
    sha256: healthy.sha256,
    sizeBytes: healthy.sizeBytes,
    storagePath: healthy.relativePath
  });

  const corrupted = await objectStore.putBuffer(Buffer.from("original payload"));
  insertFile(store, {
    id: "file-corrupted",
    sha256: corrupted.sha256,
    sizeBytes: corrupted.sizeBytes,
    storagePath: "wrong/place/object.bin"
  });
  await fs.writeFile(
    path.join(objectStore.root, corrupted.relativePath),
    Buffer.from("changed")
  );

  const missingSha = "a".repeat(64);
  insertFile(store, {
    id: "file-missing",
    sha256: missingSha,
    sizeBytes: 123,
    storagePath: `${missingSha.slice(0, 2)}/${missingSha.slice(2, 4)}/${missingSha}`
  });

  const orphan = await objectStore.putBuffer(Buffer.from("unregistered"));
  await fs.mkdir(path.join(objectStore.root, ".incoming"), { recursive: true });
  await fs.writeFile(path.join(objectStore.root, ".incoming", "stale.tmp"), "stale");
  await fs.writeFile(path.join(objectStore.root, "unexpected.txt"), "unexpected");

  const report = await registry.reconcile({ maxDetails: 100 });

  assert.equal(report.healthy, false);
  assert.equal(report.databaseObjectCount, 3);
  assert.equal(report.physicalObjectCount, 3);
  assert.equal(report.matchedObjectCount, 1);
  assert.equal(report.issueCounts.databaseObjectMissing, 1);
  assert.equal(report.issueCounts.databaseSizeMismatch, 1);
  assert.equal(report.issueCounts.databaseStoragePathMismatch, 1);
  assert.equal(report.issueCounts.physicalObjectUnregistered, 1);
  assert.equal(report.issueCounts.physicalChecksumMismatch, 1);
  assert.equal(report.issueCounts.invalidLayout, 1);
  assert.equal(report.issueCounts.incomingEntry, 1);
  assert.equal(report.issueCount, 7);
  assert.equal(report.omittedDetailCount, 0);

  const orphanBuffer = await objectStore.getBuffer(orphan.sha256);
  assert.equal(orphanBuffer.toString("utf8"), "unregistered");
  await assert.doesNotReject(
    fs.access(path.join(objectStore.root, corrupted.relativePath))
  );
});

test("ограничивает подробности, сохраняя полные счётчики", async (t) => {
  const { objectStore, registry } = await fixture(t);
  await fs.mkdir(objectStore.root, { recursive: true });
  await Promise.all(
    ["one", "two", "three"].map((name) =>
      fs.writeFile(path.join(objectStore.root, `${name}.tmp`), name)
    )
  );

  const report = await registry.reconcile({ maxDetails: 2 });

  assert.equal(report.issueCount, 3);
  assert.equal(report.detailCount, 2);
  assert.equal(report.omittedDetailCount, 1);
  assert.equal(report.issueCounts.invalidLayout, 3);
});

test("отсутствующий корень и недействительный лимит завершаются безопасно", async (t) => {
  const { store, objectStore, registry } = await fixture(t);
  const sha256 = "b".repeat(64);
  insertFile(store, {
    id: "file-without-store",
    sha256,
    sizeBytes: 10,
    storagePath: `${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`
  });

  const report = await registry.reconcile();
  assert.equal(report.objectStorePresent, false);
  assert.equal(report.issueCounts.objectStoreMissing, 1);
  assert.equal(report.issueCounts.databaseObjectMissing, 1);

  await assert.rejects(
    registry.reconcile({ maxDetails: 0 }),
    ObjectReconciliationValidationError
  );
  await assert.rejects(
    registry.reconcile({ maxDetails: 1_001 }),
    ObjectReconciliationValidationError
  );
  assert.equal(objectStore.root.endsWith("objects"), true);
});
