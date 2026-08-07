import assert from "node:assert/strict";
import test from "node:test";

import { AuditRepository } from "./audit.js";
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
    const audit = new AuditRepository(fixture.store);
    const registry = new DatabaseAdminRegistry(
      fixture.store,
      new KnowledgeRegistry(fixture.store),
      audit
    );
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
    const entitiesTable = tables.find((table) => table.name === "entities");
    assert.ok(entitiesTable);
    assert.equal(entitiesTable.label, "Объекты и сотрудники");
    assert.equal(entitiesTable.category, "Основные данные");
    assert.equal(entitiesTable.sensitivity, "personal");

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
    assert.equal(page.presentation.label, "Объекты и сотрудники");

    const csv = registry.exportTable(
      {
        table: "entities",
        format: "csv",
        sortColumn: "display_name",
        limit: 10_000
      },
      context("corr-export-csv")
    );
    assert.equal(csv.contentType, "text/csv; charset=utf-8");
    assert.ok(csv.content.startsWith("\ufeff"));
    assert.match(csv.content, /'=ОПАСНАЯ ФОРМУЛА/u);

    const exportAudit = audit.listByCorrelation("corr-export-csv");
    assert.equal(exportAudit.length, 1);
    assert.equal(exportAudit[0]?.action, "export");
    assert.equal(exportAudit[0]?.objectType, "database_table");
    assert.equal(exportAudit[0]?.objectId, "entities");
    assert.deepEqual(exportAudit[0]?.details, {
      filtered: false,
      format: "csv",
      rowCount: 2,
      sortColumn: "display_name",
      sortDirection: "asc"
    });

    const json = registry.exportTable({
      table: "entities",
      format: "json",
      search: "Яковлев"
    });
    assert.deepEqual(
      JSON.parse(json.content).map(
        (row: Record<string, unknown>) => row.display_name
      ),
      ["Яковлев Яков Яковлевич"]
    );

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

test("database admin adds a logical property to the selected space without altering the physical entity table", () => {
  const fixture = createMigratedTestStore();
  try {
    const knowledge = new KnowledgeRegistry(fixture.store);
    const spaces = new SpaceRegistry(fixture.store);
    const registry = new DatabaseAdminRegistry(fixture.store, knowledge);
    const space = spaces.createSpace(
      { key: "admin-fields", name: "Поля администратора" },
      context("corr-admin-space")
    );
    const otherSpace = spaces.createSpace(
      { key: "admin-fields-other", name: "Другое пространство" },
      context("corr-admin-space-other")
    );
    const before = fixture.store.execute((database) =>
      database.prepare('PRAGMA table_info("entities")').all()
    );

    const property = registry.createPropertyDefinition(
      space.id,
      {
        label: "Инвентарный номер",
        valueType: "string",
        cardinality: "multiple",
        sensitivity: "internal",
        appliesTo: ["person"],
        aliases: ["инв. номер", "номер имущества"]
      },
      context("corr-property")
    );

    const after = fixture.store.execute((database) =>
      database.prepare('PRAGMA table_info("entities")').all()
    );
    assert.deepEqual(after, before);
    const saved = knowledge.getPropertyDefinition(property.key);
    assert.equal(saved.label, "Инвентарный номер");
    assert.equal(saved.cardinality, "multiple");
    assert.deepEqual(saved.aliases, ["инв. номер", "номер имущества"]);
    const scopes = fixture.store.execute((database) =>
      database
        .prepare(`
          SELECT scoped.space_id
          FROM space_property_definitions scoped
          JOIN property_definitions definition
            ON definition.id = scoped.property_definition_id
          WHERE definition.key = ?
        `)
        .all(property.key) as unknown as Array<{ space_id: string }>
    );
    assert.deepEqual(scopes.map((row) => row.space_id), [space.id]);
    assert.ok(!scopes.some((row) => row.space_id === otherSpace.id));
  } finally {
    fixture.cleanup();
  }
});
