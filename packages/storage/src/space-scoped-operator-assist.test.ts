import assert from "node:assert/strict";
import test from "node:test";

import { KnowledgeNotFoundError } from "./knowledge.js";
import { SpaceScopedKnowledgeRegistry } from "./space-scoped-knowledge.js";
import { SpaceScopedOperatorAssistRegistry } from "./space-scoped-operator-assist.js";
import { SpaceRegistry } from "./spaces.js";
import { createMigratedTestStore } from "./test-helpers.js";

const NOW = "2026-08-07T08:30:00.000Z";

function context(correlationId: string) {
  return {
    correlationId,
    actorType: "test",
    actorId: "operator-1",
    now: NOW
  };
}

test("operator property suggestions and edits stay inside one space", () => {
  const fixture = createMigratedTestStore();
  try {
    const spaces = new SpaceRegistry(fixture.store);
    const first = spaces.createSpace(
      { key: "assist-fields-a", name: "Пространство A" },
      context("corr-space-a")
    );
    const second = spaces.createSpace(
      { key: "assist-fields-b", name: "Пространство B" },
      context("corr-space-b")
    );
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
    const firstField = firstKnowledge.createPropertyDefinition(
      {
        label: "Категория",
        valueType: "enum",
        sensitivity: "personal",
        appliesTo: ["person"],
        validation: { enum: ["Первая"], allowCustom: true, uiGroup: "common" }
      },
      context("corr-field-a")
    );
    const secondField = secondKnowledge.createPropertyDefinition(
      {
        label: "Категория",
        valueType: "enum",
        sensitivity: "personal",
        appliesTo: ["person"],
        validation: { enum: ["Вторая"], allowCustom: true }
      },
      context("corr-field-b")
    );
    const assist = new SpaceScopedOperatorAssistRegistry(fixture.store);

    assert.deepEqual(
      assist.listPropertySuggestions(first.id).map((item) => item.propertyKey),
      [firstField.key]
    );
    assert.deepEqual(
      assist.listPropertySuggestions(second.id).map((item) => item.propertyKey),
      [secondField.key]
    );

    const updated = assist.updatePropertyDefinitionInSpace(
      first.id,
      firstField.key,
      { label: "Категория A" },
      context("corr-update-a")
    );
    assert.equal(updated.label, "Категория A");
    const validationUpdated = assist.updatePropertyDefinitionInSpace(
      first.id,
      firstField.key,
      { validation: { allowCustom: false } },
      context("corr-validation-a")
    );
    assert.deepEqual(validationUpdated.validation, {
      enum: ["Первая"],
      allowCustom: false,
      uiGroup: "common"
    });
    assert.throws(
      () =>
        assist.updatePropertyDefinitionInSpace(
          second.id,
          firstField.key,
          { label: "Чужое изменение" },
          context("corr-cross-update")
        ),
      KnowledgeNotFoundError
    );
    assert.throws(
      () =>
        assist.extendEnumOptionsInSpace(
          second.id,
          firstField.key,
          ["Чужой вариант"],
          context("corr-cross-enum")
        ),
      KnowledgeNotFoundError
    );
  } finally {
    fixture.cleanup();
  }
});
