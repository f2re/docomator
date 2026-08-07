import assert from "node:assert/strict";
import test from "node:test";

import {
  AssistedDataImportRegistry,
  type AssistedExecuteDataImportInput
} from "./data-import-assist.js";
import { KnowledgeRegistry } from "./knowledge.js";
import { SpaceScopedKnowledgeRegistry } from "./space-scoped-knowledge.js";
import { SpaceRegistry } from "./spaces.js";
import { createMigratedTestStore } from "./test-helpers.js";

const NOW = "2026-07-25T18:00:00.000Z";

function context(correlationId: string) {
  return {
    correlationId,
    actorType: "test",
    actorId: "operator-1",
    now: NOW
  };
}

function studentImport(rows: Array<Record<string, string>>): AssistedExecuteDataImportInput {
  return {
    fileName: "студенты.xlsx",
    fileFormat: "xlsx",
    sourceSha256: "b".repeat(64),
    identityColumn: "Номер зачётной книжки",
    displayNameColumn: "ФИО",
    headers: [
      "ФИО",
      "Номер зачётной книжки",
      "Учебная группа",
      "Тема научной работы",
      "Научный руководитель",
      "Номер паспорта"
    ],
    rows,
    mappings: [
      {
        column: "Номер зачётной книжки",
        createIfMissing: true,
        label: "Номер зачётной книжки",
        valueType: "string",
        sensitivity: "personal"
      },
      {
        column: "Учебная группа",
        createIfMissing: true,
        label: "Учебная группа",
        valueType: "enum",
        sensitivity: "internal",
        enumValues: ["М-21"],
        allowCustom: true
      },
      {
        column: "Тема научной работы",
        createIfMissing: true,
        label: "Тема научной работы",
        valueType: "text",
        sensitivity: "internal"
      },
      {
        column: "Научный руководитель",
        createIfMissing: true,
        label: "Научный руководитель",
        valueType: "string",
        sensitivity: "internal"
      },
      {
        column: "Номер паспорта",
        createIfMissing: true,
        label: "Номер паспорта",
        valueType: "string",
        sensitivity: "restricted"
      }
    ],
    group: {
      name: "Студенты — научные работы",
      description: "Состав для таблицы Word"
    }
  };
}

test("assisted import plans without writes and creates typed fields, aliases and an expandable list", () => {
  const fixture = createMigratedTestStore();
  try {
    const spaces = new SpaceRegistry(fixture.store);
    const knowledge = new KnowledgeRegistry(fixture.store);
    const imports = new AssistedDataImportRegistry(fixture.store, {
      spaces,
      knowledge
    });
    const space = spaces.createSpace(
      { key: "students", name: "Студенты" },
      context("corr-space")
    );
    const scopedKnowledge = new SpaceScopedKnowledgeRegistry(
      fixture.store,
      space.id,
      { spaces }
    );
    const input = studentImport([
      {
        "ФИО": "Иванов Иван Иванович",
        "Номер зачётной книжки": "ЗК-001",
        "Учебная группа": "М-21",
        "Тема научной работы": "Оценка точности краткосрочного прогноза осадков",
        "Научный руководитель": "Петров Пётр Петрович",
        "Номер паспорта": "123456"
      },
      {
        "ФИО": "Смирнова Анна Сергеевна",
        "Номер зачётной книжки": "ЗК-002",
        "Учебная группа": "М-22",
        "Тема научной работы": "Автоматизация обработки радиозондирования",
        "Научный руководитель": "Сидорова Мария Андреевна",
        "Номер паспорта": "654321"
      }
    ]);

    const plan = imports.plan(space.id, input, context("corr-plan"));
    assert.equal(plan.createdCount, 2);
    assert.equal(plan.failedCount, 0);
    assert.equal(plan.mappingResolutions.length, 5);
    assert.equal(spaces.listEntities(space.id).length, 0);
    assert.equal(
      scopedKnowledge
        .listPropertyDefinitions()
        .some((item) => item.label === "Тема научной работы"),
      false
    );

    const result = imports.execute(space.id, input, context("corr-execute"));
    assert.equal(result.createdCount, 2);
    assert.equal(result.failedCount, 0);
    assert.equal(result.groupName, "Студенты — научные работы");

    const definitions = scopedKnowledge.listPropertyDefinitions();
    const group = definitions.find((item) => item.label === "Учебная группа");
    const passport = definitions.find((item) => item.label === "Номер паспорта");
    const topic = definitions.find((item) => item.label === "Тема научной работы");
    assert.ok(group);
    assert.ok(passport);
    assert.ok(topic);
    assert.equal(group.valueType, "enum");
    assert.deepEqual(group.validation, {
      enum: ["М-21", "М-22"],
      allowCustom: true
    });
    assert.ok(group.aliases.includes("Учебная группа") || group.label === "Учебная группа");
    assert.equal(passport.sensitivity, "restricted");
    assert.equal(topic.valueType, "text");

    const repeated = imports.execute(
      space.id,
      studentImport([
        {
          "ФИО": "Иванов Иван Иванович",
          "Номер зачётной книжки": "ЗК-001",
          "Учебная группа": "М-23",
          "Тема научной работы": "Уточнённая тема",
          "Научный руководитель": "Петров Пётр Петрович",
          "Номер паспорта": "123456"
        }
      ]),
      context("corr-repeat")
    );
    assert.equal(repeated.updatedCount, 1);
    const updatedGroup = scopedKnowledge.getPropertyDefinition(group.key);
    assert.deepEqual(updatedGroup.validation, {
      enum: ["М-21", "М-22", "М-23"],
      allowCustom: true
    });
  } finally {
    fixture.cleanup();
  }
});

