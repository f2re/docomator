import assert from "node:assert/strict";
import test from "node:test";

import {
  KnowledgeRegistry,
  KnowledgeValidationError,
  propertyUiGroupFromValidation
} from "./knowledge.js";
import { createMigratedTestStore } from "./test-helpers.js";

const NOW = "2026-07-27T04:10:00.000Z";

function context(correlationId: string) {
  return {
    correlationId,
    actorType: "test",
    actorId: "operator-1",
    now: NOW
  };
}

function validationObject(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

test("property UI group can be assigned without losing validation rules", () => {
  const fixture = createMigratedTestStore();
  try {
    const registry = new KnowledgeRegistry(fixture.store);
    const created = registry.createPropertyDefinition(
      {
        key: "person.department",
        label: "Кафедра",
        valueType: "string",
        appliesTo: ["person"],
        validation: { minLength: 2 }
      },
      context("create-property")
    );
    assert.equal(propertyUiGroupFromValidation(created.validation), "unassigned");

    const updated = registry.updatePropertyDefinitionUiGroup(
      created.key,
      "teacher",
      context("classify-property")
    );
    const validation = validationObject(updated.validation);
    assert.equal(updated.version, 2);
    assert.equal(validation.minLength, 2);
    assert.equal(validation.uiGroup, "teacher");
    assert.equal(propertyUiGroupFromValidation(updated.validation), "teacher");

    assert.throws(
      () =>
        registry.updatePropertyDefinitionUiGroup(
          created.key,
          "unknown",
          context("invalid-group")
        ),
      KnowledgeValidationError
    );
  } finally {
    fixture.cleanup();
  }
});
