import assert from "node:assert/strict";
import test from "node:test";

import { EmployeeRegistry } from "./employees.js";
import {
  KnowledgeConflictError,
  KnowledgeRegistry,
  KnowledgeValidationError
} from "./knowledge.js";
import { PropertyValueValidationError } from "./property-codec.js";
import { SpaceNotFoundError, SpaceRegistry } from "./spaces.js";
import { createMigratedTestStore } from "./test-helpers.js";

const T0 = "2026-07-15T10:00:00.000Z";

function context(correlationId: string) {
  return {
    correlationId,
    actorType: "test",
    actorId: "operator-1",
    now: T0
  };
}

test("standard person type and generated employee field keys require no machine input", () => {
  const fixture = createMigratedTestStore();
  try {
    const knowledge = new KnowledgeRegistry(fixture.store);
    const employees = new EmployeeRegistry(fixture.store);
    assert.equal(knowledge.getEntityType("person").label, "Сотрудник");

    const created = employees.create(
      "default",
      {
        displayName: "Иванов Иван Иванович",
        fields: [
          {
            definition: { label: "Должность", valueType: "string" },
            value: "Инженер"
          },
          {
            definition: { label: "Дата рождения", valueType: "date" },
            value: "1990-02-03"
          }
        ]
      },
      context("employee-create")
    );

    assert.equal(created.created, true);
    assert.equal(created.profile.displayName, "Иванов Иван Иванович");
    assert.equal(created.profile.fields.length, 2);
    for (const field of created.profile.fields) {
      assert.match(field.definition.key, /^employee_field\.[a-f0-9]{32}$/u);
      assert.deepEqual(field.definition.appliesTo, ["person"]);
      assert.equal(field.definition.sensitivity, "personal");
    }
    assert.deepEqual(
      employees.list("default").map((employee) => ({
        id: employee.id,
        fieldCount: employee.fieldCount
      })),
      [{ id: created.profile.id, fieldCount: 2 }]
    );
    assert.deepEqual(employees.get("default", created.profile.id), created.profile);
  } finally {
    fixture.cleanup();
  }
});

test("generated field keys retry collisions and employee creates are idempotent", () => {
  const fixture = createMigratedTestStore();
  try {
    const knowledge = new KnowledgeRegistry(fixture.store);
    knowledge.createPropertyDefinition(
      {
        key: "employee_field.collision",
        label: "Существующее поле",
        valueType: "string",
        appliesTo: ["person"]
      },
      context("existing-definition")
    );
    const keys = ["employee_field.collision", "employee_field.unique"];
    const employees = new EmployeeRegistry(fixture.store, {
      knowledge,
      fieldKeyFactory: () => keys.shift() ?? "employee_field.unexpected"
    });
    const input = {
      displayName: "Петров Пётр",
      idempotencyKey: "employee-create-1",
      fields: [
        {
          definition: { label: "Отдел", valueType: "string" },
          value: "Эксплуатация"
        }
      ]
    } as const;

    const first = employees.create("default", input, context("create-first"));
    const replay = employees.create("default", input, context("create-replay"));
    assert.equal(first.created, true);
    assert.equal(replay.created, false);
    assert.equal(replay.profile.id, first.profile.id);
    assert.equal(first.profile.fields[0]?.definition.key, "employee_field.unique");
    assert.throws(
      () =>
        employees.create(
          "default",
          { ...input, displayName: "Другой сотрудник" },
          context("create-conflict")
        ),
      KnowledgeConflictError
    );
    assert.equal(employees.list("default").length, 1);
  } finally {
    fixture.cleanup();
  }
});

test("new employee fields reuse one normalized label and reject type conflicts", () => {
  const fixture = createMigratedTestStore();
  try {
    const knowledge = new KnowledgeRegistry(fixture.store);
    const employees = new EmployeeRegistry(fixture.store, { knowledge });
    const first = employees.create(
      "default",
      {
        displayName: "Первый сотрудник",
        fields: [
          {
            definition: { label: "Должность", valueType: "string" },
            value: "Инженер"
          }
        ]
      },
      context("field-label-first")
    ).profile;
    const second = employees.create(
      "default",
      {
        displayName: "Второй сотрудник",
        fields: [
          {
            definition: { label: "  должность  ", valueType: "string" },
            value: "Технолог"
          }
        ]
      },
      context("field-label-second")
    ).profile;
    assert.equal(
      second.fields[0]?.definition.key,
      first.fields[0]?.definition.key
    );
    assert.equal(knowledge.listPropertyDefinitions().length, 1);

    assert.throws(
      () =>
        employees.create(
          "default",
          {
            displayName: "Некорректный сотрудник",
            fields: [
              {
                definition: { label: "ДОЛЖНОСТЬ", valueType: "integer" },
                value: 123
              }
            ]
          },
          context("field-label-conflict")
        ),
      KnowledgeConflictError
    );
    assert.equal(employees.list("default").length, 2);
  } finally {
    fixture.cleanup();
  }
});

