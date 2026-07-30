import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadApiConfig } from "@docomator/config";
import { KnowledgeRegistry, SpaceRegistry, SqliteStore } from "@docomator/storage";

import { buildApp } from "./app.js";

function migratedFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "docomator-api-db-admin-"));
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

const headers = {
  "x-correlation-id": "corr-api-db-admin",
  "x-actor-id": "administrator"
};

function context(correlationId: string) {
  return {
    correlationId,
    actorType: "test",
    actorId: "administrator",
    now: "2026-07-30T14:00:00.000Z"
  };
}

test("database admin API lists, sorts, exports and checks tables without arbitrary SQL", async () => {
  const fixture = migratedFixture();
  const spaces = new SpaceRegistry(fixture.store);
  const space = spaces.createSpace(
    { key: "database-admin", name: "Администрирование" },
    context("corr-space")
  );
  spaces.createEntity(
    space.id,
    {
      entityTypeKey: "person",
      displayName: "Смирнов Сергей Сергеевич",
      status: "active"
    },
    context("corr-entity")
  );
  const app = buildApp(
    loadApiConfig({
      DOCOMATOR_DATA_DIR: fixture.directory,
      DOCOMATOR_LOG_LEVEL: "fatal"
    }),
    { store: fixture.store }
  );
  try {
    const tables = await app.inject({
      method: "GET",
      url: "/api/v1/admin/database/tables"
    });
    assert.equal(tables.statusCode, 200, tables.body);
    assert.ok(
      (tables.json() as { data: Array<{ name: string }> }).data.some(
        (table) => table.name === "entities"
      )
    );

    const rows = await app.inject({
      method: "GET",
      url: "/api/v1/admin/database/tables/entities/rows?sortColumn=display_name&sortDirection=desc&search=%D0%A1%D0%BC%D0%B8%D1%80%D0%BD%D0%BE%D0%B2"
    });
    assert.equal(rows.statusCode, 200, rows.body);
    const page = rows.json() as {
      data: {
        total: number;
        rows: Array<Record<string, unknown>>;
        sortColumn: string;
      };
    };
    assert.equal(page.data.total, 1);
    assert.equal(page.data.rows[0]?.display_name, "Смирнов Сергей Сергеевич");
    assert.equal(page.data.sortColumn, "display_name");

    const exportResponse = await app.inject({
      method: "GET",
      url: "/api/v1/admin/database/tables/entities/export?format=csv&sortColumn=display_name"
    });
    assert.equal(exportResponse.statusCode, 200, exportResponse.body);
    assert.match(exportResponse.headers["content-type"] ?? "", /^text\/csv/u);
    assert.match(exportResponse.body, /Смирнов Сергей Сергеевич/u);
    assert.ok(exportResponse.body.startsWith("\ufeff"));

    const check = await app.inject({
      method: "GET",
      url: "/api/v1/admin/database/check"
    });
    assert.equal(check.statusCode, 200, check.body);
    assert.deepEqual((check.json() as { data: unknown }).data, {
      status: "ok",
      messages: ["ok"],
      foreignKeyErrors: 0
    });

    const invalid = await app.inject({
      method: "GET",
      url: "/api/v1/admin/database/tables/entities/rows?sortColumn=display_name%20DESC%3B%20DROP%20TABLE%20entities"
    });
    assert.equal(invalid.statusCode, 400, invalid.body);
    assert.equal(
      (invalid.json() as { error: { code: string } }).error.code,
      "database_admin_validation_failed"
    );
  } finally {
    await app.close();
    fixture.cleanup();
  }
});

test("database admin API creates a logical property without altering physical entity columns", async () => {
  const fixture = migratedFixture();
  const app = buildApp(
    loadApiConfig({
      DOCOMATOR_DATA_DIR: fixture.directory,
      DOCOMATOR_LOG_LEVEL: "fatal"
    }),
    { store: fixture.store }
  );
  try {
    const before = fixture.store.execute((database) =>
      database.prepare('PRAGMA table_info("entities")').all()
    );
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/database/properties",
      headers,
      payload: {
        label: "Внутренний номер",
        valueType: "string",
        sensitivity: "internal",
        appliesTo: ["person"]
      }
    });
    assert.equal(response.statusCode, 201, response.body);
    const created = response.json() as { data: { key: string; label: string } };
    assert.equal(created.data.label, "Внутренний номер");
    assert.equal(
      new KnowledgeRegistry(fixture.store).getPropertyDefinition(created.data.key).label,
      "Внутренний номер"
    );
    const after = fixture.store.execute((database) =>
      database.prepare('PRAGMA table_info("entities")').all()
    );
    assert.deepEqual(after, before);
  } finally {
    await app.close();
    fixture.cleanup();
  }
});
