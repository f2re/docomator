import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { DocumentQuarantineRegistry } from "./document-quarantine.js";
import { MultiFieldTestVersionRegistry } from "./multi-field-test-versions.js";
import { ContentAddressedObjectStore } from "./object-store.js";
import { DEFAULT_SPACE_ID, SpaceRegistry } from "./spaces.js";
import { TemplateDraftRegistry } from "./template-drafts.js";
import {
  TemplatePreviewNotFoundError
} from "./template-preview-activation.js";
import { TemplateReleaseRegistry } from "./template-releases.js";
import { TemplateTestVersionRegistry } from "./template-test-versions.js";
import { createMigratedTestStore } from "./test-helpers.js";

const NOW = "2026-07-13T06:00:00.000Z";
const STRUCTURE_SHA = "e".repeat(64);

function context(correlationId: string, offsetSeconds = 0) {
  return {
    correlationId,
    actorType: "test",
    actorId: "template-editor-1",
    now: new Date(Date.parse(NOW) + offsetSeconds * 1_000).toISOString()
  };
}

function binding(elementId: string, index: number) {
  return {
    version: 1,
    kind: "docx.paragraph",
    elementId,
    part: "word/document.xml",
    index
  };
}

function technicalBinding(fieldId: string, index: number) {
  return {
    kind: "docx.sdt",
    identifier: `aifield:${fieldId}`,
    part: "word/document.xml",
    target: `абзац ${index + 1}`
  };
}

function pdf(label: string): Buffer {
  return Buffer.from(
    `%PDF-1.4\n% Docomator ${label}\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n`
  );
}

async function setupFixture() {
  const fixture = createMigratedTestStore();
  const objectStore = new ContentAddressedObjectStore(
    path.join(fixture.directory, "objects")
  );
  const quarantine = new DocumentQuarantineRegistry(fixture.store, objectStore);
  const drafts = new TemplateDraftRegistry(fixture.store);
  const singleVersions = new TemplateTestVersionRegistry(
    fixture.store,
    objectStore
  );
  const multiVersions = new MultiFieldTestVersionRegistry(
    fixture.store,
    objectStore
  );
  const releases = new TemplateReleaseRegistry(fixture.store, objectStore);

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
      structure: {
        elements: [
          { id: "paragraph-1", kind: "paragraph" },
          { id: "paragraph-2", kind: "paragraph" }
        ]
      },
      structureTruncated: false
    },
    context("corr-draft")
  );
  const nameBinding = binding("paragraph-1", 0);
  const positionBinding = binding("paragraph-2", 1);
  const nameField = drafts.createField(
    DEFAULT_SPACE_ID,
    draft.id,
    {
      key: "recipient.full_name",
      label: "ФИО получателя",
      valueType: "string",
      required: true,
      elementId: "paragraph-1",
      elementKind: "paragraph",
      binding: nameBinding,
      originalPreview: "ФИО получателя",
      structureSha256: STRUCTURE_SHA
    },
    context("corr-name-field")
  );
  const positionField = drafts.createField(
    DEFAULT_SPACE_ID,
    draft.id,
    {
      key: "recipient.position",
      label: "Должность получателя",
      valueType: "string",
      required: true,
      elementId: "paragraph-2",
      elementKind: "paragraph",
      binding: positionBinding,
      originalPreview: "Должность получателя",
      structureSha256: STRUCTURE_SHA
    },
    context("corr-position-field")
  );

  const single = await singleVersions.recordTestedVersion(
    {
      spaceId: DEFAULT_SPACE_ID,
      draftId: draft.id,
      fieldId: nameField.id,
      format: "docx",
      compiledBuffer: Buffer.from("single-compiled-template"),
      trialBuffer: Buffer.from("single-trial-template"),
      technicalBinding: technicalBinding(nameField.id, 0),
      sampleValue: "Иванов Иван Иванович",
      renderedValue: "Иванов Иван Иванович",
      readBackValue: "Иванов Иван Иванович",
      verification: { matched: true }
    },
    context("corr-single", 1)
  );
  const multi = await multiVersions.recordTestedVersion(
    {
      spaceId: DEFAULT_SPACE_ID,
      draftId: draft.id,
      format: "docx",
      compiledBuffer: Buffer.from("multi-compiled-template"),
      trialBuffer: Buffer.from("multi-trial-template"),
      fields: [
        {
          fieldId: positionField.id,
          fieldKey: "recipient.position",
          fieldLabel: "Должность получателя",
          valueType: "string",
          required: true,
          binding: positionBinding,
          technicalBinding: technicalBinding(positionField.id, 1),
          sampleValue: "Ведущий инженер",
          renderedValue: "Ведущий инженер",
          readBackValue: "Ведущий инженер",
          verification: { matched: true }
        },
        {
          fieldId: nameField.id,
          fieldKey: "recipient.full_name",
          fieldLabel: "ФИО получателя",
          valueType: "string",
          required: true,
          binding: nameBinding,
          technicalBinding: technicalBinding(nameField.id, 0),
          sampleValue: "Иванов Иван Иванович",
          renderedValue: "Иванов Иван Иванович",
          readBackValue: "Иванов Иван Иванович",
          verification: { matched: true }
        }
      ],
      verification: { allMatched: true, fieldCount: 2 }
    },
    context("corr-multi", 2)
  );

  return {
    fixture,
    objectStore,
    releases,
    draft,
    single,
    multi
  };
}

