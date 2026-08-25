import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadApiConfig } from "@docomator/config";
import { SqliteStore } from "@docomator/storage";

import { buildApp } from "./app.js";

function migratedFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "docomator-api-collections-"));
  const databasePath = path.join(directory, "docomator.db");
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON;");
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDirectory = path.resolve(currentDirectory, "../../../migrations");
  const migrations = fs
    .readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  for (const migration of migrations) {
    database.exec(fs.readFileSync(path.join(migrationsDirectory, migration), "utf8"));
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  const registerMigration = database.prepare(
    "INSERT OR REPLACE INTO schema_migrations(name, checksum, applied_at) VALUES (?, ?, ?)"
  );
  for (const migration of migrations) {
    registerMigration.run(migration, "test-checksum", "2026-08-24T00:00:00.000Z");
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
  "x-correlation-id": "corr-api-collections",
  "x-actor-id": "operator-collections"
};

async function createSpace(app: ReturnType<typeof buildApp>, name: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/spaces",
    headers,
    payload: { name }
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { data: { id: string } }).data.id;
}

async function createStudent(
  app: ReturnType<typeof buildApp>,
  spaceId: string,
  displayName: string
) {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/spaces/${spaceId}/entities`,
    headers,
    payload: { entityTypeKey: "person", displayName }
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { data: { entityId: string } }).data.entityId;
}

test("API creates keyless collection and atomically stores ordered plan rows", async () => {
  const fixture = migratedFixture();
  const app = buildApp(
    loadApiConfig({
      DOCOMATOR_DATA_DIR: fixture.directory,
      DOCOMATOR_LOG_LEVEL: "fatal"
    }),
    { store: fixture.store }
  );

  try {
    const spaceId = await createSpace(app, "Учебная кафедра");
    const studentId = await createStudent(app, spaceId, "Иванов Иван");

    const create = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${spaceId}/entity-collections`,
      headers,
      payload: {
        label: "Пункты плана",
        ownerEntityTypeKey: "person",
        fields: [
          {
            label: "Наименование вопроса",
            valueType: "string",
            required: true
          },
          { label: "Срок выполнения", valueType: "date" },
          {
            label: "Отчётность",
            valueType: "enum",
            validation: { enum: ["Доклад", "Отчёт"] }
          }
        ]
      }
    });
    assert.equal(create.statusCode, 201, create.body);
    const definition = (
      create.json() as {
        data: {
          id: string;
          key: string;
          fields: Array<{ key: string; label: string }>;
        };
      }
    ).data;
    assert.match(definition.key, /^collection\.[a-f0-9]{32}$/u);
    assert.equal(definition.fields.length, 3);
    definition.fields.forEach((field) =>
      assert.match(field.key, /^field\.[a-f0-9]{32}$/u)
    );

    const byLabel = new Map(definition.fields.map((field) => [field.label, field.key]));
    const question = byLabel.get("Наименование вопроса");
    const dueDate = byLabel.get("Срок выполнения");
    const reporting = byLabel.get("Отчётность");
    assert.ok(question && dueDate && reporting);

    const save = await app.inject({
      method: "PUT",
      url: `/api/v1/spaces/${spaceId}/entities/${studentId}/collections/${definition.id}/items`,
      headers: { ...headers, "x-correlation-id": "corr-api-collections-save" },
      payload: {
        items: [
          {
            values: {
              [question]: "Обзор литературы",
              [dueDate]: "2026-10-15",
              [reporting]: "Доклад"
            }
          },
          {
            values: {
              [question]: "Эксперимент",
              [reporting]: "Отчёт"
            }
          }
        ]
      }
    });
    assert.equal(save.statusCode, 200, save.body);
    const saved = save.json() as {
      data: {
        ownerEntityId: string;
        items: Array<{ rowNumber: number; values: Record<string, unknown> }>;
      };
    };
    assert.equal(saved.data.ownerEntityId, studentId);
    assert.deepEqual(saved.data.items.map((item) => item.rowNumber), [1, 2]);
    assert.equal(saved.data.items[0]?.values[question], "Обзор литературы");
    assert.equal(saved.data.items[1]?.values[reporting], "Отчёт");

    const read = await app.inject({
      method: "GET",
      url: `/api/v1/spaces/${spaceId}/entities/${studentId}/collections/${definition.key}`
    });
    assert.equal(read.statusCode, 200, read.body);
    assert.deepEqual(
      (read.json() as { data: { items: Array<{ rowNumber: number }> } }).data.items.map(
        (item) => item.rowNumber
      ),
      [1, 2]
    );

    const invalid = await app.inject({
      method: "PUT",
      url: `/api/v1/spaces/${spaceId}/entities/${studentId}/collections/${definition.id}/items`,
      headers,
      payload: {
        items: [{ values: { [question]: "Неверная дата", [dueDate]: "15.10.2026" } }]
      }
    });
    assert.equal(invalid.statusCode, 400, invalid.body);
    assert.equal(
      (invalid.json() as { error: { code: string } }).error.code,
      "property_value_validation_failed"
    );

    const afterInvalid = await app.inject({
      method: "GET",
      url: `/api/v1/spaces/${spaceId}/entities/${studentId}/collections/${definition.id}`
    });
    assert.equal(afterInvalid.statusCode, 200, afterInvalid.body);
    assert.equal(
      (afterInvalid.json() as { data: { items: unknown[] } }).data.items.length,
      2
    );

    const ready = await app.inject({ method: "GET", url: "/readyz" });
    assert.equal(ready.statusCode, 200, ready.body);
  } finally {
    await app.close();
    fixture.cleanup();
  }
});

test("API never resolves collection owner through another space", async () => {
  const fixture = migratedFixture();
  const app = buildApp(
    loadApiConfig({
      DOCOMATOR_DATA_DIR: fixture.directory,
      DOCOMATOR_LOG_LEVEL: "fatal"
    }),
    { store: fixture.store }
  );

  try {
    const alpha = await createSpace(app, "Альфа");
    const beta = await createSpace(app, "Бета");
    const foreignStudent = await createStudent(app, beta, "Студент Бета");
    const create = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${alpha}/entity-collections`,
      headers,
      payload: {
        label: "План",
        ownerEntityTypeKey: "person",
        fields: [{ label: "Вопрос", valueType: "string", required: true }]
      }
    });
    const definition = (
      create.json() as { data: { id: string; fields: Array<{ key: string }> } }
    ).data;

    const response = await app.inject({
      method: "PUT",
      url: `/api/v1/spaces/${alpha}/entities/${foreignStudent}/collections/${definition.id}/items`,
      headers,
      payload: {
        items: [{ values: { [definition.fields[0]!.key]: "Чужое значение" } }]
      }
    });
    assert.equal(response.statusCode, 404, response.body);
    assert.equal(
      (response.json() as { error: { code: string } }).error.code,
      "entity_collection_not_found"
    );
  } finally {
    await app.close();
    fixture.cleanup();
  }
});
