import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadApiConfig } from "@docomator/config";
import { SqliteStore } from "@docomator/storage";

import { buildApp } from "./app.js";

function migratedFixture(): {
  directory: string;
  store: SqliteStore;
  cleanup: () => void;
} {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "docomator-api-space-isolation-"));
  const databasePath = path.join(directory, "docomator.db");
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDirectory = path.resolve(currentDirectory, "../../../migrations");
  for (const migration of fs
    .readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()) {
    const sql = fs.readFileSync(path.join(migrationsDirectory, migration), "utf8");
    database.exec(sql);
    database
      .prepare(
        "INSERT INTO schema_migrations(name, checksum, applied_at) VALUES (?, ?, ?)"
      )
      .run(
        migration,
        createHash("sha256").update(sql).digest("hex"),
        "2026-08-07T00:00:00.000Z"
      );
  }
  database.close();
  const store = new SqliteStore({ databasePath });
  return {
    directory,
    store,
    cleanup: () => {
      store.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };
}

const headers = {
  "x-correlation-id": "corr-api-space-isolation",
  "x-actor-id": "operator-1"
};

test("legacy knowledge entity API is confined to default space", async () => {
  const fixture = migratedFixture();
  const app = buildApp(
    loadApiConfig({
      DOCOMATOR_DATA_DIR: fixture.directory,
      DOCOMATOR_LOG_LEVEL: "fatal"
    }),
    { store: fixture.store }
  );

  try {
    const otherSpace = await app.inject({
      method: "POST",
      url: "/api/v1/spaces",
      headers,
      payload: { key: "other", name: "Другое пространство" }
    });
    assert.equal(otherSpace.statusCode, 201, otherSpace.body);

    const foreignEntity = await app.inject({
      method: "POST",
      url: "/api/v1/spaces/other/entities",
      headers,
      payload: { entityTypeKey: "person", displayName: "Чужой объект" }
    });
    assert.equal(foreignEntity.statusCode, 201, foreignEntity.body);
    const foreignEntityId = (
      foreignEntity.json() as { data: { entityId: string } }
    ).data.entityId;

    const defaultEntity = await app.inject({
      method: "POST",
      url: "/api/v1/knowledge/entities",
      headers,
      payload: { entityTypeKey: "person", displayName: "Основной объект" }
    });
    assert.equal(defaultEntity.statusCode, 201, defaultEntity.body);
    const defaultEntityId = (
      defaultEntity.json() as { data: { id: string } }
    ).data.id;

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/knowledge/entities?limit=500",
      headers
    });
    assert.equal(list.statusCode, 200, list.body);
    const listedIds = (list.json() as { data: Array<{ id: string }> }).data.map(
      (entity) => entity.id
    );
    assert.ok(listedIds.includes(defaultEntityId));
    assert.ok(!listedIds.includes(foreignEntityId));

    const foreignRead = await app.inject({
      method: "GET",
      url: `/api/v1/knowledge/entities/${foreignEntityId}`,
      headers
    });
    assert.equal(foreignRead.statusCode, 404, foreignRead.body);

    const foreignLegacyWrite = await app.inject({
      method: "PUT",
      url: `/api/v1/knowledge/entities/${foreignEntityId}/properties/system.entity_import_key`,
      headers,
      payload: { value: "forbidden", sourceType: "test" }
    });
    assert.equal(foreignLegacyWrite.statusCode, 404, foreignLegacyWrite.body);
  } finally {
    await app.close();
    fixture.cleanup();
  }
});
