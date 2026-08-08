import assert from "node:assert/strict";
import test from "node:test";

import { loadDocumentMemberProperties } from "./document-member-properties.js";
import { KnowledgeRegistry } from "./knowledge.js";
import { SpaceScopedKnowledgeRegistry } from "./space-scoped-knowledge.js";
import { SpaceRegistry } from "./spaces.js";
import { createMigratedTestStore } from "./test-helpers.js";

const NOW = "2026-08-08T16:30:00.000Z";

function context(id: string) {
  return {
    correlationId: id,
    actorType: "test",
    actorId: "operator",
    now: NOW
  };
}

test("document property projection exposes a historical key only through the selected space alias", () => {
  const fixture = createMigratedTestStore();
  try {
    const spaces = new SpaceRegistry(fixture.store);
    const alpha = spaces.createSpace(
      { key: "doc-alias-a", name: "Документы A" },
      context("space-a")
    );
    const entity = spaces.createEntity(
      alpha.id,
      { entityTypeKey: "person", displayName: "Иванов Иван" },
      context("entity")
    );
    const scoped = new SpaceScopedKnowledgeRegistry(fixture.store, alpha.id, {
      spaces
    });
    const clone = scoped.createPropertyDefinition(
      {
        key: "employee_field_physical",
        label: "Подразделение",
        valueType: "string",
        appliesTo: ["person"]
      },
      context("clone")
    );
    const historical = new KnowledgeRegistry(fixture.store).createPropertyDefinition(
      {
        key: "person.department.legacy",
        label: "Подразделение",
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
    scoped.appendPropertyValue(
      {
        entityId: entity.entityId,
        propertyKey: clone.key,
        value: "Кафедра А",
        sourceType: "test"
      },
      context("value")
    );

    const projection = fixture.store.execute((database) =>
      loadDocumentMemberProperties(database, alpha.id, [entity.entityId])
    );
    assert.deepEqual(projection.get(entity.entityId), {
      [clone.key]: "Кафедра А",
      [historical.key]: "Кафедра А"
    });
  } finally {
    fixture.cleanup();
  }
});
