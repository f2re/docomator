import assert from "node:assert/strict";
import test from "node:test";

import {
  DataImportConflictError,
  DataImportRegistry,
  type ExecuteDataImportInput
} from "./data-import.js";
import type { SqliteStore } from "./database.js";
import { KnowledgeRegistry } from "./knowledge.js";
import { SpaceRegistry } from "./spaces.js";
import { createMigratedTestStore } from "./test-helpers.js";

const NOW = "2026-07-15T10:00:00.000Z";

function context(correlationId: string) {
  return {
    correlationId,
    actorType: "test",
    actorId: "operator-1",
    now: NOW
  };
}

function employeeImport(
  rows: Array<Record<string, string>>,
  mappings: ExecuteDataImportInput["mappings"] = [
    {
      column: "Должность",
      createIfMissing: true,
      label: "Должность",
      valueType: "string"
    }
  ]
): ExecuteDataImportInput {
  return {
    fileName: "сотрудники.csv",
    fileFormat: "csv",
    sourceSha256: "a".repeat(64),
    identityColumn: "Табельный номер",
    displayNameColumn: "ФИО",
    headers: ["Табельный номер", "ФИО", "Должность"],
    rows,
    mappings,
    group: { name: "Летний импорт" }
  };
}

function mutationCounts(store: SqliteStore) {
  return store.execute((database) => ({
    audit: Number(
      (database.prepare("SELECT COUNT(*) AS count FROM audit_log").get() as {
        count: number;
      }).count
    ),
    outbox: Number(
      (database.prepare("SELECT COUNT(*) AS count FROM domain_events").get() as {
        count: number;
      }).count
    ),
    runs: Number(
      (database.prepare("SELECT COUNT(*) AS count FROM data_import_runs").get() as {
        count: number;
      }).count
    )
  }));
}

test("keyless employee import plans without writes and creates personal fields and a named group", () => {
  const fixture = createMigratedTestStore();
  try {
    const spaces = new SpaceRegistry(fixture.store);
    const knowledge = new KnowledgeRegistry(fixture.store);
    const imports = new DataImportRegistry(fixture.store, { spaces, knowledge });
    const space = spaces.createSpace(
      { key: "staff", name: "Сотрудники" },
      context("corr-space")
    );
    const input = employeeImport([
      {
        "Табельный номер": "001",
        "ФИО": "Иванов Иван Иванович",
        "Должность": "Инженер"
      },
      {
        "Табельный номер": "002",
        "ФИО": "Петрова Анна Сергеевна",
        "Должность": "Бухгалтер"
      }
    ]);

    const plan = imports.plan(space.id, input, context("corr-plan"));
    assert.deepEqual(
      {
        created: plan.createdCount,
        updated: plan.updatedCount,
        unchanged: plan.unchangedCount,
        failed: plan.failedCount
      },
      { created: 2, updated: 0, unchanged: 0, failed: 0 }
    );
    assert.equal(spaces.listEntities(space.id).length, 0);
    assert.equal(
      knowledge.listPropertyDefinitions().some((field) => field.label === "Должность"),
      false
    );
    assert.equal(spaces.listGroups(space.id).length, 0);

    const result = imports.execute(space.id, input, context("corr-execute"));
    assert.equal(result.createdCount, 2);
    assert.equal(result.failedCount, 0);
    assert.equal(result.groupName, "Летний импорт");
    const position = knowledge
      .listPropertyDefinitions()
      .find((field) => field.label === "Должность");
    assert.ok(position);
    assert.match(position.key, /^employee_field\.[a-f0-9]{32}$/u);
    assert.equal(position.sensitivity, "personal");
    assert.deepEqual(position.appliesTo, ["person"]);
    assert.match(spaces.listGroups(space.id)[0]?.key ?? "", /^employee_group\./u);

    const repeated = imports.execute(
      space.id,
      input,
      context("corr-execute-again")
    );
    assert.equal(repeated.createdCount, 0);
    assert.equal(repeated.updatedCount, 0);
    assert.equal(repeated.unchangedCount, 2);
    assert.equal(
      knowledge.listPropertyDefinitions().filter((field) => field.label === "Должность")
        .length,
      1
    );
  } finally {
    fixture.cleanup();
  }
});

test("duplicate identity is reported in Russian and preview leaves no data", () => {
  const fixture = createMigratedTestStore();
  try {
    const spaces = new SpaceRegistry(fixture.store);
    const imports = new DataImportRegistry(fixture.store, { spaces });
    const space = spaces.createSpace(
      { key: "staff", name: "Сотрудники" },
      context("corr-space")
    );
    const plan = imports.plan(
      space.id,
      employeeImport([
        {
          "Табельный номер": "001",
          "ФИО": "Иванов Иван",
          "Должность": "Инженер"
        },
        {
          "Табельный номер": "001",
          "ФИО": "Петров Пётр",
          "Должность": "Мастер"
        }
      ]),
      context("corr-plan")
    );

    assert.equal(plan.createdCount, 1);
    assert.equal(plan.failedCount, 1);
    assert.match(plan.errors[0]?.message ?? "", /повторяется внутри файла/u);
    assert.equal(spaces.listEntities(space.id).length, 0);
  } finally {
    fixture.cleanup();
  }
});

