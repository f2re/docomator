import assert from "node:assert/strict";
import test from "node:test";

import {
  DatabaseAdminRegistry,
  DatabaseAdminValidationError
} from "./database-admin.js";
import { KnowledgeRegistry } from "./knowledge.js";
import { SpaceRegistry } from "./spaces.js";
import { createMigratedTestStore } from "./test-helpers.js";

const NOW = "2026-07-30T13:00:00.000Z";

function context(correlationId: string) {
  return {
    correlationId,
    actorType: "test",
    actorId: "administrator",
    now: NOW
  };
}

test("database admin lists, searches, sorts and exports only validated tables", () => {
  const fixture = createMigratedTestStore();
  try {
    const spaces = new SpaceRegistry(fixture.store);
    const registry = new DatabaseAdminRegistry(fixture.store);
    const space = spaces.createSpace(
      { key: "database-admin", name: "Администрирование" },
      context("corr-space")
    );
    spaces.createEntity(
      space.id,
      {
        entityTypeKey: "person",
        displayName: "Яковлев Яков Яковлевич",
        status: "active"
      },
      context("corr-yakovlev")
    );
    spaces.createEntity(
      space.id,
      {
        entityTypeKey: "person",
        displayName: "=ОПАСНАЯ ФОРМУЛА",
        status: "active"
      },
      context("corr-formula")
    );

    const tables = registry.listTables();
    assert.ok(tables.some((table) => table.name === "entities"));
    const description = registry.describeTable("entities");
    assert.ok(description.rowCount >= 2);
    assert.ok(description.columns.some((column) => column.name === "display_name"));

    const page = registry.listRows({
      table: "entities",
      search: "Яковлев",
      sortColumn: "display_name",
      sortDirection: "desc",
      limit: 25
    });
    assert.equal(page.rows.length, 1);
    assert.equal(page.rows[0]?.["display_name"], "Яковлев Яков Яковлевич");
    assert.equal(page.sortColumn, "display_name");
    assert.equal(page.sortDirection, "desc");

    const csv = registry.exportTable({
      table: "entities",
      format: "csv",
      sortColumn: "display_name",
      limit: 10_000
    });
    assert.equal(csv.contentType, "text/csv; charset=utf-8");
    assert.ok(csv.content.startsWith("\ufeff"));
    assert.match(csv.content, /'\=ОПАСНАЯ ФОРМУЛА/u);

    const json = registry.exportTable({
      table: "entities",
      format: "json",
      search: "Яковлев"
    });
    assert.deepEqual(JSON.parse(json.content).map((row: Record<string, unknown>) => row.display_name), [
      "Яковлев Яков Яковлевич"
    ]);

    assert.throws(
      () => registry.listRows({ table: "sqlite_master" }),
      DatabaseAdminValidationError
    );
    assert.throws(
      () =>
        registry.listRows({
          table: "entities",
          sortColumn: "display_name DESC; DROP TABLE entities"
        }),
      DatabaseAdminValidationError
    );
    assert.deepEqual(registry.quickCheck(), {
      status: "ok",
      messages: ["ok"],
      foreignKeyErrors: 0
    });
  } finally {
    fixture.cleanup();
  }
});

test("database admin adds a logical property without altering the physical entity table", () => {
  const fixture = createMigratedTestStore();
  try {
    const knowledge = new KnowledgeRegistry(fixture.store);
    const registry = new DatabaseAdminRegistry(fixture.store, knowledge);
    const before = fixture.store.execute((database) =>
      database.prepare('PRAGMA table_info("entities")').all()
    );

    const property = registry.createPropertyDefinition(
      {
        label: "Инвентарный номер",
        valueType: "string",
        sensitivity: "internal",
        appliesTo: ["person"]
      },
      context("corr-property")
    );

    const after = fixture.store.execute((database) =>
      database.prepare('PRAGMA table_info("entities")').all()
    );
    assert.deepEqual(after, before);
    assert.equal(knowledge.getPropertyDefinition(property.key).label, "Инвентарный номер");
  } finally {
    fixture.cleanup();
  }
});
