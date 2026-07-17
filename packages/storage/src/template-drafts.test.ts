import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { DocumentQuarantineRegistry } from "./document-quarantine.js";
import { ContentAddressedObjectStore } from "./object-store.js";
import { DEFAULT_SPACE_ID, SpaceRegistry } from "./spaces.js";
import {
  TemplateDraftConflictError,
  TemplateDraftNotFoundError,
  TemplateDraftRegistry
} from "./template-drafts.js";
import { createMigratedTestStore } from "./test-helpers.js";

const T0 = "2026-07-12T18:30:00.000Z";

function context(correlationId: string, actorId = "template-editor-1") {
  return {
    correlationId,
    actorType: "test",
    actorId,
    now: T0
  };
}

const STRUCTURE_SHA = "a".repeat(64);

async function sourceFixture() {
  const fixture = createMigratedTestStore();
  const objectStore = new ContentAddressedObjectStore(
    path.join(fixture.directory, "objects")
  );
  const quarantine = new DocumentQuarantineRegistry(fixture.store, objectStore);
  const drafts = new TemplateDraftRegistry(fixture.store);
  const source = await quarantine.saveAcceptedDocument(
    {
      spaceId: DEFAULT_SPACE_ID,
      fileName: "Письмо.docx",
      mediaType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      format: "docx",
      decision: "accepted",
      buffer: Buffer.from("checked-ooxml-source"),
      report: { decision: "accepted", issues: [] }
    },
    context("corr-source")
  );
  return { fixture, objectStore, quarantine, drafts, source };
}

test("draft creation is idempotent and preserves verified structure", async () => {
  const setup = await sourceFixture();
  try {
    const input = {
      spaceId: DEFAULT_SPACE_ID,
      sourceRecordId: setup.source.id,
      title: "Письмо",
      format: "docx" as const,
      sourceSha256: setup.source.sha256,
      structureSha256: STRUCTURE_SHA,
      structure: {
        fileName: "Письмо.docx",
        elements: [
          {
            id: "paragraph-example",
            kind: "paragraph",
            part: "word/document.xml",
            index: 0,
            text: "Получатель"
          }
        ]
      },
      structureTruncated: false
    };
    const first = setup.drafts.createOrGetDraft(input, context("corr-draft"));
    const second = setup.drafts.createOrGetDraft(
      input,
      context("corr-draft-repeat")
    );

    assert.equal(second.id, first.id);
    assert.equal(first.sourceSha256, setup.source.sha256);
    assert.equal(first.structureSha256, STRUCTURE_SHA);
    assert.deepEqual(first.fields, []);
    assert.equal(setup.drafts.listDrafts(DEFAULT_SPACE_ID).length, 1);
  } finally {
    setup.fixture.cleanup();
  }
});

test("field binding is stored once and remains scoped to the draft structure", async () => {
  const setup = await sourceFixture();
  try {
    const draft = setup.drafts.createOrGetDraft(
      {
        spaceId: DEFAULT_SPACE_ID,
        sourceRecordId: setup.source.id,
        title: "Письмо",
        format: "docx",
        sourceSha256: setup.source.sha256,
        structureSha256: STRUCTURE_SHA,
        structure: { elements: [{ id: "paragraph-example" }] },
        structureTruncated: false
      },
      context("corr-draft")
    );

    const field = setup.drafts.createField(
      DEFAULT_SPACE_ID,
      draft.id,
      {
        key: "recipient.full_name",
        label: "ФИО получателя",
        valueType: "string",
        required: true,
        elementId: "paragraph-example",
        elementKind: "paragraph",
        binding: {
          kind: "docx.paragraph",
          part: "word/document.xml",
          index: 0,
          elementId: "paragraph-example"
        },
        originalPreview: "Получатель",
        structureSha256: STRUCTURE_SHA
      },
      context("corr-field")
    );

    assert.equal(field.key, "recipient.full_name");
    assert.equal(field.required, true);
    assert.deepEqual(field.formatter, { version: 1, kind: "legacy" });
    assert.equal(
      setup.drafts.getDraft(DEFAULT_SPACE_ID, draft.id).fields[0]?.id,
      field.id
    );

    assert.throws(
      () =>
        setup.drafts.createField(
          DEFAULT_SPACE_ID,
          draft.id,
          {
            key: "recipient.position",
            label: "Должность",
            valueType: "string",
            elementId: "paragraph-example",
            elementKind: "paragraph",
            binding: { kind: "docx.paragraph" },
            originalPreview: "Получатель",
            structureSha256: STRUCTURE_SHA
          },
          context("corr-duplicate-element")
        ),
      TemplateDraftConflictError
    );
  } finally {
    setup.fixture.cleanup();
  }
});

test("drafts and fields cannot be resolved through another space", async () => {
  const setup = await sourceFixture();
  try {
    const spaces = new SpaceRegistry(setup.fixture.store);
    const other = spaces.createSpace(
      { key: "other", name: "Другое пространство" },
      context("corr-other")
    );
    const draft = setup.drafts.createOrGetDraft(
      {
        spaceId: DEFAULT_SPACE_ID,
        sourceRecordId: setup.source.id,
        title: "Письмо",
        format: "docx",
        sourceSha256: setup.source.sha256,
        structureSha256: STRUCTURE_SHA,
        structure: { elements: [] },
        structureTruncated: false
      },
      context("corr-draft")
    );

    assert.throws(
      () => setup.drafts.getDraft(other.id, draft.id),
      TemplateDraftNotFoundError
    );
  } finally {
    setup.fixture.cleanup();
  }
});

test("object store reads by SHA-256 and detects an invalid identifier", async () => {
  const setup = await sourceFixture();
  try {
    const content = await setup.objectStore.getBuffer(setup.source.sha256);
    assert.equal(content.toString("utf8"), "checked-ooxml-source");
    await assert.rejects(
      setup.objectStore.getBuffer("not-a-sha"),
      /64 hexadecimal/u
    );
  } finally {
    setup.fixture.cleanup();
  }
});
