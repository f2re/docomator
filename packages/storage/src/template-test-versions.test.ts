import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { DocumentQuarantineRegistry } from "./document-quarantine.js";
import { ContentAddressedObjectStore } from "./object-store.js";
import { DEFAULT_SPACE_ID, SpaceRegistry } from "./spaces.js";
import { TemplateDraftRegistry } from "./template-drafts.js";
import {
  TemplateTestVersionNotFoundError,
  TemplateTestVersionRegistry
} from "./template-test-versions.js";
import { createMigratedTestStore } from "./test-helpers.js";

const NOW = "2026-07-12T20:00:00.000Z";
const STRUCTURE_SHA = "a".repeat(64);

function context(correlationId: string) {
  return {
    correlationId,
    actorType: "test",
    actorId: "template-editor-1",
    now: NOW
  };
}

async function setupFixture() {
  const fixture = createMigratedTestStore();
  const objectStore = new ContentAddressedObjectStore(
    path.join(fixture.directory, "objects")
  );
  const quarantine = new DocumentQuarantineRegistry(fixture.store, objectStore);
  const drafts = new TemplateDraftRegistry(fixture.store);
  const versions = new TemplateTestVersionRegistry(fixture.store, objectStore);
  const source = await quarantine.saveAcceptedDocument(
    {
      spaceId: DEFAULT_SPACE_ID,
      fileName: "Письмо.docx",
      mediaType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      format: "docx",
      decision: "accepted",
      buffer: Buffer.from("verified-source"),
      report: { decision: "accepted" }
    },
    context("corr-source")
  );
  const draft = drafts.createOrGetDraft(
    {
      spaceId: DEFAULT_SPACE_ID,
      sourceRecordId: source.id,
      title: "Официальное письмо",
      format: "docx",
      sourceSha256: source.sha256,
      structureSha256: STRUCTURE_SHA,
      structure: { elements: [{ id: "paragraph-1" }] },
      structureTruncated: false
    },
    context("corr-draft")
  );
  const field = drafts.createField(
    DEFAULT_SPACE_ID,
    draft.id,
    {
      key: "recipient.full_name",
      label: "ФИО получателя",
      valueType: "string",
      required: true,
      elementId: "paragraph-1",
      elementKind: "paragraph",
      binding: {
        version: 1,
        kind: "docx.paragraph",
        elementId: "paragraph-1",
        part: "word/document.xml",
        index: 0
      },
      originalPreview: "ФИО получателя",
      structureSha256: STRUCTURE_SHA
    },
    context("corr-field")
  );
  return { fixture, objectStore, drafts, versions, source, draft, field };
}

test("tested version stores immutable compiled and trial objects", async () => {
  const setup = await setupFixture();
  try {
    const input = {
      spaceId: DEFAULT_SPACE_ID,
      draftId: setup.draft.id,
      fieldId: setup.field.id,
      format: "docx" as const,
      compiledBuffer: Buffer.from("compiled-ooxml"),
      trialBuffer: Buffer.from("trial-ooxml-with-value"),
      technicalBinding: {
        kind: "docx.sdt",
        identifier: "aifield:field-1",
        part: "word/document.xml",
        target: "абзац 1"
      },
      sampleValue: "Иванов Иван Иванович",
      renderedValue: "Иванов Иван Иванович",
      readBackValue: "Иванов Иван Иванович",
      verification: { matched: true }
    };
    const first = await setup.versions.recordTestedVersion(
      input,
      context("corr-test-version")
    );
    const duplicate = await setup.versions.recordTestedVersion(
      input,
      context("corr-test-version-repeat")
    );

    assert.equal(first.id, duplicate.id);
    assert.equal(first.versionNumber, 1);
    assert.equal(first.status, "tested");
    assert.equal(first.renderedValue, first.readBackValue);
    assert.equal(
      (await setup.objectStore.getBuffer(first.compiledSha256)).toString("utf8"),
      "compiled-ooxml"
    );
    assert.equal(
      (await setup.objectStore.getBuffer(first.trialSha256)).toString("utf8"),
      "trial-ooxml-with-value"
    );
    assert.equal(
      setup.versions.listVersions(DEFAULT_SPACE_ID, setup.draft.id).length,
      1
    );

    const events = setup.fixture.store.execute((database) =>
      database
        .prepare(
          "SELECT event_type FROM domain_events WHERE event_type = 'template.test-version.created'"
        )
        .all()
    ) as Array<{ event_type: string }>;
    const audit = setup.fixture.store.execute((database) =>
      database
        .prepare(
          "SELECT action FROM audit_log WHERE object_type = 'template_draft' AND action = 'trial_render'"
        )
        .all()
    ) as Array<{ action: string }>;
    assert.equal(events.length, 1);
    assert.equal(audit.length, 1);
  } finally {
    setup.fixture.cleanup();
  }
});

