import assert from "node:assert/strict";
import test from "node:test";

import { AuditRepository } from "./audit.js";
import {
  EntityCollectionNotFoundError,
  EntityCollectionRegistry,
  EntityCollectionValidationError
} from "./entity-collections.js";
import { SpaceRegistry } from "./spaces.js";
import { createMigratedTestStore } from "./test-helpers.js";

const T0 = "2026-08-24T10:00:00.000Z";

function context(correlationId: string) {
  return {
    correlationId,
    actorType: "test",
    actorId: "operator-collections",
    now: T0
  };
}

function planDefinition(collections: EntityCollectionRegistry, spaceId: string) {
  return collections.createDefinition(
    spaceId,
    {
      label: "Пункты плана",
      ownerEntityTypeKey: "person",
      fields: [
        {
          key: "plan.question",
          label: "Наименование вопроса",
          valueType: "string",
          required: true
        },
        {
          key: "plan.due_date",
          label: "Срок выполнения",
          valueType: "date"
        },
        {
          key: "plan.reporting",
          label: "Отчётность",
          valueType: "enum",
          validation: { enum: ["Доклад", "Отчёт", "Зачёт"] }
        }
      ]
    },
    context("corr-definition")
  );
}

test("student owns an ordered typed collection and row number is computed", () => {
  const fixture = createMigratedTestStore();
  try {
    const spaces = new SpaceRegistry(fixture.store);
    const collections = new EntityCollectionRegistry(fixture.store);
    const space = spaces.createSpace({ name: "Учебная кафедра" }, context("corr-space"));
    const student = spaces.createEntity(
      space.id,
      { entityTypeKey: "person", displayName: "Иванов Иван" },
      context("corr-student")
    );
    const definition = planDefinition(collections, space.id);

    const saved = collections.replaceItems(
      space.id,
      student.entityId,
      definition.key,
      [
        {
          values: {
            "plan.question": "Обзор литературы",
            "plan.due_date": "2026-10-15",
            "plan.reporting": "Доклад"
          }
        },
        {
          values: {
            "plan.question": "Проведение эксперимента",
            "plan.reporting": "Отчёт"
          }
        }
      ],
      context("corr-items")
    );

    assert.deepEqual(saved.items.map((item) => item.rowNumber), [1, 2]);
    assert.equal(saved.items[0]?.values["plan.question"], "Обзор литературы");
    assert.equal(saved.items[0]?.values["plan.due_date"], "2026-10-15");
    assert.equal(saved.items[1]?.values["plan.reporting"], "Отчёт");
    assert.deepEqual(
      collections.getCollection(space.id, student.entityId, definition.id),
      saved
    );
    assert.equal(collections.listDefinitions(space.id, "person")[0]?.key, definition.key);

    const audit = new AuditRepository(fixture.store).listByCorrelation("corr-items");
    assert.equal(audit.length, 1);
    assert.equal(audit[0]?.action, "replace_items");
    assert.equal((audit[0]?.details as { itemCount?: number }).itemCount, 2);

    const outbox = fixture.store.execute((connection) =>
      connection
        .prepare("SELECT event_type, entity_id FROM domain_events WHERE dedupe_key = ?")
        .get(
          `entity_collection.items_replaced:${definition.id}:${student.entityId}:corr-items`
        ) as { event_type: string; entity_id: string | null } | undefined
    );
    assert.equal(outbox?.event_type, "entity_collection.items_replaced");
    assert.equal(outbox?.entity_id, student.entityId);
  } finally {
    fixture.cleanup();
  }
});