test("closed imported list rejects a value outside configured options without creating a person", () => {
  const fixture = createMigratedTestStore();
  try {
    const spaces = new SpaceRegistry(fixture.store);
    const knowledge = new KnowledgeRegistry(fixture.store);
    const imports = new AssistedDataImportRegistry(fixture.store, { spaces, knowledge });
    const space = spaces.createSpace(
      { key: "students", name: "Студенты" },
      context("corr-space")
    );
    const scopedKnowledge = new SpaceScopedKnowledgeRegistry(
      fixture.store,
      space.id,
      { spaces }
    );
    const status = scopedKnowledge.createPropertyDefinition(
      {
        key: "person.student_status",
        label: "Статус студента",
        valueType: "enum",
        sensitivity: "internal",
        appliesTo: ["person"],
        validation: { enum: ["Обучается"], allowCustom: false }
      },
      context("corr-status")
    );
    const input: AssistedExecuteDataImportInput = {
      fileName: "студенты.csv",
      fileFormat: "csv",
      sourceSha256: "c".repeat(64),
      identityColumn: "Номер",
      displayNameColumn: "ФИО",
      headers: ["Номер", "ФИО", "Статус"],
      rows: [{ "Номер": "1", "ФИО": "Ошибочный Студент", "Статус": "Отчислен" }],
      mappings: [
        {
          column: "Статус",
          propertyKey: status.key,
          allowCustom: false,
          aliases: ["Статус"]
        }
      ]
    };

    const result = imports.execute(space.id, input, context("corr-import"));
    assert.equal(result.failedCount, 1);
    assert.equal(result.createdCount, 0);
    assert.equal(spaces.listEntities(space.id).length, 0);
    assert.equal(result.errors[0]?.code, "property_value_invalid");
    assert.equal(result.errors[0]?.column, "Статус");
    assert.deepEqual(scopedKnowledge.getPropertyDefinition(status.key).validation, {
      enum: ["Обучается"],
      allowCustom: false
    });
  } finally {
    fixture.cleanup();
  }
});

test("assisted import resolves equal labels inside selected space and arbitrary entity type", () => {
  const fixture = createMigratedTestStore();
  try {
    const spaces = new SpaceRegistry(fixture.store);
    const knowledge = new KnowledgeRegistry(fixture.store);
    const imports = new AssistedDataImportRegistry(fixture.store, { spaces, knowledge });
    knowledge.createEntityType(
      { key: "room", label: "Аудитория", description: "Учебное помещение" },
      context("corr-room-type")
    );
    knowledge.createEntityType(
      { key: "article", label: "Научная статья" },
      context("corr-article-type")
    );
    const space = spaces.createSpace(
      { key: "campus", name: "Учебный корпус" },
      context("corr-campus")
    );
    const scopedKnowledge = new SpaceScopedKnowledgeRegistry(
      fixture.store,
      space.id,
      { spaces }
    );
    const roomNumber = scopedKnowledge.createPropertyDefinition(
      {
        key: "room.number",
        label: "Номер",
        valueType: "string",
        sensitivity: "internal",
        appliesTo: ["room"]
      },
      context("corr-room-number")
    );
    scopedKnowledge.createPropertyDefinition(
      {
        key: "article.number",
        label: "Номер",
        valueType: "string",
        sensitivity: "internal",
        appliesTo: ["article"]
      },
      context("corr-article-number")
    );
    const input: AssistedExecuteDataImportInput = {
      entityTypeKey: "room",
      fileName: "аудитории.csv",
      fileFormat: "csv",
      sourceSha256: "d".repeat(64),
      identityColumn: "Код",
      displayNameColumn: "Название",
      headers: ["Код", "Название", "Номер", "Вместимость"],
      rows: [
        {
          "Код": "ROOM-101",
          "Название": "Аудитория 101",
          "Номер": "101",
          "Вместимость": "32"
        }
      ],
      mappings: [
        {
          column: "Номер",
          createIfMissing: true,
          label: "Номер",
          valueType: "string"
        },
        {
          column: "Вместимость",
          createIfMissing: true,
          label: "Вместимость",
          valueType: "integer"
        }
      ]
    };

    const result = imports.execute(space.id, input, context("corr-room-import"));
    assert.equal(result.createdCount, 1);
    assert.equal(result.failedCount, 0);
    assert.equal(
      result.mappingResolutions.find((item) => item.column === "Номер")?.propertyKey,
      roomNumber.key
    );
    assert.equal(
      result.mappingResolutions.find((item) => item.column === "Номер")?.matchedBy,
      "label"
    );
    const capacity = scopedKnowledge
      .listPropertyDefinitions()
      .find((definition) => definition.label === "Вместимость");
    assert.ok(capacity);
    assert.deepEqual(capacity.appliesTo, ["room"]);
    assert.equal(capacity.sensitivity, "internal");
    assert.deepEqual(
      spaces.listEntities(space.id).map((entity) => entity.entityTypeKey),
      ["room"]
    );
  } finally {
    fixture.cleanup();
  }
});
