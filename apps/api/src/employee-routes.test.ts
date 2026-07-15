import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadApiConfig } from "@docomator/config";
import { SqliteStore } from "@docomator/storage";

import { buildApp } from "./app.js";

function migratedFixture(): {
  directory: string;
  store: SqliteStore;
  cleanup: () => void;
} {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "docomator-api-employees-"));
  const databasePath = path.join(directory, "docomator.db");
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON;");
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDirectory = path.resolve(currentDirectory, "../../../migrations");
  for (const migration of fs
    .readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()) {
    database.exec(fs.readFileSync(path.join(migrationsDirectory, migration), "utf8"));
  }
  database.close();
  const store = new SqliteStore({ databasePath });
  return {
    directory,
    store,
    cleanup: () => {
      store.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };
}

const headers = {
  "x-correlation-id": "corr-api-employees",
  "x-actor-id": "operator-1"
};

async function createSpace(
  app: ReturnType<typeof buildApp>,
  key: string,
  name: string
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/spaces",
    headers,
    payload: { key, name }
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { data: { id: string } }).data.id;
}

test("employee API creates, lists, reads and updates a profile without machine keys", async () => {
  const fixture = migratedFixture();
  const app = buildApp(
    loadApiConfig({
      DOCOMATOR_DATA_DIR: fixture.directory,
      DOCOMATOR_LOG_LEVEL: "fatal"
    }),
    { store: fixture.store }
  );
  try {
    const personType = await app.inject({
      method: "GET",
      url: "/api/v1/knowledge/entity-types/person"
    });
    assert.equal(personType.statusCode, 200, personType.body);

    const createdResponse = await app.inject({
      method: "POST",
      url: "/api/v1/spaces/default/employees",
      headers,
      payload: {
        displayName: "Иванов Иван Иванович",
        idempotencyKey: "employee-card-ivanov",
        fields: [
          {
            definition: { label: "Должность", valueType: "string" },
            value: "Инженер"
          }
        ]
      }
    });
    assert.equal(createdResponse.statusCode, 201, createdResponse.body);
    const created = createdResponse.json() as {
      data: {
        id: string;
        displayName: string;
        fields: Array<{
          definition: { key: string; sensitivity: string; appliesTo: string[] };
          value: unknown;
          valueVersion: number;
        }>;
      };
    };
    assert.equal(created.data.displayName, "Иванов Иван Иванович");
    assert.match(created.data.fields[0]?.definition.key ?? "", /^employee_field\./u);
    assert.equal(created.data.fields[0]?.definition.sensitivity, "personal");
    assert.deepEqual(created.data.fields[0]?.definition.appliesTo, ["person"]);

    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/spaces/default/employees",
      headers,
      payload: {
        displayName: "Иванов Иван Иванович",
        idempotencyKey: "employee-card-ivanov",
        fields: [
          {
            definition: { label: "Должность", valueType: "string" },
            value: "Инженер"
          }
        ]
      }
    });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal((replay.json() as { data: { id: string } }).data.id, created.data.id);
    const replayConflict = await app.inject({
      method: "POST",
      url: "/api/v1/spaces/default/employees",
      headers,
      payload: {
        displayName: "Другой сотрудник",
        idempotencyKey: "employee-card-ivanov"
      }
    });
    assert.equal(replayConflict.statusCode, 409, replayConflict.body);

    const fieldKey = created.data.fields[0]?.definition.key;
    assert.ok(fieldKey);
    const updatePayload = {
      displayName: "Иванов Иван Петрович",
      idempotencyKey: "employee-card-ivanov-update-1",
      fields: [
        { propertyKey: fieldKey, value: "Ведущий инженер" },
        {
          definition: { label: "Подразделение", valueType: "string" },
          value: "Служба эксплуатации"
        }
      ]
    };
    const updatedResponse = await app.inject({
      method: "PUT",
      url: `/api/v1/spaces/default/employees/${created.data.id}`,
      headers,
      payload: updatePayload
    });
    assert.equal(updatedResponse.statusCode, 200, updatedResponse.body);
    const updated = updatedResponse.json() as {
      data: {
        displayName: string;
        fields: Array<{ definition: { key: string }; value: unknown; valueVersion: number }>;
      };
    };
    assert.equal(updated.data.displayName, "Иванов Иван Петрович");
    assert.equal(updated.data.fields.length, 2);
    assert.equal(
      updated.data.fields.find((field) => field.definition.key === fieldKey)?.value,
      "Ведущий инженер"
    );
    assert.equal(
      updated.data.fields.find((field) => field.definition.key === fieldKey)?.valueVersion,
      2
    );
    const updateReplay = await app.inject({
      method: "PUT",
      url: `/api/v1/spaces/default/employees/${created.data.id}`,
      headers,
      payload: updatePayload
    });
    assert.equal(updateReplay.statusCode, 200, updateReplay.body);
    assert.equal(
      (
        updateReplay.json() as {
          data: { fields: Array<{ definition: { key: string }; valueVersion: number }> };
        }
      ).data.fields.find((field) => field.definition.key === fieldKey)?.valueVersion,
      2
    );
    const updateConflict = await app.inject({
      method: "PUT",
      url: `/api/v1/spaces/default/employees/${created.data.id}`,
      headers,
      payload: { ...updatePayload, displayName: "Другое имя" }
    });
    assert.equal(updateConflict.statusCode, 409, updateConflict.body);
    assert.match(
      (updateConflict.json() as { error: { message: string } }).error.message,
      /запрос на изменение сотрудника уже был выполнен с другими данными/u
    );

    const archivedResponse = await app.inject({
      method: "PUT",
      url: `/api/v1/spaces/default/employees/${created.data.id}`,
      headers,
      payload: { status: "archived" }
    });
    assert.equal(archivedResponse.statusCode, 200, archivedResponse.body);
    const archived = archivedResponse.json() as {
      data: { status: string; fields: unknown[] };
    };
    assert.equal(archived.data.status, "archived");
    assert.equal(archived.data.fields.length, 2, "PUT preserves fields that were not sent");

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/spaces/default/employees/${created.data.id}`
    });
    assert.equal(detail.statusCode, 200, detail.body);
    assert.equal(
      (detail.json() as { data: { displayName: string } }).data.displayName,
      "Иванов Иван Петрович"
    );
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/spaces/default/employees?limit=1000"
    });
    assert.equal(list.statusCode, 200, list.body);
    assert.deepEqual(
      (list.json() as { data: Array<{ id: string; fieldCount: number }> }).data.map(
        (employee) => ({ id: employee.id, fieldCount: employee.fieldCount })
      ),
      [{ id: created.data.id, fieldCount: 2 }]
    );

    const reusedFieldResponse = await app.inject({
      method: "POST",
      url: "/api/v1/spaces/default/employees",
      headers,
      payload: {
        displayName: "Петров Пётр Петрович",
        fields: [
          {
            definition: { label: "  должность ", valueType: "string" },
            value: "Технолог"
          }
        ]
      }
    });
    assert.equal(reusedFieldResponse.statusCode, 201, reusedFieldResponse.body);
    const reusedFieldKey = (
      reusedFieldResponse.json() as {
        data: { fields: Array<{ definition: { key: string } }> };
      }
    ).data.fields[0]?.definition.key;
    assert.equal(reusedFieldKey, fieldKey);
    const typeConflictResponse = await app.inject({
      method: "POST",
      url: "/api/v1/spaces/default/employees",
      headers,
      payload: {
        displayName: "Некорректная карточка",
        fields: [
          {
            definition: { label: "Должность", valueType: "integer" },
            value: 42
          }
        ]
      }
    });
    assert.equal(typeConflictResponse.statusCode, 409, typeConflictResponse.body);
    assert.match(
      (typeConflictResponse.json() as { error: { message: string } }).error.message,
      /уже существует с другим типом данных/u
    );
  } finally {
    await app.close();
    fixture.cleanup();
  }
});

test("employee API keeps explicit property compatibility and denies cross-space access", async () => {
  const fixture = migratedFixture();
  const app = buildApp(
    loadApiConfig({
      DOCOMATOR_DATA_DIR: fixture.directory,
      DOCOMATOR_LOG_LEVEL: "fatal"
    }),
    { store: fixture.store }
  );
  try {
    const definition = await app.inject({
      method: "POST",
      url: "/api/v1/knowledge/property-definitions",
      headers,
      payload: {
        key: "person.email",
        label: "Электронная почта",
        valueType: "string",
        sensitivity: "personal",
        appliesTo: ["person"]
      }
    });
    assert.equal(definition.statusCode, 201, definition.body);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/spaces/default/employees",
      headers,
      payload: {
        displayName: "Петров Пётр",
        fields: [{ propertyKey: "person.email", value: "petrov@example.test" }]
      }
    });
    assert.equal(created.statusCode, 201, created.body);
    const employeeId = (created.json() as { data: { id: string } }).data.id;
    const otherSpaceId = await createSpace(app, "other", "Другое пространство");

    const referenceDefinition = await app.inject({
      method: "POST",
      url: "/api/v1/knowledge/property-definitions",
      headers,
      payload: {
        key: "person.manager",
        label: "Руководитель",
        valueType: "entity-reference",
        sensitivity: "personal",
        appliesTo: ["person"]
      }
    });
    assert.equal(referenceDefinition.statusCode, 201, referenceDefinition.body);
    const otherTarget = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${otherSpaceId}/employees`,
      headers,
      payload: { displayName: "Сотрудник другого пространства" }
    });
    assert.equal(otherTarget.statusCode, 201, otherTarget.body);
    const otherTargetId = (otherTarget.json() as { data: { id: string } }).data.id;
    const crossSpaceReference = await app.inject({
      method: "PUT",
      url: `/api/v1/spaces/default/employees/${employeeId}`,
      headers,
      payload: {
        idempotencyKey: "cross-space-reference",
        fields: [{ propertyKey: "person.manager", value: otherTargetId }]
      }
    });
    assert.equal(crossSpaceReference.statusCode, 400, crossSpaceReference.body);
    assert.match(
      (crossSpaceReference.json() as { error: { message: string } }).error.message,
      /Связанный объект не найден в выбранном пространстве/u
    );

    const fileField = await app.inject({
      method: "POST",
      url: "/api/v1/spaces/default/employees",
      headers,
      payload: {
        displayName: "Карточка с файлом",
        fields: [
          {
            definition: { label: "Скан паспорта", valueType: "file" },
            value: "file-id"
          }
        ]
      }
    });
    assert.equal(fileField.statusCode, 400, fileField.body);
    assert.match(
      (fileField.json() as { error: { message: string } }).error.message,
      /пока нельзя сохранять в карточке сотрудника/u
    );

    const deniedRead = await app.inject({
      method: "GET",
      url: `/api/v1/spaces/${otherSpaceId}/employees/${employeeId}`
    });
    assert.equal(deniedRead.statusCode, 404, deniedRead.body);
    const deniedUpdate = await app.inject({
      method: "PUT",
      url: `/api/v1/spaces/${otherSpaceId}/employees/${employeeId}`,
      headers,
      payload: { status: "inactive" }
    });
    assert.equal(deniedUpdate.statusCode, 404, deniedUpdate.body);

    const invalidField = await app.inject({
      method: "POST",
      url: "/api/v1/spaces/default/employees",
      headers,
      payload: {
        displayName: "Некорректная карточка",
        fields: [
          {
            propertyKey: "person.email",
            definition: { label: "Дубликат", valueType: "string" },
            value: "value"
          }
        ]
      }
    });
    assert.equal(invalidField.statusCode, 400, invalidField.body);
    assert.match(
      (invalidField.json() as { error: { message: string } }).error.message,
      /Проверьте заполнение формы/u
    );

    const rolledBack = await app.inject({
      method: "POST",
      url: "/api/v1/spaces/default/employees",
      headers,
      payload: {
        displayName: "Не должна сохраниться",
        fields: [
          {
            definition: { label: "Временное поле", valueType: "string" },
            value: "значение"
          },
          {
            definition: { label: "Неверное число", valueType: "integer" },
            value: "не число"
          }
        ]
      }
    });
    assert.equal(rolledBack.statusCode, 400, rolledBack.body);
    const employeesAfterRollback = await app.inject({
      method: "GET",
      url: "/api/v1/spaces/default/employees"
    });
    assert.equal(
      (employeesAfterRollback.json() as { data: unknown[] }).data.length,
      1
    );
    const definitionsAfterRollback = await app.inject({
      method: "GET",
      url: "/api/v1/knowledge/property-definitions"
    });
    assert.deepEqual(
      (
        definitionsAfterRollback.json() as {
          data: Array<{ key: string }>;
        }
      ).data.map((item) => item.key),
      ["person.email", "person.manager"]
    );
  } finally {
    await app.close();
    fixture.cleanup();
  }
});
