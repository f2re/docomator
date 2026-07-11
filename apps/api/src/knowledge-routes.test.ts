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

function migratedFixture(): {
  directory: string;
  store: SqliteStore;
  cleanup: () => void;
} {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "docomator-api-knowledge-"));
  const databasePath = path.join(directory, "docomator.db");
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON;");
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDirectory = path.resolve(currentDirectory, "../../../migrations");
  for (const migration of fs
    .readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
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

const headers = {
  "x-correlation-id": "corr-api-knowledge",
  "x-actor-id": "operator-1"
};

test("knowledge API creates typed data with outbox and audit", async () => {
  const fixture = migratedFixture();
  const app = buildApp(
    loadApiConfig({
      DOCOMATOR_DATA_DIR: fixture.directory,
      DOCOMATOR_LOG_LEVEL: "fatal"
    }),
    { store: fixture.store }
  );

  try {
    const ready = await app.inject({ method: "GET", url: "/readyz" });
    assert.equal(ready.statusCode, 200);

    const typeResponse = await app.inject({
      method: "POST",
      url: "/api/v1/knowledge/entity-types",
      headers,
      payload: { key: "person", label: "Человек" }
    });
    assert.equal(typeResponse.statusCode, 201, typeResponse.body);
    assert.equal(typeResponse.headers["x-correlation-id"], headers["x-correlation-id"]);

    const propertyResponse = await app.inject({
      method: "POST",
      url: "/api/v1/knowledge/property-definitions",
      headers,
      payload: {
        key: "person.height",
        label: "Рост",
        valueType: "number",
        unit: "cm",
        appliesTo: ["person"],
        sensitivity: "personal"
      }
    });
    assert.equal(propertyResponse.statusCode, 201, propertyResponse.body);

    const entityResponse = await app.inject({
      method: "POST",
      url: "/api/v1/knowledge/entities",
      headers,
      payload: {
        entityTypeKey: "person",
        displayName: "Иванов Иван Иванович"
      }
    });
    assert.equal(entityResponse.statusCode, 201, entityResponse.body);
    const entityId = (entityResponse.json() as { data: { id: string } }).data.id;

    const valueResponse = await app.inject({
      method: "PUT",
      url: `/api/v1/knowledge/entities/${entityId}/properties/person.height`,
      headers,
      payload: {
        value: 181.5,
        sourceType: "user_input",
        confirmedBy: "operator-1"
      }
    });
    assert.equal(valueResponse.statusCode, 201, valueResponse.body);
    assert.equal(
      (valueResponse.json() as { data: { value: number; version: number } }).data.value,
      181.5
    );

    const historyResponse = await app.inject({
      method: "GET",
      url: `/api/v1/knowledge/entities/${entityId}/property-values?propertyKey=person.height`
    });
    assert.equal(historyResponse.statusCode, 200, historyResponse.body);
    const history = historyResponse.json() as {
      data: Array<{ value: number; valueType: string; version: number }>;
    };
    assert.deepEqual(history.data, [
      assert.match(history.data[0]?.valueType ?? "", /^number$/) as never
    ]);
  } finally {
    await app.close();
  }

  try {
    const counts = fixture.store.execute((database) => ({
      events: Number(
        (database.prepare("SELECT COUNT(*) AS count FROM domain_events").get() as {
          count: number;
        }).count
      ),
      audit: Number(
        (database.prepare("SELECT COUNT(*) AS count FROM audit_log").get() as {
          count: number;
        }).count
      )
    }));
    assert.deepEqual(counts, { events: 4, audit: 4 });
  } finally {
    fixture.cleanup();
  }
});

test("knowledge API returns stable validation and conflict errors", async () => {
  const fixture = migratedFixture();
  const app = buildApp(
    loadApiConfig({
      DOCOMATOR_DATA_DIR: fixture.directory,
      DOCOMATOR_LOG_LEVEL: "fatal"
    }),
    { store: fixture.store }
  );

  try {
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/knowledge/entity-types",
      headers,
      payload: { key: "person", label: "Человек" }
    });
    assert.equal(first.statusCode, 201);
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/knowledge/entity-types",
      headers,
      payload: { key: "person", label: "Дубликат" }
    });
    assert.equal(duplicate.statusCode, 409);
    assert.equal(
      (duplicate.json() as { error: { code: string } }).error.code,
      "knowledge_conflict"
    );

    await app.inject({
      method: "POST",
      url: "/api/v1/knowledge/property-definitions",
      headers,
      payload: {
        key: "person.height",
        label: "Рост",
        valueType: "number",
        appliesTo: ["person"]
      }
    });
    const entity = await app.inject({
      method: "POST",
      url: "/api/v1/knowledge/entities",
      headers,
      payload: { entityTypeKey: "person", displayName: "Петров Пётр" }
    });
    const entityId = (entity.json() as { data: { id: string } }).data.id;
    const invalidValue = await app.inject({
      method: "PUT",
      url: `/api/v1/knowledge/entities/${entityId}/properties/person.height`,
      headers,
      payload: { value: "не число", sourceType: "user_input" }
    });
    assert.equal(invalidValue.statusCode, 400, invalidValue.body);
    assert.equal(
      (invalidValue.json() as { error: { code: string } }).error.code,
      "property_value_validation_failed"
    );

    const missingType = await app.inject({
      method: "POST",
      url: "/api/v1/knowledge/entities",
      headers,
      payload: { entityTypeKey: "unknown", displayName: "Неизвестный объект" }
    });
    assert.equal(missingType.statusCode, 404);
  } finally {
    await app.close();
    fixture.cleanup();
  }
});
