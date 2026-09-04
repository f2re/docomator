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

test("knowledge data has no default-space or legacy global API bypass", async () => {
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

    const [defaultPropertyResponse, otherPropertyResponse] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/v1/knowledge/property-definitions?spaceId=default",
        headers,
        payload: {
          label: "Должность",
          valueType: "string",
          appliesTo: ["person"]
        }
      }),
      app.inject({
        method: "POST",
        url: "/api/v1/knowledge/property-definitions?spaceId=other",
        headers,
        payload: {
          label: "Должность",
          valueType: "string",
          appliesTo: ["person"]
        }
      })
    ]);
    assert.equal(defaultPropertyResponse.statusCode, 201, defaultPropertyResponse.body);
    assert.equal(otherPropertyResponse.statusCode, 201, otherPropertyResponse.body);
    const defaultPropertyKey = (
      defaultPropertyResponse.json() as { data: { key: string } }
    ).data.key;
    const otherPropertyKey = (
      otherPropertyResponse.json() as { data: { key: string } }
    ).data.key;
    assert.notEqual(defaultPropertyKey, otherPropertyKey);

    const ownershipBefore = fixture.store.execute((connection) =>
      Number(
        (
          connection
            .prepare("SELECT COUNT(*) AS count FROM space_property_definitions")
            .get() as { count: number }
        ).count
      )
    );

    const [defaultList, otherList, missingScope] = await Promise.all([
      app.inject({
        method: "GET",
        url: "/api/v1/knowledge/property-definitions?spaceId=default&limit=500",
        headers
      }),
      app.inject({
        method: "GET",
        url: "/api/v1/knowledge/property-definitions?spaceId=other&limit=500",
        headers
      }),
      app.inject({
        method: "GET",
        url: "/api/v1/knowledge/property-definitions?limit=500",
        headers
      })
    ]);
    assert.equal(defaultList.statusCode, 200, defaultList.body);
    assert.equal(otherList.statusCode, 200, otherList.body);
    assert.equal(missingScope.statusCode, 400, missingScope.body);

    const defaultKeys = (
      defaultList.json() as { data: Array<{ key: string; label: string }> }
    ).data.map((item) => item.key);
    const otherKeys = (
      otherList.json() as { data: Array<{ key: string; label: string }> }
    ).data.map((item) => item.key);
    assert.ok(defaultKeys.includes(defaultPropertyKey));
    assert.ok(!defaultKeys.includes(otherPropertyKey));
    assert.ok(otherKeys.includes(otherPropertyKey));
    assert.ok(!otherKeys.includes(defaultPropertyKey));

    const [foreignReadFromDefault, foreignReadFromOther] = await Promise.all([
      app.inject({
        method: "GET",
        url: `/api/v1/knowledge/property-definitions/${otherPropertyKey}?spaceId=default`,
        headers
      }),
      app.inject({
        method: "GET",
        url: `/api/v1/knowledge/property-definitions/${defaultPropertyKey}?spaceId=other`,
        headers
      })
    ]);
    assert.equal(foreignReadFromDefault.statusCode, 404, foreignReadFromDefault.body);
    assert.equal(foreignReadFromOther.statusCode, 404, foreignReadFromOther.body);

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

    const [legacyList, legacyRead, legacyWrite, legacyHistory] = await Promise.all([
      app.inject({ method: "GET", url: "/api/v1/knowledge/entities?limit=500", headers }),
      app.inject({ method: "GET", url: `/api/v1/knowledge/entities/${foreignEntityId}`, headers }),
      app.inject({
        method: "PUT",
        url: `/api/v1/knowledge/entities/${foreignEntityId}/properties/${otherPropertyKey}`,
        headers,
        payload: { value: "forbidden", sourceType: "test" }
      }),
      app.inject({
        method: "GET",
        url: `/api/v1/knowledge/entities/${foreignEntityId}/property-values`,
        headers
      })
    ]);
    for (const response of [legacyList, legacyRead, legacyWrite, legacyHistory]) {
      assert.equal(response.statusCode, 404, response.body);
    }

    const ownershipAfter = fixture.store.execute((connection) =>
      Number(
        (
          connection
            .prepare("SELECT COUNT(*) AS count FROM space_property_definitions")
            .get() as { count: number }
        ).count
      )
    );
    assert.equal(ownershipAfter, ownershipBefore, "GET/list must not claim property ownership");
  } finally {
    await app.close();
    fixture.cleanup();
  }
});
