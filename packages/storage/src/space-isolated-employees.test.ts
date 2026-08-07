import assert from "node:assert/strict";
import test from "node:test";

import { SpaceIsolatedEmployeeRegistry } from "./space-isolated-employees.js";
import { SpaceScopedKnowledgeRegistry } from "./space-scoped-knowledge.js";
import { SpaceRegistry } from "./spaces.js";
import { createMigratedTestStore } from "./test-helpers.js";

const NOW = "2026-08-07T07:15:00.000Z";

function context(correlationId: string) {
  return {
    correlationId,
    actorType: "test",
    actorId: "operator-1",
    now: NOW
  };
}

test("employee fields with the same label remain independent between spaces", () => {
  const fixture = createMigratedTestStore();
  try {
    const spaces = new SpaceRegistry(fixture.store);
    const first = spaces.createSpace(
      { key: "employee-fields-a", name: "Кафедра A" },
      context("corr-space-a")
    );
    const second = spaces.createSpace(
      { key: "employee-fields-b", name: "Кафедра B" },
      context("corr-space-b")
    );
    const employees = new SpaceIsolatedEmployeeRegistry(fixture.store);

    const firstEmployee = employees.create(
      first.id,
      {
        displayName: "Иванов Иван Иванович",
        fields: [
          {
            definition: {
              label: "Должность",
              valueType: "string",
              uiGroup: "teacher"
            },
            value: "Доцент"
          }
        ]
      },
      context("corr-employee-a")
    );
    const secondEmployee = employees.create(
      second.id,
      {
        displayName: "Петров Пётр Петрович",
        fields: [
          {
            definition: {
              label: "Должность",
              valueType: "string",
              uiGroup: "teacher"
            },
            value: "Профессор"
          }
        ]
      },
      context("corr-employee-b")
    );

    const firstField = firstEmployee.profile.fields[0]?.definition;
    const secondField = secondEmployee.profile.fields[0]?.definition;
    assert.ok(firstField);
    assert.ok(secondField);
    assert.notEqual(firstField.id, secondField.id);
    assert.notEqual(firstField.key, secondField.key);

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
    assert.deepEqual(
      firstKnowledge.listPropertyDefinitions(500).map((item) => item.id),
      [firstField.id]
    );
    assert.deepEqual(
      secondKnowledge.listPropertyDefinitions(500).map((item) => item.id),
      [secondField.id]
    );
  } finally {
    fixture.cleanup();
  }
});
