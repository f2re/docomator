import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadApiConfig } from "@docomator/config";
import { KnowledgeRegistry, SqliteStore } from "@docomator/storage";

import { buildApp } from "./app.js";
import { createImportPreviewToken } from "./data-import-parser.js";

function migratedFixture(): {
  directory: string;
  store: SqliteStore;
  cleanup: () => void;
} {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "docomator-api-import-"));
  const databasePath = path.join(directory, "docomator.db");
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON;");
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDirectory = path.resolve(currentDirectory, "../../../migrations");
  for (const migration of fs
    .readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort()) {
    database.exec(fs.readFileSync(path.join(migrationsDirectory, migration), "utf8"));
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

const requestHeaders = {
  "x-correlation-id": "corr-api-import",
  "x-actor-id": "operator-1"
};

async function createSpace(app: ReturnType<typeof buildApp>): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/spaces",
    headers: requestHeaders,
    payload: { key: "staff", name: "Сотрудники" }
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { data: { id: string } }).data.id;
}

function keylessBody(rows: Array<Record<string, string>>) {
  const sourceSha256 = "b".repeat(64);
  const headers = ["Табельный номер", "ФИО", "Должность"];
  return {
    fileName: "сотрудники.csv",
    fileFormat: "csv",
    sourceSha256,
    previewToken: createImportPreviewToken({ sourceSha256, headers, rows }),
    identityColumn: "Табельный номер",
    displayNameColumn: "ФИО",
    headers,
    rows,
    mappings: [
      {
        column: "Должность",
        createIfMissing: true,
        label: "Должность",
        valueType: "string"
      }
    ],
    group: { name: "Новые сотрудники" }
  };
}

test("keyless API plans and imports employees without returning generated keys", async () => {
  const fixture = migratedFixture();
  const app = buildApp(
    loadApiConfig({
      DOCOMATOR_DATA_DIR: fixture.directory,
      DOCOMATOR_LOG_LEVEL: "fatal"
    }),
    { store: fixture.store }
  );
  try {
    const spaceId = await createSpace(app);
    const payload = keylessBody([
      {
        "Табельный номер": "001",
        "ФИО": "Иванов Иван",
        "Должность": "Инженер"
      },
      {
        "Табельный номер": "002",
        "ФИО": "Петрова Анна",
        "Должность": "Бухгалтер"
      }
    ]);

    const planResponse = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${spaceId}/data-import/plan`,
      headers: requestHeaders,
      payload
    });
    assert.equal(planResponse.statusCode, 200, planResponse.body);
    const plan = planResponse.json() as {
      data: { createdCount: number; updatedCount: number; failedCount: number };
    };
    assert.deepEqual(plan.data, {
      createdCount: 2,
      updatedCount: 0,
      unchangedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      propertyValueCount: 2,
      rowCount: 2,
      state: "completed",
      errors: []
    });
    const beforeExecute = await app.inject({
      method: "GET",
      url: `/api/v1/spaces/${spaceId}/entities?limit=500`
    });
    assert.equal((beforeExecute.json() as { data: unknown[] }).data.length, 0);

    const executeResponse = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${spaceId}/data-import/execute`,
      headers: requestHeaders,
      payload
    });
    assert.equal(executeResponse.statusCode, 201, executeResponse.body);
    const result = (executeResponse.json() as { data: Record<string, unknown> }).data;
    assert.equal(result.createdCount, 2);
    assert.equal(result.groupName, "Новые сотрудники");
    for (const hiddenField of [
      "id",
      "spaceId",
      "entityTypeKey",
      "sourceSha256",
      "identityPropertyKey",
      "groupId"
    ]) {
      assert.equal(hiddenField in result, false, hiddenField);
    }
  } finally {
    await app.close();
    fixture.cleanup();
  }
});

test("API reports duplicate update values in Russian during planning", async () => {
  const fixture = migratedFixture();
  const app = buildApp(
    loadApiConfig({
      DOCOMATOR_DATA_DIR: fixture.directory,
      DOCOMATOR_LOG_LEVEL: "fatal"
    }),
    { store: fixture.store }
  );
  try {
    const spaceId = await createSpace(app);
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${spaceId}/data-import/plan`,
      headers: requestHeaders,
      payload: keylessBody([
        {
          "Табельный номер": "001",
          "ФИО": "Иванов Иван",
          "Должность": "Инженер"
        },
        {
          "Табельный номер": "001",
          "ФИО": "Петров Пётр",
          "Должность": "Мастер"
        }
      ])
    });
    assert.equal(response.statusCode, 200, response.body);
    const result = response.json() as {
      data: { failedCount: number; errors: Array<{ message: string }> };
    };
    assert.equal(result.data.failedCount, 1);
    assert.match(result.data.errors[0]?.message ?? "", /повторяется внутри файла/u);
  } finally {
    await app.close();
    fixture.cleanup();
  }
});

test("explicit technical import contract remains available for automation", async () => {
  const fixture = migratedFixture();
  const app = buildApp(
    loadApiConfig({
      DOCOMATOR_DATA_DIR: fixture.directory,
      DOCOMATOR_LOG_LEVEL: "fatal"
    }),
    { store: fixture.store }
  );
  try {
    const spaceId = await createSpace(app);
    new KnowledgeRegistry(fixture.store).createPropertyDefinition(
      {
        key: "person.external_id",
        label: "Внешний номер",
        valueType: "string",
        appliesTo: ["person"],
        sensitivity: "personal"
      },
      {
        correlationId: "corr-legacy-field",
        actorType: "test",
        actorId: "operator-1",
        now: "2026-07-15T10:00:00.000Z"
      }
    );
    const rows = [
      {
        "Табельный номер": "001",
        "ФИО": "Иванов Иван",
        "Должность": "Инженер"
      }
    ];
    const payload = {
      ...keylessBody(rows),
      entityTypeKey: "person",
      identityPropertyKey: "person.external_id",
      mappings: [
        { column: "Табельный номер", propertyKey: "person.external_id" }
      ],
      group: null
    };
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${spaceId}/data-import/execute`,
      headers: requestHeaders,
      payload
    });
    assert.equal(response.statusCode, 201, response.body);
    const result = (response.json() as { data: Record<string, unknown> }).data;
    assert.equal(result.entityTypeKey, "person");
    assert.equal(result.identityPropertyKey, "person.external_id");
  } finally {
    await app.close();
    fixture.cleanup();
  }
});
