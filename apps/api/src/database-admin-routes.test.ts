import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadApiConfig } from "@docomator/config";
import {
  AuditRepository,
  SpaceRegistry,
  SpaceScopedKnowledgeRegistry,
  SqliteStore
} from "@docomator/storage";

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

test("database admin API lists, sorts, audits exports and checks tables without arbitrary SQL", async () => {
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
    assert.equal(tables.headers["cache-control"], "no-store");
    const entitiesTable = (
      tables.json() as {
        data: Array<{
          name: string;
          label: string;
          category: string;
          description: string;
          sensitivity: string;
        }>;
      }
    ).data.find((table) => table.name === "entities");
    assert.ok(entitiesTable);
    assert.equal(entitiesTable.label, "Объекты и сотрудники");
    assert.equal(entitiesTable.category, "Основные данные");
    assert.equal(
      entitiesTable.description,
      "Карточки людей и других объектов, доступных в разделах Docomator."
    );
    assert.equal(entitiesTable.sensitivity, "personal");

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
        presentation: {
          label: string;
          category: string;
          description: string;
          sensitivity: string;
        };
      };
    };
    assert.equal(page.data.total, 1);
    assert.equal(page.data.rows[0]?.display_name, "Смирнов Сергей Сергеевич");
    assert.equal(page.data.sortColumn, "display_name");
    assert.deepEqual(page.data.presentation, {
      label: "Объекты и сотрудники",
      category: "Основные данные",
      description:
        "Карточки людей и других объектов, доступных в разделах Docomator.",
      sensitivity: "personal"
    });

    const exportResponse = await app.inject({
      method: "GET",
      url: "/api/v1/admin/database/tables/entities/export?format=csv&sortColumn=display_name",
      headers
    });
    assert.equal(exportResponse.statusCode, 200, exportResponse.body);
    assert.equal(exportResponse.headers["cache-control"], "no-store");
    assert.match(exportResponse.headers["content-type"] ?? "", /^text\/csv/u);
    assert.match(exportResponse.body, /Смирнов Сергей Сергеевич/u);
    assert.ok(exportResponse.body.startsWith("\ufeff"));
    const exportAudit = new AuditRepository(fixture.store).listByCorrelation(
      "corr-api-db-admin"
    );
    assert.equal(exportAudit.length, 1);
    assert.equal(exportAudit[0]?.action, "export");
    assert.equal(exportAudit[0]?.objectId, "entities");
    assert.deepEqual(exportAudit[0]?.details, {
      filtered: false,
      format: "csv",
      rowCount: 1,
      sortColumn: "display_name",
      sortDirection: "asc"
    });

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

test("database admin API creates a typed logical property only in the selected space", async () => {
  const fixture = migratedFixture();
  const spaces = new SpaceRegistry(fixture.store);
  const space = spaces.createSpace(
    { key: "database-admin-fields", name: "Поля администратора" },
    context("corr-admin-field-space")
  );
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
    const missingSpace = await app.inject({
      method: "POST",
      url: "/api/v1/admin/database/properties",
      headers,
      payload: {
        label: "Без пространства",
        valueType: "string"
      }
    });
    assert.equal(missingSpace.statusCode, 400, missingSpace.body);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/database/properties?spaceId=${encodeURIComponent(space.id)}`,
      headers,
      payload: {
        label: "Внутренний номер",
        valueType: "enum",
        cardinality: "multiple",
        sensitivity: "internal",
        appliesTo: ["person"],
        aliases: ["номер сотрудника", "внутренний код"],
        validation: { enum: ["А", "Б"] }
      }
    });
    assert.equal(response.statusCode, 201, response.body);
    const created = response.json() as {
      data: {
        key: string;
        label: string;
        cardinality: string;
        aliases: string[];
        validation: unknown;
      };
    };
    assert.equal(created.data.label, "Внутренний номер");
    assert.equal(created.data.cardinality, "multiple");
    assert.deepEqual(created.data.aliases, ["внутренний код", "номер сотрудника"]);
    assert.deepEqual(created.data.validation, { enum: ["А", "Б"] });
    assert.equal(
      new SpaceScopedKnowledgeRegistry(fixture.store, space.id).getPropertyDefinition(
        created.data.key
      ).label,
      "Внутренний номер"
    );
    const scope = fixture.store.execute((database) =>
      database
        .prepare(`
          SELECT scoped.space_id
          FROM space_property_definitions scoped
          JOIN property_definitions definition
            ON definition.id = scoped.property_definition_id
          WHERE definition.key = ?
        `)
        .get(created.data.key) as { space_id: string } | undefined
    );
    assert.equal(scope?.space_id, space.id);
    const after = fixture.store.execute((database) =>
      database.prepare('PRAGMA table_info("entities")').all()
    );
    assert.deepEqual(after, before);
  } finally {
    await app.close();
    fixture.cleanup();
  }
});
