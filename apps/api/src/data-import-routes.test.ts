import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadApiConfig } from "@docomator/config";
import { SpaceScopedKnowledgeRegistry, SqliteStore } from "@docomator/storage";

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

test("API returns typed duplicate coordinates during planning", async () => {
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
      data: {
        failedCount: number;
        errors: Array<{
          rowNumber: number;
          code: string;
          column?: string;
          rawValue?: string;
          severity: string;
          suggestedAction: string;
          repair: { kind: string };
        }>;
      };
    };
    assert.equal(result.data.failedCount, 2);
    assert.deepEqual(
      result.data.errors.map((error) => ({
        rowNumber: error.rowNumber,
        code: error.code,
        column: error.column,
        rawValue: error.rawValue,
        severity: error.severity,
        repair: error.repair.kind
      })),
      [
        {
          rowNumber: 2,
          code: "duplicate_identity",
          column: "Табельный номер",
          rawValue: "001",
          severity: "error",
          repair: "choose_identity_column"
        },
        {
          rowNumber: 3,
          code: "duplicate_identity",
          column: "Табельный номер",
          rawValue: "001",
          severity: "error",
          repair: "choose_identity_column"
        }
      ]
    );
    assert.ok(result.data.errors.every((error) => error.suggestedAction.length > 0));
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
    new SpaceScopedKnowledgeRegistry(fixture.store, spaceId).createPropertyDefinition(
      {
        key: "person.external_id",
        label: "Внешний номер",
        valueType: "string",
        appliesTo: ["person"],
        sensitivity: "personal"
      },
      {
        correlationId: "corr-technical-field",
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


test("preview keeps a structured legacy XLS error instead of a generic parse failure", async () => {
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
      url: `/api/v1/spaces/${spaceId}/data-import/preview?fileName=employees.xls`,
      headers: { ...requestHeaders, "content-type": "application/octet-stream" },
      payload: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    });
    assert.equal(response.statusCode, 422, response.body);
    const body = response.json() as {
      error: {
        code: string;
        message: string;
        issue: {
          scope: string;
          blockingEffect: string;
          suggestedAction: string;
          repair: { kind: string; acceptedFormats?: string[] };
        };
      };
    };
    assert.equal(body.error.code, "unsupported_legacy_xls");
    assert.equal(body.error.issue.scope, "file");
    assert.equal(body.error.issue.blockingEffect, "file");
    assert.equal(body.error.issue.repair.kind, "replace_file");
    assert.deepEqual(body.error.issue.repair.acceptedFormats, ["CSV", "XLSX"]);
  } finally {
    await app.close();
    fixture.cleanup();
  }
});

test("mapping validation returns a column coordinate without parsing Russian text", async () => {
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
    new SpaceScopedKnowledgeRegistry(fixture.store, spaceId).createPropertyDefinition(
      {
        label: "Возраст",
        valueType: "number",
        appliesTo: ["person"],
        sensitivity: "personal"
      },
      {
        correlationId: "corr-mapping-type",
        actorType: "test",
        actorId: "operator-1",
        now: "2026-08-12T06:00:00.000Z"
      }
    );
    const rows = [
      { "Табельный номер": "001", "ФИО": "Иванов Иван", "Возраст": "35" }
    ];
    const sourceSha256 = "c".repeat(64);
    const headers = ["Табельный номер", "ФИО", "Возраст"];
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${spaceId}/data-import/plan`,
      headers: requestHeaders,
      payload: {
        fileName: "employees.xlsx",
        fileFormat: "xlsx",
        sourceSha256,
        previewToken: createImportPreviewToken({ sourceSha256, headers, rows }),
        identityColumn: "Табельный номер",
        displayNameColumn: "ФИО",
        headers,
        rows,
        mappings: [
          {
            column: "Возраст",
            createIfMissing: true,
            label: "Возраст",
            valueType: "string"
          }
        ]
      }
    });
    assert.equal(response.statusCode, 400, response.body);
    const body = response.json() as {
      error: {
        code: string;
        issue: {
          code: string;
          scope: string;
          blockingEffect: string;
          column?: string;
          suggestedAction: string;
          repair: { kind: string; column?: string };
        };
      };
    };
    assert.equal(body.error.code, "mapping_type_mismatch");
    assert.equal(body.error.issue.scope, "mapping");
    assert.equal(body.error.issue.blockingEffect, "mapping");
    assert.equal(body.error.issue.column, "Возраст");
    assert.equal(body.error.issue.repair.kind, "change_field_type");
    assert.match(body.error.issue.suggestedAction, /тип/u);
  } finally {
    await app.close();
    fixture.cleanup();
  }
});
