import assert from "node:assert/strict";
import test from "node:test";

import { KnowledgeNotFoundError } from "./knowledge.js";
import { SpaceScopedKnowledgeRegistry } from "./space-scoped-knowledge.js";
import { SpaceRegistry } from "./spaces.js";
import { createMigratedTestStore } from "./test-helpers.js";

const context = {
  correlationId: "corr-space-scoped-entities",
  actorType: "test",
  actorId: "operator",
  now: "2026-08-07T16:00:00.000Z"
};

test("generic entity registry cannot read entities from another space", () => {
  const fixture = createMigratedTestStore();
  try {
    const spaces = new SpaceRegistry(fixture.store);
    spaces.createSpace({ key: "alpha", name: "Альфа" }, context);
    spaces.createSpace({ key: "beta", name: "Бета" }, context);

    const alpha = new SpaceScopedKnowledgeRegistry(fixture.store, "alpha");
    const beta = new SpaceScopedKnowledgeRegistry(fixture.store, "beta");
    const created = alpha.createEntity(
      { entityTypeKey: "person", displayName: "Одинаковое имя" },
      context
    );

    assert.equal(alpha.getEntity(created.id).displayName, "Одинаковое имя");
    assert.deepEqual(alpha.listEntities().map((entity) => entity.id), [created.id]);
    assert.deepEqual(beta.listEntities().map((entity) => entity.id), []);
    assert.throws(
      () => beta.getEntity(created.id),
      (error: unknown) => error instanceof KnowledgeNotFoundError
    );
  } finally {
    fixture.cleanup();
  }
});
