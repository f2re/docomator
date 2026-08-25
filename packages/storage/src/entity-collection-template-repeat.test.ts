import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { DocumentQuarantineRegistry } from "./document-quarantine.js";
import {
  ENTITY_COLLECTION_ROW_NUMBER_KEY,
  EntityCollectionTemplateRepeatConflictError,
  EntityCollectionTemplateRepeatRegistry,
  EntityCollectionTemplateRepeatValidationError
} from "./entity-collection-template-repeat.js";
import { EntityCollectionRegistry } from "./entity-collections.js";
import { ContentAddressedObjectStore } from "./object-store.js";
import { DEFAULT_SPACE_ID, SpaceRegistry } from "./spaces.js";
import { TemplateDraftRegistry } from "./template-drafts.js";
import { createMigratedTestStore } from "./test-helpers.js";

const T0 = "2026-08-24T15:10:00.000Z";
const STRUCTURE_SHA = "e".repeat(64);

function context(correlationId: string) {
  return {
    correlationId,
    actorType: "test",
    actorId: "operator-repeat",
    now: T0
  };
}

async function setupFixture() {
  const fixture = createMigratedTestStore();
  const objectStore = new ContentAddressedObjectStore(
    path.join(fixture.directory, "objects")
  );
  const quarantine = new DocumentQuarantineRegistry(fixture.store, objectStore);
  const drafts = new TemplateDraftRegistry(fixture.store);
  const collections = new EntityCollectionRegistry(fixture.store);
  const repeats = new EntityCollectionTemplateRepeatRegistry(fixture.store);
  const source = await quarantine.saveAcceptedDocument(
    {
      spaceId: DEFAULT_SPACE_ID,
      fileName: "План.docx",
      mediaType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      format: "docx",
      decision: "accepted",
      buffer: Buffer.from("checked-entity-collection-template-source"),
      report: { decision: "accepted", issues: [] }
    },
    context("corr-source")
  );
  const draft = drafts.createOrGetDraft(
    {
      spaceId: DEFAULT_SPACE_ID,
      sourceRecordId: source.id,
      title: "План студента",
      format: "docx",
      sourceSha256: source.sha256,
      structureSha256: STRUCTURE_SHA,
      structure: {
        elements: [
          {
            id: "student-anchor",
            kind: "paragraph",
            part: "word/document.xml",
            index: 0,
            text: "Студент"
          },
          {
            id: "number-cell",
            kind: "paragraph",
            part: "word/document.xml",
            index: 3,
            text: "____",
            tableLocation: { tableIndex: 0, rowIndex: 1, columnIndex: 0 }
          },
          {
            id: "question-cell",
            kind: "paragraph",
            part: "word/document.xml",
            index: 4,
            text: "____",
            tableLocation: { tableIndex: 0, rowIndex: 1, columnIndex: 1 }
          }
        ]
      },
      structureTruncated: false
    },
    context("corr-draft")
  );
  const definition = collections.createDefinition(
    DEFAULT_SPACE_ID,
    {
      label: "Пункты плана",
      ownerEntityTypeKey: "person",
      fields: [
        {
          label: "Наименование вопроса",
          valueType: "text",
          required: true
        }
      ]
    },
    context("corr-definition")
  );
  const question = definition.fields[0]!;
  drafts.createField(
    DEFAULT_SPACE_ID,
    draft.id,
    {
      key: "person.full_name",
      label: "ФИО студента",
      valueType: "string",
      required: true,
      elementId: "student-anchor",
      elementKind: "paragraph",
      binding: {
        version: 1,
        kind: "docx.paragraph",
        elementId: "student-anchor",
        part: "word/document.xml",
        index: 0
      },
      originalPreview: "Студент",
      structureSha256: STRUCTURE_SHA
    },
    context("corr-field-student")
  );
  drafts.createField(
    DEFAULT_SPACE_ID,
    draft.id,
    {
      key: ENTITY_COLLECTION_ROW_NUMBER_KEY,
      label: "Номер строки",
      valueType: "integer",
      required: true,
      elementId: "number-cell",
      elementKind: "paragraph",
      binding: {
        version: 1,
        kind: "docx.text-range",
        elementId: "number-cell",
        part: "word/document.xml",
        index: 3,
        startOffset: 0,
        endOffset: 4,
        selectedText: "____",
        tableLocation: { tableIndex: 0, rowIndex: 1, columnIndex: 0 }
      },
      originalPreview: "____",
      structureSha256: STRUCTURE_SHA
    },
    context("corr-field-number")
  );
  drafts.createField(
    DEFAULT_SPACE_ID,
    draft.id,
    {
      key: question.key,
      label: question.label,
      valueType: question.valueType,
      required: true,
      elementId: "question-cell",
      elementKind: "paragraph",
      binding: {
        version: 1,
        kind: "docx.text-range",
        elementId: "question-cell",
        part: "word/document.xml",
        index: 4,
        startOffset: 0,
        endOffset: 4,
        selectedText: "____",
        tableLocation: { tableIndex: 0, rowIndex: 1, columnIndex: 1 }
      },
      originalPreview: "____",
      structureSha256: STRUCTURE_SHA
    },
    context("corr-field-question")
  );
  return { fixture, drafts, collections, repeats, draft, definition, question };
}

