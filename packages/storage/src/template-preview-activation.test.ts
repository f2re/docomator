import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { DocumentQuarantineRegistry } from "./document-quarantine.js";
import { ContentAddressedObjectStore } from "./object-store.js";
import { DEFAULT_SPACE_ID, SpaceRegistry } from "./spaces.js";
import { TemplateDraftRegistry } from "./template-drafts.js";
import {
  TemplateActivationNotFoundError,
  TemplatePreviewActivationRegistry,
  TemplatePreviewNotFoundError
} from "./template-preview-activation.js";
import { TemplateTestVersionRegistry } from "./template-test-versions.js";
import { createMigratedTestStore } from "./test-helpers.js";

const NOW = "2026-07-12T22:00:00.000Z";
const STRUCTURE_SHA = "b".repeat(64);

function context(correlationId: string, offsetSeconds = 0) {
  return {
    correlationId,
    actorType: "test",
    actorId: "template-editor-1",
    now: new Date(Date.parse(NOW) + offsetSeconds * 1_000).toISOString()
  };
}

async function setupFixture() {
  const fixture = createMigratedTestStore();
  const objectStore = new ContentAddressedObjectStore(
    path.join(fixture.directory, "objects")
  );
  const quarantine = new DocumentQuarantineRegistry(fixture.store, objectStore);
  const drafts = new TemplateDraftRegistry(fixture.store);
  const testedVersions = new TemplateTestVersionRegistry(
    fixture.store,
    objectStore
  );
  const previews = new TemplatePreviewActivationRegistry(
    fixture.store,
    objectStore
  );

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
  const tested = await testedVersions.recordTestedVersion(
    {
      spaceId: DEFAULT_SPACE_ID,
      draftId: draft.id,
      fieldId: field.id,
      format: "docx",
      compiledBuffer: Buffer.from("compiled-template"),
      trialBuffer: Buffer.from("trial-template"),
      technicalBinding: {
        kind: "docx.sdt",
        identifier: `aifield:${field.id}`,
        part: "word/document.xml",
        target: "абзац 1"
      },
      sampleValue: "Иванов Иван Иванович",
      renderedValue: "Иванов Иван Иванович",
      readBackValue: "Иванов Иван Иванович",
      verification: { matched: true }
    },
    context("corr-tested")
  );
  return {
    fixture,
    objectStore,
    quarantine,
    drafts,
    testedVersions,
    previews,
    source,
    draft,
    field,
    tested
  };
}

function pdf(label = "preview"): Buffer {
  return Buffer.from(`%PDF-1.4\n% Docomator ${label}\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n`);
}

test("preview request is idempotent and enqueues one persistent job", async () => {
  const setup = await setupFixture();
  try {
    const first = setup.previews.requestPreview(
      {
        spaceId: DEFAULT_SPACE_ID,
        testVersionId: setup.tested.id
      },
      context("corr-preview")
    );
    const duplicate = setup.previews.requestPreview(
      {
        spaceId: DEFAULT_SPACE_ID,
        testVersionId: setup.tested.id
      },
      context("corr-preview-repeat", 1)
    );

    assert.equal(first.created, true);
    assert.equal(first.retried, false);
    assert.equal(first.request.state, "pending");
    assert.equal(first.request.workerJobState, "pending");
    assert.equal(first.request.requestAttempt, 1);
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.request.id, first.request.id);
    assert.equal(duplicate.request.workerJobId, first.request.workerJobId);

    const jobs = setup.fixture.store.execute((database) =>
      database
        .prepare(
          "SELECT job_type, idempotency_key FROM worker_jobs WHERE job_type = 'template.preview'"
        )
        .all()
    ) as Array<{ job_type: string; idempotency_key: string }>;
    assert.equal(jobs.length, 1);
    assert.match(jobs[0]?.idempotency_key ?? "", /attempt:1$/u);
  } finally {
    setup.fixture.cleanup();
  }
});

