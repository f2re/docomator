import assert from "node:assert/strict";
import test from "node:test";

import { AssistedDataImportRegistry } from "./data-import-assist.js";
import {
  caseInsensitiveImportKey,
  parseImportPersonName
} from "./data-import-normalization.js";
import { KnowledgeRegistry } from "./knowledge.js";
import { SpaceRegistry } from "./spaces.js";
import { createMigratedTestStore } from "./test-helpers.js";

const NOW = "2026-07-30T12:00:00.000Z";

function context(correlationId: string) {
  return {
    correlationId,
    actorType: "test",
    actorId: "operator-1",
    now: NOW
  };
}

test("person name normalization preserves separators and supports two source orders", () => {
  assert.deepEqual(
    parseImportPersonName("ИВАНОВ-ПЕТРОВ ИВАН ИВАНОВИЧ", {
      normalizeCase: true,
      split: true,
      sourceOrder: "family-given-patronymic"
    }),
    {
      displayName: "Иванов-Петров Иван Иванович",
      family: "Иванов-Петров",
      given: "Иван",
      patronymic: "Иванович"
    }
  );
  assert.deepEqual(
    parseImportPersonName("анна сергеевна смирнова", {
      normalizeCase: true,
      split: true,
      sourceOrder: "given-patronymic-family"
    }),
    {
      displayName: "Анна Сергеевна Смирнова",
      family: "Смирнова",
      given: "Анна",
      patronymic: "Сергеевна"
    }
  );
  assert.equal(caseInsensitiveImportKey("  ЁЛКИН   EMP-01 "), "елкин emp-01");
  assert.throws(
    () =>
      parseImportPersonName("Иванов Иван Иванович лишнее", {
        normalizeCase: true,
        split: true
      }),
    /два или три слова/u
  );
});

test("case-insensitive employee import reuses identity and stores separate name fields", () => {
  const fixture = createMigratedTestStore();
  try {
    const spaces = new SpaceRegistry(fixture.store);
    const knowledge = new KnowledgeRegistry(fixture.store);
    const imports = new AssistedDataImportRegistry(fixture.store, {
      spaces,
      knowledge
    });
    const space = spaces.createSpace(
      { key: "people-normalized", name: "Нормализованные сотрудники" },
      context("corr-space")
    );
    const department = knowledge.createPropertyDefinition(
      {
        key: "person.department_normalized",
        label: "Подразделение",
        valueType: "enum",
        sensitivity: "internal",
        appliesTo: ["person"],
        validation: { enum: ["Кафедра"], allowCustom: false }
      },
      context("corr-department")
    );

    const first = imports.execute(
      space.id,
      {
        fileName: "employees.xlsx",
        fileFormat: "xlsx",
        sourceSha256: "a".repeat(64),
        identityColumn: "Код",
        displayNameColumn: "ФИО",
        headers: ["Код", "ФИО", "Подразделение"],
        rows: [
          {
            "Код": "EMP-001",
            "ФИО": "ИВАНОВ-ПЕТРОВ ИВАН ИВАНОВИЧ",
            "Подразделение": "Кафедра"
          }
        ],
        sourceRowNumbers: [17],
        identityCaseInsensitive: true,
        personName: {
          normalizeCase: true,
          split: true,
          sourceOrder: "family-given-patronymic"
        },
        mappings: [
          {
            column: "Подразделение",
            propertyKey: department.key,
            caseInsensitive: true
          }
        ]
      },
      context("corr-first")
    );

    assert.equal(first.createdCount, 1);
    assert.equal(first.failedCount, 0);
    assert.equal(first.propertyValueCount, 4);
    const [entity] = spaces.listEntities(space.id);
    assert.ok(entity);
    assert.equal(entity.displayName, "Иванов-Петров Иван Иванович");

    const definitions = knowledge.listPropertyDefinitions(500);
    const family = definitions.find((item) => item.label === "Фамилия");
    const given = definitions.find((item) => item.label === "Имя");
    const patronymic = definitions.find((item) => item.label === "Отчество");
    assert.ok(family);
    assert.ok(given);
    assert.ok(patronymic);
    assert.deepEqual(family.appliesTo, ["person"]);
    assert.deepEqual(given.appliesTo, ["person"]);
    assert.deepEqual(patronymic.appliesTo, ["person"]);
    assert.deepEqual(
      knowledge.listPropertyValueHistory(entity.entityId, {
        propertyKey: family.key
      }).map((item) => item.value),
      ["Иванов-Петров"]
    );
    assert.deepEqual(
      knowledge.listPropertyValueHistory(entity.entityId, {
        propertyKey: given.key
      }).map((item) => item.value),
      ["Иван"]
    );
    assert.deepEqual(
      knowledge.listPropertyValueHistory(entity.entityId, {
        propertyKey: patronymic.key
      }).map((item) => item.value),
      ["Иванович"]
    );
    assert.deepEqual(
      knowledge.listPropertyValueHistory(entity.entityId, {
        propertyKey: department.key
      }).map((item) => item.value),
      ["Кафедра"]
    );

    const repeated = imports.execute(
      space.id,
      {
        fileName: "employees.xlsx",
        fileFormat: "xlsx",
        sourceSha256: "b".repeat(64),
        identityColumn: "Код",
        displayNameColumn: "ФИО",
        headers: ["Код", "ФИО", "Подразделение"],
        rows: [
          {
            "Код": "emp-001",
            "ФИО": "иванов-петров иван иванович",
            "Подразделение": "КАФЕДРА"
          }
        ],
        sourceRowNumbers: [28],
        identityCaseInsensitive: true,
        personName: {
          normalizeCase: true,
          split: true,
          sourceOrder: "family-given-patronymic"
        },
        mappings: [
          {
            column: "Подразделение",
            propertyKey: department.key,
            caseInsensitive: true
          }
        ]
      },
      context("corr-repeat")
    );

    assert.equal(repeated.createdCount, 0);
    assert.equal(repeated.updatedCount, 0);
    assert.equal(repeated.unchangedCount, 1);
    assert.equal(repeated.propertyValueCount, 0);
    assert.equal(spaces.listEntities(space.id).length, 1);
    assert.equal(
      knowledge.listPropertyValueHistory(entity.entityId, {
        propertyKey: department.key
      }).length,
      1
    );
  } finally {
    fixture.cleanup();
  }
});

test("invalid split full name reports the physical source row", () => {
  const fixture = createMigratedTestStore();
  try {
    const spaces = new SpaceRegistry(fixture.store);
    const imports = new AssistedDataImportRegistry(fixture.store);
    const space = spaces.createSpace(
      { key: "invalid-name", name: "Ошибки ФИО" },
      context("corr-space")
    );
    const result = imports.execute(
      space.id,
      {
        fileName: "employees.xlsx",
        fileFormat: "xlsx",
        sourceSha256: "c".repeat(64),
        identityColumn: "Код",
        displayNameColumn: "ФИО",
        headers: ["Код", "ФИО"],
        rows: [{ "Код": "E-42", "ФИО": "Однослово" }],
        sourceRowNumbers: [42],
        identityCaseInsensitive: true,
        personName: { normalizeCase: true, split: true },
        mappings: []
      },
      context("corr-import")
    );

    assert.equal(result.createdCount, 0);
    assert.equal(result.failedCount, 1);
    assert.equal(result.errors[0]?.rowNumber, 42);
    assert.match(result.errors[0]?.message ?? "", /два или три слова/u);
  } finally {
    fixture.cleanup();
  }
});