test("entity collection repeat keeps scalar fields outside row and freezes collection schema", async () => {
  const setup = await setupFixture();
  try {
    const repeat = setup.repeats.configure(
      DEFAULT_SPACE_ID,
      setup.draft.id,
      {
        collectionId: setup.definition.id,
        anchorElementId: "number-cell",
        part: "word/document.xml",
        tableIndex: 0,
        rowIndex: 1,
        numberingStart: 1,
        numberingStep: 1
      },
      context("corr-repeat")
    );

    assert.equal(repeat.sourceKind, "entity_collection");
    assert.equal(repeat.collectionDefinitionId, setup.definition.id);
    assert.equal(repeat.collectionKey, setup.definition.key);
    assert.equal(repeat.collectionVersion, setup.definition.version);
    assert.deepEqual(repeat.numbering, { start: 1, step: 1 });
    assert.equal(
      setup.drafts.getDraft(DEFAULT_SPACE_ID, setup.draft.id).fields.length,
      3
    );
    assert.equal(
      setup.repeats.getOptionalForDraft(DEFAULT_SPACE_ID, setup.draft.id)?.draftId,
      setup.draft.id
    );

    const replay = setup.repeats.configure(
      DEFAULT_SPACE_ID,
      setup.draft.id,
      {
        collectionId: setup.definition.key,
        anchorElementId: "number-cell",
        part: "word/document.xml",
        tableIndex: 0,
        rowIndex: 1,
        numberingStart: 1,
        numberingStep: 1
      },
      context("corr-repeat-replay")
    );
    assert.deepEqual(replay, repeat);

    assert.throws(
      () =>
        setup.repeats.configure(
          DEFAULT_SPACE_ID,
          setup.draft.id,
          {
            collectionId: setup.definition.id,
            anchorElementId: "number-cell",
            part: "word/document.xml",
            tableIndex: 0,
            rowIndex: 1,
            numberingStart: 10,
            numberingStep: 1
          },
          context("corr-repeat-conflict")
        ),
      EntityCollectionTemplateRepeatConflictError
    );

    assert.throws(
      () =>
        setup.fixture.store.execute((database) =>
          database
            .prepare(
              "UPDATE entity_collection_template_repeats SET numbering_start = 2 WHERE draft_id = ?"
            )
            .run(setup.draft.id)
        ),
      /immutable/u
    );
  } finally {
    setup.fixture.cleanup();
  }
});

test("collection repeat rejects fields from another row and stays space-scoped", async () => {
  const setup = await setupFixture();
  try {
    assert.throws(
      () =>
        setup.repeats.configure(
          DEFAULT_SPACE_ID,
          setup.draft.id,
          {
            collectionId: setup.definition.id,
            anchorElementId: "number-cell",
            part: "word/document.xml",
            tableIndex: 0,
            rowIndex: 2
          },
          context("corr-wrong-row")
        ),
      EntityCollectionTemplateRepeatValidationError
    );

    const spaces = new SpaceRegistry(setup.fixture.store);
    const other = spaces.createSpace(
      { name: "Другое пространство" },
      context("corr-other-space")
    );
    assert.equal(
      setup.repeats.getOptionalForDraft(other.id, setup.draft.id),
      null
    );
  } finally {
    setup.fixture.cleanup();
  }
});