test("single and multi-field tested versions share one release catalog", async () => {
  const setup = await setupFixture();
  try {
    const candidates = setup.fixture.store.execute((database) =>
      database
        .prepare(
          "SELECT id, kind, field_count FROM template_release_candidates ORDER BY source_version_number"
        )
        .all()
    ) as Array<{ id: string; kind: string; field_count: number }>;
    assert.deepEqual(
      candidates.map((candidate) => [
        candidate.id,
        candidate.kind,
        Number(candidate.field_count)
      ]),
      [
        [setup.single.id, "single", 1],
        [setup.multi.id, "multi", 2]
      ]
    );

    const singleRequest = setup.releases.requestPreview(
      {
        spaceId: DEFAULT_SPACE_ID,
        versionId: setup.single.id,
        versionKind: "single"
      },
      context("corr-single-preview", 3)
    );
    const singleReady = await setup.releases.completePreview(
      {
        requestId: singleRequest.request.id,
        previewBuffer: pdf("single"),
        converter: { converter: "LibreOffice", durationMs: 10 }
      },
      context("corr-single-ready", 4)
    );
    const singleRelease = setup.releases.activateVersion(
      {
        spaceId: DEFAULT_SPACE_ID,
        previewRequestId: singleReady.id
      },
      context("corr-single-activate", 5)
    );
    assert.equal(singleRelease.versionKind, "single");
    assert.equal(singleRelease.versionNumber, 1);
    assert.equal(singleRelease.fieldCount, 1);

    const multiRequest = setup.releases.requestPreview(
      {
        spaceId: DEFAULT_SPACE_ID,
        versionId: setup.multi.id,
        versionKind: "multi"
      },
      context("corr-multi-preview", 6)
    );
    assert.equal(multiRequest.request.fieldCount, 2);
    assert.equal(multiRequest.request.versionKind, "multi");
    const duplicateRequest = setup.releases.requestPreview(
      {
        spaceId: DEFAULT_SPACE_ID,
        versionId: setup.multi.id,
        versionKind: "multi"
      },
      context("corr-multi-preview-repeat", 7)
    );
    assert.equal(duplicateRequest.created, false);
    assert.equal(duplicateRequest.request.id, multiRequest.request.id);

    const multiReady = await setup.releases.completePreview(
      {
        requestId: multiRequest.request.id,
        previewBuffer: pdf("multi"),
        converter: { converter: "LibreOffice", durationMs: 12 }
      },
      context("corr-multi-ready", 8)
    );
    const multiRelease = setup.releases.activateVersion(
      {
        spaceId: DEFAULT_SPACE_ID,
        previewRequestId: multiReady.id
      },
      context("corr-multi-activate", 9)
    );
    assert.equal(multiRelease.versionKind, "multi");
    assert.equal(multiRelease.versionNumber, 2);
    assert.equal(multiRelease.fieldCount, 2);
    assert.equal(multiRelease.compiledSha256, setup.multi.compiledSha256);

    const manifest = multiRelease.manifest as {
      version: number;
      versionKind: string;
      fieldCount: number;
      fields: Array<{ key: string; required: boolean }>;
    };
    assert.equal(manifest.version, 2);
    assert.equal(manifest.versionKind, "multi");
    assert.equal(manifest.fieldCount, 2);
    assert.deepEqual(
      manifest.fields.map((field) => [field.key, field.required]),
      [
        ["recipient.full_name", true],
        ["recipient.position", true]
      ]
    );

    const active = setup.releases.listActiveTemplates(DEFAULT_SPACE_ID);
    assert.equal(active.length, 1);
    assert.equal(active[0]?.id, multiRelease.id);
    assert.equal(
      (
        await setup.objectStore.getBuffer(
          setup.releases.getActiveTemplate(
            DEFAULT_SPACE_ID,
            multiRelease.id
          ).compiledSha256
        )
      ).toString(),
      "multi-compiled-template"
    );

    const repeated = setup.releases.activateVersion(
      {
        spaceId: DEFAULT_SPACE_ID,
        previewRequestId: multiReady.id
      },
      context("corr-multi-activate-repeat", 10)
    );
    assert.equal(repeated.id, multiRelease.id);

    assert.throws(() =>
      setup.fixture.store.execute((database) =>
        database
          .prepare("UPDATE template_releases SET title = ? WHERE id = ?")
          .run("Изменено", multiRelease.id)
      )
    );
  } finally {
    setup.fixture.cleanup();
  }
});

test("release previews stay isolated by space and validate version kind", async () => {
  const setup = await setupFixture();
  try {
    assert.throws(
      () =>
        setup.releases.requestPreview(
          {
            spaceId: DEFAULT_SPACE_ID,
            versionId: setup.multi.id,
            versionKind: "single"
          },
          context("corr-wrong-kind", 3)
        ),
      TemplatePreviewNotFoundError
    );

    const requested = setup.releases.requestPreview(
      {
        spaceId: DEFAULT_SPACE_ID,
        versionId: setup.multi.id,
        versionKind: "multi"
      },
      context("corr-preview", 4)
    );
    setup.releases.failPreview(
      requested.request.id,
      { code: "preview_failed", message: "Не удалось создать PDF." },
      context("corr-failed", 5)
    );
    const retried = setup.releases.requestPreview(
      {
        spaceId: DEFAULT_SPACE_ID,
        versionId: setup.multi.id,
        versionKind: "multi"
      },
      context("corr-retry", 6)
    );
    assert.equal(retried.retried, true);
    assert.equal(retried.request.requestAttempt, 2);

    const spaces = new SpaceRegistry(setup.fixture.store);
    const other = spaces.createSpace(
      { key: "other-release", name: "Другое пространство" },
      context("corr-other", 7)
    );
    assert.throws(
      () => setup.releases.getPreview(other.id, retried.request.id),
      TemplatePreviewNotFoundError
    );
  } finally {
    setup.fixture.cleanup();
  }
});