test("blank cells do not clear values and a failed new row is rolled back", () => {
  const fixture = createMigratedTestStore();
  try {
    const spaces = new SpaceRegistry(fixture.store);
    const knowledge = new KnowledgeRegistry(fixture.store);
    const imports = new DataImportRegistry(fixture.store, { spaces, knowledge });
    const space = spaces.createSpace(
      { key: "staff", name: "Сотрудники" },
      context("corr-space")
    );
    const employmentStatus = knowledge.createPropertyDefinition(
      {
        key: "person.employment_status",
        label: "Состояние",
        valueType: "enum",
        appliesTo: ["person"],
        sensitivity: "personal",
        validation: { enum: ["Работает"] }
      },
      context("corr-field")
    );
    const mappings = [
      {
        column: "Должность",
        createIfMissing: true,
        label: "Должность",
        valueType: "string"
      },
      {
        column: "Состояние",
        propertyKey: employmentStatus.key
      }
    ];
    const firstInput: ExecuteDataImportInput = {
      ...employeeImport(
        [
          {
            "Табельный номер": "001",
            "ФИО": "Иванов Иван",
            "Должность": "Инженер",
            "Состояние": "Работает"
          }
        ],
        mappings
      ),
      headers: ["Табельный номер", "ФИО", "Должность", "Состояние"]
    };
    const first = imports.execute(space.id, firstInput, context("corr-first"));
    assert.equal(first.createdCount, 1);
    const employeeId = spaces.listEntities(space.id)[0]?.entityId;
    assert.ok(employeeId);
    const position = knowledge
      .listPropertyDefinitions()
      .find((field) => field.label === "Должность");
    assert.ok(position);

    const blankUpdate: ExecuteDataImportInput = {
      ...firstInput,
      rows: [
        {
          "Табельный номер": "001",
          "ФИО": "Иванов Иван",
          "Должность": "",
          "Состояние": ""
        }
      ]
    };
    const unchanged = imports.execute(
      space.id,
      blankUpdate,
      context("corr-blank-update")
    );
    assert.equal(unchanged.unchangedCount, 1);
    assert.equal(
      knowledge.listPropertyValueHistory(employeeId, { propertyKey: position.key })[0]
        ?.value,
      "Инженер"
    );

    const invalidNewRow: ExecuteDataImportInput = {
      ...firstInput,
      rows: [
        {
          "Табельный номер": "002",
          "ФИО": "Ошибочная запись",
          "Должность": "Мастер",
          "Состояние": "Уволен"
        }
      ]
    };
    const failed = imports.execute(
      space.id,
      invalidNewRow,
      context("corr-invalid")
    );
    assert.equal(failed.failedCount, 1);
    assert.equal(failed.createdCount, 0);
    assert.equal(spaces.listEntities(space.id).length, 1);
    assert.equal(
      failed.errors[0]?.message,
      "Строка не сохранена: одно из значений не соответствует правилам поля."
    );
  } finally {
    fixture.cleanup();
  }
});

test("group conflict is validated before rows and leaves history, audit and outbox unchanged", () => {
  const fixture = createMigratedTestStore();
  try {
    const spaces = new SpaceRegistry(fixture.store);
    const imports = new DataImportRegistry(fixture.store, { spaces });
    const space = spaces.createSpace(
      { key: "staff", name: "Сотрудники" },
      context("corr-space")
    );
    for (const key of ["first-group", "second-group"]) {
      spaces.createGroup(
        space.id,
        { key, name: "Одинаковая группа" },
        context(`corr-${key}`)
      );
    }
    const before = mutationCounts(fixture.store);
    const input: ExecuteDataImportInput = {
      ...employeeImport([
        {
          "Табельный номер": "001",
          "ФИО": "Иванов Иван",
          "Должность": "Инженер"
        }
      ]),
      group: { name: "Одинаковая группа" }
    };

    assert.throws(
      () => imports.execute(space.id, input, context("corr-import")),
      DataImportConflictError
    );
    assert.equal(spaces.listEntities(space.id).length, 0);
    assert.equal(imports.list(space.id).length, 0);
    assert.deepEqual(mutationCounts(fixture.store), before);
  } finally {
    fixture.cleanup();
  }
});

test("finalization failure rolls back imported rows, history, audit and outbox", () => {
  const fixture = createMigratedTestStore();
  try {
    const spaces = new SpaceRegistry(fixture.store);
    const knowledge = new KnowledgeRegistry(fixture.store);
    const imports = new DataImportRegistry(fixture.store, { spaces, knowledge });
    const space = spaces.createSpace(
      { key: "staff", name: "Сотрудники" },
      context("corr-space")
    );
    const before = mutationCounts(fixture.store);
    fixture.store.execute((database) =>
      database.exec(`
        CREATE TRIGGER reject_data_import_run
        BEFORE INSERT ON data_import_runs
        BEGIN
          SELECT RAISE(ABORT, 'forced import finalization failure');
        END;
      `)
    );

    assert.throws(
      () =>
        imports.execute(
          space.id,
          employeeImport([
            {
              "Табельный номер": "001",
              "ФИО": "Иванов Иван",
              "Должность": "Инженер"
            }
          ]),
          context("corr-import")
        ),
      /forced import finalization failure/u
    );
    assert.equal(spaces.listEntities(space.id).length, 0);
    assert.equal(imports.list(space.id).length, 0);
    assert.equal(
      knowledge.listPropertyDefinitions().some((field) => field.label === "Должность"),
      false
    );
    assert.deepEqual(mutationCounts(fixture.store), before);
  } finally {
    fixture.cleanup();
  }
});