test("failed preview can be explicitly retried with a new job attempt", async () => {
  const setup = await setupFixture();
  try {
    const requested = setup.previews.requestPreview(
      { spaceId: DEFAULT_SPACE_ID, testVersionId: setup.tested.id },
      context("corr-preview")
    );
    const failed = setup.previews.failPreview(
      requested.request.id,
      { code: "conversion_failed", message: "Не удалось создать PDF." },
      context("corr-failed", 1)
    );
    assert.equal(failed.state, "failed");

    const retried = setup.previews.requestPreview(
      { spaceId: DEFAULT_SPACE_ID, testVersionId: setup.tested.id },
      context("corr-retry", 2)
    );
    assert.equal(retried.retried, true);
    assert.equal(retried.request.state, "pending");
    assert.equal(retried.request.requestAttempt, 2);
    assert.notEqual(retried.request.workerJobId, requested.request.workerJobId);
  } finally {
    setup.fixture.cleanup();
  }
});

test("ready PDF is verified, stored and required for activation", async () => {
  const setup = await setupFixture();
  try {
    const requested = setup.previews.requestPreview(
      { spaceId: DEFAULT_SPACE_ID, testVersionId: setup.tested.id },
      context("corr-preview")
    );
    assert.throws(
      () =>
        setup.previews.activateVersion(
          {
            spaceId: DEFAULT_SPACE_ID,
            previewRequestId: requested.request.id
          },
          context("corr-early-activation", 1)
        ),
      TemplateActivationNotFoundError
    );

    const ready = await setup.previews.completePreview(
      {
        requestId: requested.request.id,
        previewBuffer: pdf(),
        converter: {
          name: "LibreOffice",
          exitCode: 0,
          durationMs: 125,
          outputFormat: "pdf"
        }
      },
      context("corr-ready", 2)
    );
    assert.equal(ready.state, "ready");
    assert.ok(ready.previewSha256);
    assert.equal(
      (await setup.objectStore.getBuffer(ready.previewSha256)).subarray(0, 5).toString(),
      "%PDF-"
    );

    const active = setup.previews.activateVersion(
      {
        spaceId: DEFAULT_SPACE_ID,
        previewRequestId: ready.id
      },
      context("corr-activate", 3)
    );
    assert.equal(active.versionNumber, 1);
    assert.equal(active.title, "Официальное письмо");
    assert.equal(active.compiledSha256, setup.tested.compiledSha256);
    assert.equal(active.previewSha256, ready.previewSha256);
    const manifest = active.manifest as {
      fields: Array<{ key: string; required: boolean }>;
    };
    assert.equal(manifest.fields[0]?.key, "recipient.full_name");
    assert.equal(manifest.fields[0]?.required, true);

    const duplicate = setup.previews.activateVersion(
      {
        spaceId: DEFAULT_SPACE_ID,
        previewRequestId: ready.id
      },
      context("corr-activate-repeat", 4)
    );
    assert.equal(duplicate.id, active.id);
    assert.equal(setup.previews.listActiveTemplates(DEFAULT_SPACE_ID).length, 1);

    assert.throws(() =>
      setup.fixture.store.execute((database) =>
        database
          .prepare("UPDATE template_active_versions SET title = ? WHERE id = ?")
          .run("Изменено", active.id)
      )
    );
  } finally {
    setup.fixture.cleanup();
  }
});

test("invalid PDF and cross-space identifiers are rejected", async () => {
  const setup = await setupFixture();
  try {
    const requested = setup.previews.requestPreview(
      { spaceId: DEFAULT_SPACE_ID, testVersionId: setup.tested.id },
      context("corr-preview")
    );
    await assert.rejects(
      setup.previews.completePreview(
        {
          requestId: requested.request.id,
          previewBuffer: Buffer.from("not-a-pdf"),
          converter: { name: "fake" }
        },
        context("corr-invalid", 1)
      ),
      /valid PDF/u
    );

    const spaces = new SpaceRegistry(setup.fixture.store);
    const other = spaces.createSpace(
      { key: "other-preview", name: "Другое пространство" },
      context("corr-other", 2)
    );
    assert.throws(
      () => setup.previews.getPreview(other.id, requested.request.id),
      TemplatePreviewNotFoundError
    );
  } finally {
    setup.fixture.cleanup();
  }
});