test("a different trial output creates the next immutable version", async () => {
  const setup = await setupFixture();
  try {
    const base = {
      spaceId: DEFAULT_SPACE_ID,
      draftId: setup.draft.id,
      fieldId: setup.field.id,
      format: "docx" as const,
      compiledBuffer: Buffer.from("compiled-ooxml"),
      technicalBinding: { kind: "docx.sdt", identifier: "aifield:field-1" },
      verification: { matched: true }
    };
    const first = await setup.versions.recordTestedVersion(
      {
        ...base,
        trialBuffer: Buffer.from("trial-one"),
        sampleValue: "Иванов",
        renderedValue: "Иванов",
        readBackValue: "Иванов"
      },
      context("corr-first")
    );
    const second = await setup.versions.recordTestedVersion(
      {
        ...base,
        trialBuffer: Buffer.from("trial-two"),
        sampleValue: "Петров",
        renderedValue: "Петров",
        readBackValue: "Петров"
      },
      context("corr-second")
    );
    assert.equal(first.versionNumber, 1);
    assert.equal(second.versionNumber, 2);
    assert.deepEqual(
      setup.versions
        .listVersions(DEFAULT_SPACE_ID, setup.draft.id)
        .map((version) => version.versionNumber),
      [2, 1]
    );
  } finally {
    setup.fixture.cleanup();
  }
});

test("tested versions are hidden from another space and immutable in SQLite", async () => {
  const setup = await setupFixture();
  try {
    const version = await setup.versions.recordTestedVersion(
      {
        spaceId: DEFAULT_SPACE_ID,
        draftId: setup.draft.id,
        fieldId: setup.field.id,
        format: "docx",
        compiledBuffer: Buffer.from("compiled"),
        trialBuffer: Buffer.from("trial"),
        technicalBinding: { kind: "docx.sdt" },
        sampleValue: "Иванов",
        renderedValue: "Иванов",
        readBackValue: "Иванов",
        verification: { matched: true }
      },
      context("corr-version")
    );
    const spaces = new SpaceRegistry(setup.fixture.store);
    const other = spaces.createSpace(
      { key: "other-tested", name: "Другое пространство" },
      context("corr-other")
    );
    assert.throws(
      () => setup.versions.getVersion(other.id, version.id),
      TemplateTestVersionNotFoundError
    );
    assert.throws(() =>
      setup.fixture.store.execute((database) =>
        database
          .prepare("UPDATE template_test_versions SET rendered_value = ? WHERE id = ?")
          .run("Изменено", version.id)
      )
    );
  } finally {
    setup.fixture.cleanup();
  }
});


test("tested version preserves leading and trailing spaces exactly", async () => {
  const setup = await setupFixture();
  try {
    const version = await setup.versions.recordTestedVersion(
      {
        spaceId: DEFAULT_SPACE_ID,
        draftId: setup.draft.id,
        fieldId: setup.field.id,
        format: "docx",
        compiledBuffer: Buffer.from("compiled-spaces"),
        trialBuffer: Buffer.from("trial-spaces"),
        technicalBinding: { kind: "docx.sdt" },
        sampleValue: "  Иванов  ",
        renderedValue: "  Иванов  ",
        readBackValue: "  Иванов  ",
        verification: { matched: true }
      },
      context("corr-spaces")
    );
    assert.equal(version.renderedValue, "  Иванов  ");
    assert.equal(version.readBackValue, "  Иванов  ");
  } finally {
    setup.fixture.cleanup();
  }
});