test("employee create and update roll back entity, definitions and values atomically", () => {
  const fixture = createMigratedTestStore();
  try {
    const employees = new EmployeeRegistry(fixture.store);
    assert.throws(
      () =>
        employees.create(
          "default",
          {
            displayName: "Некорректная карточка",
            fields: [
              {
                definition: { label: "Отдел", valueType: "string" },
                value: "ИТ"
              },
              {
                definition: { label: "Табельный номер", valueType: "integer" },
                value: "не число"
              }
            ]
          },
          context("create-rollback")
        ),
      PropertyValueValidationError
    );
    assert.equal(employees.list("default").length, 0);
    const definitionCount = fixture.store.execute(
      (database) =>
        Number(
          (
            database
              .prepare("SELECT COUNT(*) AS count FROM property_definitions")
              .get() as { count: number }
          ).count
        )
    );
    assert.equal(definitionCount, 0);

    const created = employees.create(
      "default",
      { displayName: "Сидорова Анна" },
      context("create-valid")
    ).profile;
    assert.throws(
      () =>
        employees.update(
          "default",
          created.id,
          {
            displayName: "Имя не должно сохраниться",
            fields: [
              {
                definition: { label: "Стаж", valueType: "integer" },
                value: "ошибка"
              }
            ]
          },
          context("update-rollback")
        ),
      PropertyValueValidationError
    );
    assert.equal(employees.get("default", created.id).displayName, "Сидорова Анна");
    assert.equal(employees.get("default", created.id).fields.length, 0);
  } finally {
    fixture.cleanup();
  }
});

test("employee read and update deny cross-space access", () => {
  const fixture = createMigratedTestStore();
  try {
    const spaces = new SpaceRegistry(fixture.store);
    const other = spaces.createSpace(
      { key: "other", name: "Другое пространство" },
      context("space-other")
    );
    const employees = new EmployeeRegistry(fixture.store, { spaces });
    const employee = employees.create(
      "default",
      { displayName: "Орлова Ольга" },
      context("employee-default")
    ).profile;

    assert.throws(() => employees.get(other.id, employee.id), SpaceNotFoundError);
    assert.throws(
      () =>
        employees.update(
          other.id,
          employee.id,
          { status: "inactive" },
          context("employee-cross-space")
        ),
      SpaceNotFoundError
    );
    const updated = employees.update(
      "default",
      employee.id,
      {
        displayName: "Орлова Ольга Сергеевна",
        status: "inactive",
        fields: [
          {
            definition: { label: "Телефон", valueType: "string" },
            value: "+7 900 000-00-00"
          }
        ]
      },
      context("employee-update")
    );
    assert.equal(updated.displayName, "Орлова Ольга Сергеевна");
    assert.equal(updated.status, "inactive");
    assert.equal(updated.version, 2);
    assert.equal(updated.fields[0]?.value, "+7 900 000-00-00");
  } finally {
    fixture.cleanup();
  }
});

