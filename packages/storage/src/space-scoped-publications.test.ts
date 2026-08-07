import assert from "node:assert/strict";
import test from "node:test";

import { KnowledgeNotFoundError } from "./knowledge.js";
import { SpaceScopedKnowledgeRegistry } from "./space-scoped-knowledge.js";
import { SpaceScopedPublicationRegistry } from "./space-scoped-publications.js";
import { SpaceRegistry } from "./spaces.js";
import { createMigratedTestStore } from "./test-helpers.js";

const NOW = "2026-08-07T14:20:00.000Z";

function context(correlationId: string) {
  return {
    correlationId,
    actorType: "test",
    actorId: "operator-publications",
    now: NOW
  };
}

test("default publication fields are independent in different spaces", () => {
  const fixture = createMigratedTestStore();
  try {
    const spaces = new SpaceRegistry(fixture.store);
    const first = spaces.createSpace(
      { key: "publications-a", name: "Публикации A" },
      context("corr-space-a")
    );
    const second = spaces.createSpace(
      { key: "publications-b", name: "Публикации B" },
      context("corr-space-b")
    );
    const publications = new SpaceScopedPublicationRegistry(fixture.store);

    const firstConfiguration = publications.ensureDefaultConfiguration(
      first.id,
      context("corr-config-a")
    );
    const secondConfiguration = publications.ensureDefaultConfiguration(
      second.id,
      context("corr-config-b")
    );

    assert.notEqual(
      firstConfiguration.publicationYearPropertyKey,
      secondConfiguration.publicationYearPropertyKey
    );
    assert.notEqual(
      firstConfiguration.doiPropertyKey,
      secondConfiguration.doiPropertyKey
    );
    assert.notEqual(
      firstConfiguration.teacherDepartmentPropertyKey,
      secondConfiguration.teacherDepartmentPropertyKey
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
    const firstKeys = new Set(
      firstKnowledge.listPropertyDefinitions(500).map((item) => item.key)
    );
    const secondKeys = new Set(
      secondKnowledge.listPropertyDefinitions(500).map((item) => item.key)
    );

    assert.ok(firstConfiguration.publicationYearPropertyKey !== null);
    assert.ok(secondConfiguration.publicationYearPropertyKey !== null);
    assert.ok(firstKeys.has(firstConfiguration.publicationYearPropertyKey));
    assert.ok(secondKeys.has(secondConfiguration.publicationYearPropertyKey));
    assert.ok(!secondKeys.has(firstConfiguration.publicationYearPropertyKey));
    assert.ok(!firstKeys.has(secondConfiguration.publicationYearPropertyKey));

    assert.throws(
      () =>
        secondKnowledge.getPropertyDefinition(
          firstConfiguration.publicationYearPropertyKey ?? ""
        ),
      KnowledgeNotFoundError
    );
  } finally {
    fixture.cleanup();
  }
});

test("publication configuration rejects a field owned by another space", () => {
  const fixture = createMigratedTestStore();
  try {
    const spaces = new SpaceRegistry(fixture.store);
    const first = spaces.createSpace(
      { key: "publication-config-a", name: "Конфигурация A" },
      context("corr-space-a")
    );
    const second = spaces.createSpace(
      { key: "publication-config-b", name: "Конфигурация B" },
      context("corr-space-b")
    );
    const publications = new SpaceScopedPublicationRegistry(fixture.store);
    const firstConfiguration = publications.ensureDefaultConfiguration(
      first.id,
      context("corr-config-a")
    );
    const secondConfiguration = publications.ensureDefaultConfiguration(
      second.id,
      context("corr-config-b")
    );

    assert.ok(firstConfiguration.doiPropertyKey !== null);
    assert.throws(
      () =>
        publications.configure(
          second.id,
          {
            publicationEntityTypeKey:
              secondConfiguration.publicationEntityTypeKey,
            teacherEntityTypeKey: secondConfiguration.teacherEntityTypeKey,
            publicationYearPropertyKey:
              secondConfiguration.publicationYearPropertyKey,
            publicationDatePropertyKey:
              secondConfiguration.publicationDatePropertyKey,
            teacherDepartmentPropertyKey:
              secondConfiguration.teacherDepartmentPropertyKey,
            doiPropertyKey: firstConfiguration.doiPropertyKey,
            journalPropertyKey: secondConfiguration.journalPropertyKey,
            bibliographyPropertyKey:
              secondConfiguration.bibliographyPropertyKey,
            statusPropertyKey: secondConfiguration.statusPropertyKey
          },
          context("corr-invalid-config")
        ),
      KnowledgeNotFoundError
    );
  } finally {
    fixture.cleanup();
  }
});
