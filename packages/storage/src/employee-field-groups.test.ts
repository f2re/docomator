import assert from "node:assert/strict";
import test from "node:test";

import { EmployeeRegistry } from "./employees.js";
import { KnowledgeConflictError, KnowledgeRegistry } from "./knowledge.js";
import { createMigratedTestStore } from "./test-helpers.js";

const NOW = "2026-07-27T04:00:00.000Z";

function context(correlationId: string) {
  return {
    correlationId,
    actorType: "test",
    actorId: "operator-1",
    now: NOW
  };
}

test("same-label teacher and student fields remain separate definitions", () => {
  const fixture = createMigratedTestStore();
  try {
    const knowledge = new KnowledgeRegistry(fixture.store);
    const employees = new EmployeeRegistry(fixture.store, { knowledge });
    const student = employees.create(
      "default",
      {
        displayName: "Студент",
        fields: [
          {
            definition: {
              label: "Группа",
              valueType: "string",
              uiGroup: "student"
            },
            value: "М-21"
          }
        ]
      },
      context("student-field")
    ).profile;
    const teacher = employees.create(
      "default",
      {
        displayName: "Преподаватель",
        fields: [
          {
            definition: {
              label: "Группа",
              valueType: "integer",
              uiGroup: "teacher"
            },
            value: 2
          }
        ]
      },
      context("teacher-field")
    ).profile;

    const studentKey = student.fields[0]?.definition.key;
    const teacherKey = teacher.fields[0]?.definition.key;
    assert.ok(studentKey);
    assert.ok(teacherKey);
    assert.notEqual(studentKey, teacherKey);
    assert.equal(student.fields[0]?.definition.validation["uiGroup"], "student");
    assert.equal(teacher.fields[0]?.definition.validation["uiGroup"], "teacher");

    const secondTeacher = employees.create(
      "default",
      {
        displayName: "Второй преподаватель",
        fields: [
          {
            definition: {
              label: "  группа ",
              valueType: "integer",
              uiGroup: "teacher"
            },
            value: 3
          }
        ]
      },
      context("teacher-field-reuse")
    ).profile;
    assert.equal(secondTeacher.fields[0]?.definition.key, teacherKey);
    assert.equal(knowledge.listPropertyDefinitions().length, 2);

    assert.throws(
      () =>
        employees.create(
          "default",
          {
            displayName: "Ошибочный студент",
            fields: [
              {
                definition: {
                  label: "Группа",
                  valueType: "integer",
                  uiGroup: "student"
                },
                value: 1
              }
            ]
          },
          context("student-field-conflict")
        ),
      KnowledgeConflictError
    );
  } finally {
    fixture.cleanup();
  }
});