test("replace is atomic and invalid typed row leaves previous data intact", () => {
  const fixture = createMigratedTestStore();
  try {
    const spaces = new SpaceRegistry(fixture.store);
    const collections = new EntityCollectionRegistry(fixture.store);
    const space = spaces.createSpace({ name: "Учебная кафедра" }, context("corr-space-atomic"));
    const student = spaces.createEntity(
      space.id,
      { entityTypeKey: "person", displayName: "Петров Пётр" },
      context("corr-student-atomic")
    );
    const definition = planDefinition(collections, space.id);

    collections.replaceItems(
      space.id,
      student.entityId,
      definition.key,
      [{ values: { "plan.question": "Исходная строка" } }],
      context("corr-valid")
    );

    assert.throws(
      () =>
        collections.replaceItems(
          space.id,
          student.entityId,
          definition.key,
          [{ values: { "plan.question": "Новая", "plan.due_date": "31.12.2026" } }],
          context("corr-invalid-date")
        ),
      /date value must use YYYY-MM-DD/
    );
    assert.deepEqual(
      collections
        .getCollection(space.id, student.entityId, definition.key)
        .items.map((item) => item.values["plan.question"]),
      ["Исходная строка"]
    );
    assert.equal(new AuditRepository(fixture.store).listByCorrelation("corr-invalid-date").length, 0);

    assert.throws(
      () =>
        collections.replaceItems(
          space.id,
          student.entityId,
          definition.key,
          [{ values: { "plan.due_date": "2026-12-31" } }],
          context("corr-missing-required")
        ),
      EntityCollectionValidationError
    );
  } finally {
    fixture.cleanup();
  }
});

test("collections are isolated by space and protected by database triggers", () => {
  const fixture = createMigratedTestStore();
  try {
    const spaces = new SpaceRegistry(fixture.store);
    const collections = new EntityCollectionRegistry(fixture.store);
    const alpha = spaces.createSpace({ name: "Альфа" }, context("corr-alpha"));
    const beta = spaces.createSpace({ name: "Бета" }, context("corr-beta"));
    const alphaStudent = spaces.createEntity(
      alpha.id,
      { entityTypeKey: "person", displayName: "Студент Альфа" },
      context("corr-alpha-student")
    );
    const betaStudent = spaces.createEntity(
      beta.id,
      { entityTypeKey: "person", displayName: "Студент Бета" },
      context("corr-beta-student")
    );
    const definition = planDefinition(collections, alpha.id);

    assert.throws(
      () =>
        collections.replaceItems(
          alpha.id,
          betaStudent.entityId,
          definition.key,
          [{ values: { "plan.question": "Чужая строка" } }],
          context("corr-cross-space")
        ),
      EntityCollectionNotFoundError
    );
    assert.deepEqual(collections.listDefinitions(beta.id), []);

    assert.throws(
      () =>
        fixture.store.execute((connection) =>
          connection
            .prepare(`INSERT INTO entity_collection_items(
              id, collection_definition_id, owner_entity_id, position,
              version, created_at, updated_at
            ) VALUES ('illegal-row', ?, ?, 0, 1, ?, ?)`) 
            .run(definition.id, betaStudent.entityId, T0, T0)
        ),
      /definition space and type/
    );

    collections.replaceItems(
      alpha.id,
      alphaStudent.entityId,
      definition.key,
      [{ values: { "plan.question": "Допустимая строка" } }],
      context("corr-alpha-items")
    );
    assert.throws(
      () =>
        fixture.store.execute((connection) =>
          connection
            .prepare("UPDATE space_entity_ownership SET space_id = ? WHERE entity_id = ?")
            .run(beta.id, alphaStudent.entityId)
        ),
      /remove entity collection items before moving entity/
    );
  } finally {
    fixture.cleanup();
  }
});

test("enum and unknown collection columns fail closed", () => {
  const fixture = createMigratedTestStore();
  try {
    const spaces = new SpaceRegistry(fixture.store);
    const collections = new EntityCollectionRegistry(fixture.store);
    const space = spaces.createSpace({ name: "Проверка схемы" }, context("corr-schema-space"));
    const student = spaces.createEntity(
      space.id,
      { entityTypeKey: "person", displayName: "Сидоров Сидор" },
      context("corr-schema-student")
    );
    const definition = planDefinition(collections, space.id);

    assert.throws(
      () =>
        collections.replaceItems(
          space.id,
          student.entityId,
          definition.key,
          [{ values: { "plan.question": "Строка", "plan.reporting": "Неизвестно" } }],
          context("corr-bad-enum")
        ),
      /enum value is not allowed/
    );
    assert.throws(
      () =>
        collections.replaceItems(
          space.id,
          student.entityId,
          definition.key,
          [{ values: { "plan.question": "Строка", "plan.unknown": "нет" } }],
          context("corr-unknown-column")
        ),
      /Unknown collection field/
    );
    assert.equal(
      collections.getCollection(space.id, student.entityId, definition.key).items.length,
      0
    );
  } finally {
    fixture.cleanup();
  }
});
