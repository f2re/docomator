import assert from "node:assert/strict";
import test from "node:test";

import {
  KnowledgeConflictError,
  KnowledgeRegistry,
  KnowledgeValidationError
} from "./knowledge.js";
import { createMigratedTestStore } from "./test-helpers.js";

const T0 = "2026-07-11T10:00:00.000Z";

function context(correlationId: string) {
  return {
    correlationId,
    actorType: "test",
    actorId: "test-user",
    now: T0
  };
}

test("knowledge mutations append outbox and audit records atomically", () => {
  const fixture = createMigratedTestStore();
  try {
    const registry = new KnowledgeRegistry(fixture.store);
    const personType = registry.createEntityType(
      { key: "person", label: "Человек" },
      context("corr-person-type")
    );
    registry.createEntityType(
      { key: "organization", label: "Организация" },
      context("corr-organization-type")
    );
    const height = registry.createPropertyDefinition(
      {
        key: "person.height",
        label: "Рост",
        valueType: "number",
        unit: "cm",
        sensitivity: "personal",
        appliesTo: ["person"],
        aliases: ["рост", "height"]
      },
      context("corr-height-definition")
    );
    const person = registry.createEntity(
      {
        entityTypeKey: personType.key,
        displayName: "Иванов Иван Иванович"
      },
      context("corr-person")
    );

    const first = registry.appendPropertyValue(
      {
        entityId: person.id,
        propertyKey: height.key,
        value: 180,
        sourceType: "user_input",
        confirmedBy: "test-user",
        validFrom: "2026-01-01"
      },
      context("corr-height-1")
    );
    const second = registry.appendPropertyValue(
      {
        entityId: person.id,
        propertyKey: height.key,
        value: 182.5,
        sourceType: "measurement",
        confidence: 0.98,
        validFrom: "2026-07-01"
      },
      context("corr-height-2")
    );

    assert.equal(first.version, 1);
    assert.equal(second.version, 2);
    assert.deepEqual(
      registry
        .listPropertyValueHistory(person.id, { propertyKey: height.key })
        .map((value) => ({ version: value.version, value: value.value })),
      [
        { version: 2, value: 182.5 },
        { version: 1, value: 180 }
      ]
    );

    const projection = fixture.store.execute(
      (database) =>
        database
          .prepare(`
            SELECT value_type, value_number
            FROM entity_property_values
            WHERE id = ?
          `)
          .get(second.id) as { value_type: string; value_number: number }
    );
    assert.equal(projection.value_type, "number");
    assert.equal(projection.value_number, 182.5);

    const counts = fixture.store.execute((database) => ({
      events: Number(
        (
          database.prepare("SELECT COUNT(*) AS count FROM domain_events").get() as {
            count: number;
          }
        ).count
      ),
      audit: Number(
        (
          database.prepare("SELECT COUNT(*) AS count FROM audit_log").get() as {
            count: number;
          }
        ).count
      )
    }));
    assert.deepEqual(counts, { events: 6, audit: 6 });
  } finally {
    fixture.cleanup();
  }
});

test("property scope and enum validation are enforced before mutation", () => {
  const fixture = createMigratedTestStore();
  try {
    const registry = new KnowledgeRegistry(fixture.store);
    registry.createEntityType(
      { key: "person", label: "Человек" },
      context("corr-type-person")
    );
    registry.createEntityType(
      { key: "organization", label: "Организация" },
      context("corr-type-organization")
    );
    registry.createPropertyDefinition(
      {
        key: "person.activity_status",
        label: "Статус",
        valueType: "enum",
        appliesTo: ["person"],
        validation: { enum: ["active", "inactive"] }
      },
      context("corr-property-status")
    );
    const organization = registry.createEntity(
      {
        entityTypeKey: "organization",
        displayName: "ООО Ромашка"
      },
      context("corr-organization")
    );
    const person = registry.createEntity(
      { entityTypeKey: "person", displayName: "Петров Пётр" },
      context("corr-person")
    );

    assert.throws(
      () =>
        registry.appendPropertyValue(
          {
            entityId: organization.id,
            propertyKey: "person.activity_status",
            value: "active",
            sourceType: "test"
          },
          context("corr-invalid-scope")
        ),
      KnowledgeValidationError
    );
    assert.throws(
      () =>
        registry.appendPropertyValue(
          {
            entityId: person.id,
            propertyKey: "person.activity_status",
            value: "unknown",
            sourceType: "test"
          },
          context("corr-invalid-enum")
        ),
      /enum value is not allowed/
    );

    const values = registry.listPropertyValueHistory(person.id);
    assert.equal(values.length, 0);
  } finally {
    fixture.cleanup();
  }
});

test("stable keys are unique and invalid keys are rejected", () => {
  const fixture = createMigratedTestStore();
  try {
    const registry = new KnowledgeRegistry(fixture.store);
    registry.createEntityType(
      { key: "person", label: "Человек" },
      context("corr-first")
    );
    assert.throws(
      () =>
        registry.createEntityType(
          { key: "PERSON", label: "Дубликат" },
          context("corr-duplicate")
        ),
      KnowledgeConflictError
    );
    assert.throws(
      () =>
        registry.createPropertyDefinition(
          {
            key: "Некорректный ключ",
            label: "Некорректное свойство",
            valueType: "string"
          },
          context("corr-invalid-key")
        ),
      KnowledgeValidationError
    );
  } finally {
    fixture.cleanup();
  }
});
