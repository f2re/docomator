import assert from "node:assert/strict";
import test from "node:test";

import { KnowledgeNotFoundError, KnowledgeRegistry } from "./knowledge.js";
import { SpaceScopedKnowledgeRegistry } from "./space-scoped-knowledge.js";
import { SpaceRegistry } from "./spaces.js";
import { createMigratedTestStore } from "./test-helpers.js";

const NOW = "2026-08-07T07:00:00.000Z";

function context(correlationId: string) {
  return {
    correlationId,
    actorType: "test",
    actorId: "operator-1",
    now: NOW
  };
}

test("property definitions are isolated by space", () => {
  const fixture = createMigratedTestStore();
  try {
    const spaces = new SpaceRegistry(fixture.store);
    const first = spaces.createSpace(
      { key: "space-fields-a", name: "Пространство A" },
      context("corr-space-a")
    );
    const second = spaces.createSpace(
      { key: "space-fields-b", name: "Пространство B" },
      context("corr-space-b")
    );
    const firstKnowledge = new SpaceScopedKnowledgeRegistry(
      fixture.store,
      first.id,
      { spaces }
    );
    const secondKnowledge = new SpaceScopedKnowledgeRegistry(
      fixture.store,
      second.id,
      { spaces }
    );

    const firstField = firstKnowledge.createPropertyDefinition(
      {
        label: "Должность",
        valueType: "string",
        sensitivity: "personal",
        appliesTo: ["person"]
      },
      context("corr-field-a")
    );
    const secondField = secondKnowledge.createPropertyDefinition(
      {
        label: "Должность",
        valueType: "string",
        sensitivity: "personal",
        appliesTo: ["person"]
      },
      context("corr-field-b")
    );

    assert.notEqual(firstField.key, secondField.key);
    assert.deepEqual(
      firstKnowledge.listPropertyDefinitions(500).map((item) => item.key),
      [firstField.key]
    );
    assert.deepEqual(
      secondKnowledge.listPropertyDefinitions(500).map((item) => item.key),
      [secondField.key]
    );
    assert.throws(
      () => secondKnowledge.getPropertyDefinition(firstField.key),
      KnowledgeNotFoundError
    );
  } finally {
    fixture.cleanup();
  }
});

test("scoped reads never acquire an unowned legacy field", () => {
  const fixture = createMigratedTestStore();
  try {
    const spaces = new SpaceRegistry(fixture.store);
    const space = spaces.createSpace(
      { key: "space-read-only", name: "Чтение без побочных эффектов" },
      context("corr-space")
    );
    const globalKnowledge = new KnowledgeRegistry(fixture.store);
    const legacy = globalKnowledge.createPropertyDefinition(
      {
        key: "legacy.unowned.field",
        label: "Старое поле без владельца",
        valueType: "string",
        appliesTo: ["person"]
      },
      context("corr-global-field")
    );
    const scoped = new SpaceScopedKnowledgeRegistry(fixture.store, space.id, {
      spaces
    });

    assert.throws(
      () => scoped.getPropertyDefinition(legacy.key),
      KnowledgeNotFoundError
    );
    const beforeAdoption = fixture.store.execute((database) =>
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM space_property_definitions WHERE property_definition_id = ?"
        )
        .get(legacy.id) as { count: number }
    );
    assert.equal(beforeAdoption.count, 0);

    const adopted = scoped.adoptUnownedPropertyDefinition(legacy.key);
    assert.equal(adopted?.id, legacy.id);
    assert.equal(scoped.getPropertyDefinition(legacy.key).id, legacy.id);
    const afterAdoption = fixture.store.execute((database) =>
      database
        .prepare(
          "SELECT space_id FROM space_property_definitions WHERE property_definition_id = ?"
        )
        .get(legacy.id) as { space_id: string } | undefined
    );
    assert.equal(afterAdoption?.space_id, space.id);
  } finally {
    fixture.cleanup();
  }
});

test("database rejects a property from another space even through global registry", () => {
  const fixture = createMigratedTestStore();
  try {
    const spaces = new SpaceRegistry(fixture.store);
    const first = spaces.createSpace(
      { key: "space-guard-a", name: "Пространство A" },
      context("corr-space-a")
    );
    const second = spaces.createSpace(
      { key: "space-guard-b", name: "Пространство B" },
      context("corr-space-b")
    );
    const firstKnowledge = new SpaceScopedKnowledgeRegistry(
      fixture.store,
      first.id,
      { spaces }
    );
    const field = firstKnowledge.createPropertyDefinition(
      {
        label: "Внутренний номер",
        valueType: "string",
        sensitivity: "internal",
        appliesTo: ["person"]
      },
      context("corr-field")
    );
    const entity = spaces.createEntity(
      second.id,
      {
        entityTypeKey: "person",
        displayName: "Иванов Иван Иванович"
      },
      context("corr-entity")
    );
    const globalKnowledge = new KnowledgeRegistry(fixture.store);

    assert.throws(
      () =>
        globalKnowledge.appendPropertyValue(
          {
            entityId: entity.entityId,
            propertyKey: field.key,
            value: "42",
            sourceType: "test"
          },
          context("corr-value")
        ),
      /property definition is outside entity space/u
    );
  } finally {
    fixture.cleanup();
  }
});