test("employee updates replay idempotently without new versions, events or audit", () => {
  const fixture = createMigratedTestStore();
  try {
    const employees = new EmployeeRegistry(fixture.store);
    const created = employees.create(
      "default",
      {
        displayName: "Смирнов Сергей",
        fields: [
          {
            definition: { label: "Должность", valueType: "string" },
            value: "Инженер"
          }
        ]
      },
      context("employee-idempotent-create")
    ).profile;
    const propertyKey = created.fields[0]?.definition.key;
    assert.ok(propertyKey);
    const input = {
      displayName: "Смирнов Сергей Андреевич",
      fields: [{ propertyKey, value: "Ведущий инженер" }],
      idempotencyKey: "employee-update-1"
    } as const;

    const first = employees.update(
      "default",
      created.id,
      input,
      context("employee-update-first")
    );
    const sideEffectsAfterFirst = fixture.store.execute((database) => ({
      events: Number(
        (database.prepare("SELECT COUNT(*) AS count FROM domain_events").get() as {
          count: number;
        }).count
      ),
      audit: Number(
        (database.prepare("SELECT COUNT(*) AS count FROM audit_log").get() as {
          count: number;
        }).count
      ),
      valueVersions: Number(
        (
          database
            .prepare(
              "SELECT COUNT(*) AS count FROM entity_property_values WHERE entity_id = ?"
            )
            .get(created.id) as { count: number }
        ).count
      )
    }));
    const replay = employees.update(
      "default",
      created.id,
      input,
      context("employee-update-replay")
    );

    assert.deepEqual(replay, first);
    assert.equal(replay.version, 2);
    assert.equal(replay.fields[0]?.valueVersion, 2);
    assert.deepEqual(
      fixture.store.execute((database) => ({
        events: Number(
          (database.prepare("SELECT COUNT(*) AS count FROM domain_events").get() as {
            count: number;
          }).count
        ),
        audit: Number(
          (database.prepare("SELECT COUNT(*) AS count FROM audit_log").get() as {
            count: number;
          }).count
        ),
        valueVersions: Number(
          (
            database
              .prepare(
                "SELECT COUNT(*) AS count FROM entity_property_values WHERE entity_id = ?"
              )
              .get(created.id) as { count: number }
          ).count
        )
      })),
      sideEffectsAfterFirst
    );
    assert.throws(
      () =>
        employees.update(
          "default",
          created.id,
          { ...input, displayName: "Другое имя" },
          context("employee-update-conflict")
        ),
      KnowledgeConflictError
    );
    assert.equal(
      employees.get("default", created.id).displayName,
      "Смирнов Сергей Андреевич"
    );
  } finally {
    fixture.cleanup();
  }
});

test("employee resource fields stay in one space and reject unscoped files", () => {
  const fixture = createMigratedTestStore();
  try {
    const spaces = new SpaceRegistry(fixture.store);
    const knowledge = new KnowledgeRegistry(fixture.store);
    const employees = new EmployeeRegistry(fixture.store, { spaces, knowledge });
    const other = spaces.createSpace(
      { key: "employee-links-other", name: "Другое пространство" },
      context("employee-links-space")
    );
    const sameSpaceTarget = employees.create(
      "default",
      { displayName: "Руководитель в этом пространстве" },
      context("employee-link-same")
    ).profile;
    const otherSpaceTarget = employees.create(
      other.id,
      { displayName: "Руководитель в другом пространстве" },
      context("employee-link-other")
    ).profile;

    assert.throws(
      () =>
        employees.create(
          "default",
          {
            displayName: "Ссылка за пределы пространства",
            fields: [
              {
                definition: { label: "Руководитель", valueType: "entity-reference" },
                value: otherSpaceTarget.id
              }
            ]
          },
          context("employee-link-create-denied")
        ),
      (error: unknown) =>
        error instanceof KnowledgeValidationError &&
        /Связанный объект не найден в выбранном пространстве/u.test(error.message)
    );

    const source = employees.create(
      "default",
      {
        displayName: "Сотрудник со связью",
        fields: [
          {
            definition: { label: "Руководитель", valueType: "entity-reference" },
            value: sameSpaceTarget.id
          }
        ]
      },
      context("employee-link-create-valid")
    ).profile;
    const referenceKey = source.fields[0]?.definition.key;
    assert.ok(referenceKey);
    assert.equal(source.fields[0]?.value, sameSpaceTarget.id);
    assert.throws(
      () =>
        employees.update(
          "default",
          source.id,
          {
            fields: [{ propertyKey: referenceKey, value: otherSpaceTarget.id }],
            idempotencyKey: "employee-link-update-denied"
          },
          context("employee-link-update-denied")
        ),
      KnowledgeValidationError
    );
    assert.equal(employees.get("default", source.id).fields[0]?.value, sameSpaceTarget.id);
    assert.equal(employees.get("default", source.id).fields[0]?.valueVersion, 1);

    assert.throws(
      () =>
        employees.create(
          "default",
          {
            displayName: "Карточка с файлом",
            fields: [
              {
                definition: { label: "Скан паспорта", valueType: "file" },
                value: "file-id"
              }
            ]
          },
          context("employee-file-denied")
        ),
      (error: unknown) =>
        error instanceof KnowledgeValidationError &&
        /пока нельзя сохранять в карточке сотрудника/u.test(error.message)
    );
    knowledge.createPropertyDefinition(
      {
        key: "person.photo",
        label: "Фотография",
        valueType: "image",
        appliesTo: ["person"]
      },
      context("employee-image-definition")
    );
    assert.throws(
      () =>
        employees.update(
          "default",
          source.id,
          { fields: [{ propertyKey: "person.photo", value: "image-id" }] },
          context("employee-image-denied")
        ),
      KnowledgeValidationError
    );
  } finally {
    fixture.cleanup();
  }
});
