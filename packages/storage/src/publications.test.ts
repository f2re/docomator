import assert from "node:assert/strict";
import test from "node:test";

import { KnowledgeRegistry } from "./knowledge.js";
import {
  PUBLICATION_DERIVED_PROPERTY_KEYS,
  PublicationConflictError,
  PublicationNotFoundError,
  PublicationRegistry,
  PublicationValidationError
} from "./publications.js";
import { SpaceRegistry } from "./spaces.js";
import { createMigratedTestStore } from "./test-helpers.js";

const T0 = "2026-08-03T09:00:00.000Z";

function context(correlationId: string) {
  return {
    correlationId,
    actorType: "test",
    actorId: "operator-1",
    now: T0
  };
}

function addValue(
  knowledge: KnowledgeRegistry,
  entityId: string,
  propertyKey: string,
  value: unknown,
  correlationId: string
) {
  return knowledge.appendPropertyValue(
    {
      entityId,
      propertyKey,
      value,
      sourceType: "test"
    },
    context(correlationId)
  );
}

test("publication registry links authors, classifies articles and counts unique publications", () => {
  const fixture = createMigratedTestStore();
  try {
    const knowledge = new KnowledgeRegistry(fixture.store);
    const spaces = new SpaceRegistry(fixture.store);
    const publications = new PublicationRegistry(fixture.store);
    const space = spaces.createSpace(
      { key: "science", name: "Научная деятельность" },
      context("corr-space")
    );

    const configuration = publications.ensureDefaultConfiguration(
      space.id,
      context("corr-bootstrap")
    );
    assert.equal(configuration.publicationEntityTypeKey, "scientific-publication");
    assert.equal(configuration.teacherEntityTypeKey, "person");

    const teacherOne = spaces.createEntity(
      space.id,
      { entityTypeKey: "person", displayName: "Иванов Иван Иванович" },
      context("corr-teacher-1")
    );
    const teacherTwo = spaces.createEntity(
      space.id,
      { entityTypeKey: "person", displayName: "Петров Пётр Петрович" },
      context("corr-teacher-2")
    );
    addValue(
      knowledge,
      teacherOne.entityId,
      "person.department",
      "Кафедра метеорологии",
      "corr-department-1"
    );
    addValue(
      knowledge,
      teacherTwo.entityId,
      "person.department",
      "Кафедра метеорологии",
      "corr-department-2"
    );

    const first = spaces.createEntity(
      space.id,
      {
        entityTypeKey: "scientific-publication",
        displayName: "Краткосрочный прогноз конвективных осадков"
      },
      context("corr-publication-1")
    );
    const second = spaces.createEntity(
      space.id,
      {
        entityTypeKey: "scientific-publication",
        displayName: "Восстановление профиля атмосферы"
      },
      context("corr-publication-2")
    );
    assert.throws(
      () =>
        addValue(
          knowledge,
          first.entityId,
          PUBLICATION_DERIVED_PROPERTY_KEYS.authors,
          "Ручное значение",
          "corr-derived-manual"
        ),
      /managed by the publication registry/u
    );
    assert.throws(
      () =>
        publications.replaceAuthors(
          space.id,
          first.entityId,
          [{ authorEntityId: second.entityId }],
          context("corr-publication-as-author")
        ),
      PublicationValidationError
    );
    for (const [entityId, suffix] of [
      [first.entityId, "1"],
      [second.entityId, "2"]
    ] as const) {
      addValue(knowledge, entityId, "publication.year", 2026, `corr-year-${suffix}`);
      addValue(
        knowledge,
        entityId,
        "publication.status",
        "Опубликована",
        `corr-status-${suffix}`
      );
    }
    addValue(
      knowledge,
      first.entityId,
      "publication.doi",
      "10.1000/example.1",
      "corr-doi-1"
    );

    publications.replaceAuthors(
      space.id,
      first.entityId,
      [
        { authorEntityId: teacherOne.entityId },
        { authorEntityId: teacherTwo.entityId, role: "corresponding_author" }
      ],
      context("corr-authors-1")
    );
    publications.replaceAuthors(
      space.id,
      second.entityId,
      [{ authorEntityId: teacherOne.entityId }],
      context("corr-authors-2")
    );
    publications.setClassification(
      space.id,
      first.entityId,
      "vak",
      { state: "confirmed", source: "Перечень ВАК" },
      context("corr-vak-1")
    );
    publications.setClassification(
      space.id,
      first.entityId,
      "rinc",
      { state: "confirmed", source: "eLIBRARY" },
      context("corr-rinc-1")
    );
    publications.setClassification(
      space.id,
      second.entityId,
      "vak",
      { state: "review", source: "требуется проверка" },
      context("corr-vak-2")
    );
    knowledge.createEntityType(
      {
        key: "alternate-publication",
        label: "Другой тип публикации"
      },
      context("corr-alternate-type")
    );
    assert.throws(
      () =>
        publications.configure(
          space.id,
          {
            ...configuration,
            publicationEntityTypeKey: "alternate-publication"
          },
          context("corr-change-linked-type")
        ),
      PublicationConflictError
    );

    const vak = publications.buildReport(space.id, {
      year: 2026,
      classifications: ["vak"]
    });
    assert.equal(vak.totals.uniquePublications, 1);
    assert.equal(vak.totals.authorships, 2);
    assert.equal(vak.totals.internalAuthorships, 2);
    assert.equal(vak.totals.byClassification.vak, 1);
    assert.equal(vak.rows[0]?.publicationEntityId, first.entityId);

    const teacherReport = publications.buildReport(space.id, {
      year: 2026,
      teacherEntityId: teacherOne.entityId
    });
    assert.equal(teacherReport.totals.uniquePublications, 2);
    assert.equal(teacherReport.totals.authorships, 3);
    assert.equal(teacherReport.totals.uniqueInternalAuthors, 2);
    assert.equal(teacherReport.totals.withoutDoi, 1);

    const departmentReport = publications.buildReport(space.id, {
      year: 2026,
      department: "кафедра метеорологии"
    });
    assert.equal(departmentReport.totals.uniquePublications, 2);

    const withReview = publications.buildReport(space.id, {
      year: 2026,
      classifications: ["vak"],
      includeReview: true
    });
    assert.equal(withReview.totals.uniquePublications, 2);

    const history = knowledge.listPropertyValueHistory(first.entityId, {
      propertyKey: PUBLICATION_DERIVED_PROPERTY_KEYS.authors,
      limit: 10
    });
    assert.equal(history[0]?.value, "Иванов Иван Иванович; Петров Пётр Петрович");

    const snapshot = publications.createReportSnapshot(
      space.id,
      { year: 2026 },
      context("corr-report-snapshot")
    );
    assert.equal(snapshot.rowCount, 2);
    assert.equal(
      publications.getReportSnapshot(space.id, snapshot.id).rows.length,
      2
    );
    const snapshotAudience = publications.createAudienceSnapshotFromReportSnapshot(
      space.id,
      snapshot.id,
      context("corr-snapshot-audience")
    );
    assert.equal(snapshotAudience.audience.snapshot.memberCount, 2);
    assert.throws(
      () =>
        fixture.store.execute((connection) =>
          connection
            .prepare("UPDATE publication_report_snapshots SET row_count = 99 WHERE id = ?")
            .run(snapshot.id)
        ),
      /immutable/u
    );

    const audience = publications.createAudienceSnapshot(
      space.id,
      { year: 2026, classifications: ["rinc"] },
      context("corr-audience")
    );
    assert.equal(audience.audience.snapshot.memberCount, 1);
    assert.equal(audience.audience.plan.targetMode, "aggregate");
  } finally {
    fixture.cleanup();
  }
});

test("publication authors cannot cross space boundaries", () => {
  const fixture = createMigratedTestStore();
  try {
    const spaces = new SpaceRegistry(fixture.store);
    const publications = new PublicationRegistry(fixture.store);
    const science = spaces.createSpace(
      { key: "science", name: "Научная деятельность" },
      context("corr-science")
    );
    const other = spaces.createSpace(
      { key: "other", name: "Другое подразделение" },
      context("corr-other")
    );
    publications.ensureDefaultConfiguration(science.id, context("corr-bootstrap"));
    const publication = spaces.createEntity(
      science.id,
      { entityTypeKey: "scientific-publication", displayName: "Статья" },
      context("corr-publication")
    );
    const foreignTeacher = spaces.createEntity(
      other.id,
      { entityTypeKey: "person", displayName: "Чужой преподаватель" },
      context("corr-foreign")
    );
    assert.throws(
      () =>
        publications.replaceAuthors(
          science.id,
          publication.entityId,
          [{ authorEntityId: foreignTeacher.entityId }],
          context("corr-cross-space")
        ),
      PublicationNotFoundError
    );
  } finally {
    fixture.cleanup();
  }
});
