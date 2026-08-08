import assert from "node:assert/strict";
import test from "node:test";

import {
  DataImportValidationError,
  type ExecuteDataImportInput
} from "./data-import.js";
import { KnowledgeRegistry } from "./knowledge.js";
import { SpaceCompatibleDataImportRegistry } from "./space-compatible-data-import.js";
import { SpaceScopedKnowledgeRegistry } from "./space-scoped-knowledge.js";
import { SpaceRegistry } from "./spaces.js";
import { createMigratedTestStore } from "./test-helpers.js";

const NOW = "2026-08-08T16:40:00.000Z";

function context(id: string) {
  return {
    correlationId: id,
    actorType: "test",
    actorId: "operator",
    now: NOW
  };
}

function input(propertyKey: string): ExecuteDataImportInput {
  return {
    fileName: "people.csv",
    fileFormat: "csv",
    sourceSha256: "a".repeat(64),
    entityTypeKey: "person",
    identityColumn: "Код",
    displayNameColumn: "ФИО",
    headers: ["Код", "ФИО", "Кафедра"],
    rows: [{ Код: "1", ФИО: "Иванов Иван", Кафедра: "Кафедра А" }],
    mappings: [
      {
        column: "Кафедра",
        propertyKey,
        createIfMissing: false
      }
    ]
  };
}

test("saved legacy import mapping resolves only to the clone of its space", () => {
  const fixture = createMigratedTestStore();
  try {
    const spaces = new SpaceRegistry(fixture.store);
    const alpha = spaces.createSpace(
      { key: "import-alias-a", name: "Импорт A" },
      context("space-a")
    );
    const beta = spaces.createSpace(
      { key: "import-alias-b", name: "Импорт B" },
      context("space-b")
    );
    const alphaKnowledge = new SpaceScopedKnowledgeRegistry(
      fixture.store,
      alpha.id,
      { spaces }
    );
    const clone = alphaKnowledge.createPropertyDefinition(
      {
        key: "employee_field_department_a",
        label: "Кафедра",
        valueType: "string",
        appliesTo: ["person"]
      },
      context("clone")
    );
    const historical = new KnowledgeRegistry(fixture.store).createPropertyDefinition(
      {
        key: "person.department.old",
        label: "Кафедра",
        valueType: "string",
        appliesTo: ["person"]
      },
      context("legacy")
    );
    fixture.store.execute((database) => {
      database
        .prepare(`
          INSERT INTO space_property_definition_aliases(
            space_id, alias_key, property_definition_id, created_at
          ) VALUES (?, ?, ?, ?)
        `)
        .run(alpha.id, historical.key, clone.id, NOW);
    });

    const imports = new SpaceCompatibleDataImportRegistry(fixture.store, {
      spaces
    });
    const result = imports.execute(
      alpha.id,
      input(historical.key),
      context("import-a")
    );
    assert.equal(result.state, "completed");
    assert.equal(result.createdCount, 1);

    const alphaEntity = spaces.listEntities(alpha.id, {
      entityTypeKey: "person",
      limit: 10
    })[0];
    assert.ok(alphaEntity);
    assert.deepEqual(
      alphaKnowledge
        .listPropertyValueHistory(alphaEntity.entityId, { propertyKey: historical.key })
        .map((record) => record.value),
      ["Кафедра А"]
    );

    assert.throws(
      () => imports.execute(beta.id, input(historical.key), context("import-b")),
      DataImportValidationError
    );
    assert.equal(
      spaces.listEntities(beta.id, { entityTypeKey: "person", limit: 10 }).length,
      0
    );
  } finally {
    fixture.cleanup();
  }
});
