import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { DocumentQuarantineRegistry } from "./document-quarantine.js";
import {
  MultiFieldTestVersionNotFoundError,
  MultiFieldTestVersionRegistry,
  MultiFieldTestVersionValidationError
} from "./multi-field-test-versions.js";
import { ContentAddressedObjectStore } from "./object-store.js";
import { DEFAULT_SPACE_ID, SpaceRegistry } from "./spaces.js";
import { TemplateDraftRegistry } from "./template-drafts.js";
import { createMigratedTestStore } from "./test-helpers.js";

const NOW = "2026-07-13T05:00:00.000Z";
const STRUCTURE_SHA = "e".repeat(64);

function context(correlationId: string) {
  return {
    correlationId,
    actorType: "test",
    actorId: "editor-1",
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
  const versions = new MultiFieldTestVersionRegistry(fixture.store, objectStore);
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
      structure: { elements: [{ id: "p1" }, { id: "p2" }] },
      structureTruncated: false
    },
    context("corr-draft")
  );
  const name = drafts.createField(
    DEFAULT_SPACE_ID,
    draft.id,
    {
      key: "recipient.full_name",
      label: "ФИО получателя",
      valueType: "string",
      required: true,
      elementId: "p1",
      elementKind: "paragraph",
      binding: {
        version: 1,
        kind: "docx.paragraph",
        elementId: "p1",
        part: "word/document.xml",
        index: 0
      },
      formatter: { version: 1, kind: "identity" },
      originalPreview: "ФИО",
      structureSha256: STRUCTURE_SHA
    },
    context("corr-name")
  );
  const position = drafts.createField(
    DEFAULT_SPACE_ID,
    draft.id,
    {
      key: "recipient.position",
      label: "Должность",
      valueType: "string",
      required: true,
      elementId: "p2",
      elementKind: "paragraph",
      binding: {
        version: 1,
        kind: "docx.paragraph",
        elementId: "p2",
        part: "word/document.xml",
        index: 1
      },
      formatter: { version: 1, kind: "identity" },
      originalPreview: "Должность",
      structureSha256: STRUCTURE_SHA
    },
    context("corr-position")
  );
  return { fixture, objectStore, versions, draft, name, position };
}

function values(setup: Awaited<ReturnType<typeof setupFixture>>) {
  return [
    {
      fieldId: setup.position.id,
      fieldKey: setup.position.key,
      fieldLabel: setup.position.label,
      valueType: setup.position.valueType,
      required: setup.position.required,
      binding: setup.position.binding,
      formatter: setup.position.formatter,
      technicalBinding: { kind: "docx.sdt", identifier: "aifield:position" },
      sampleValue: "Ведущий инженер",
      renderedValue: "Ведущий инженер",
      readBackValue: "Ведущий инженер",
      verification: { matched: true }
    },
    {
      fieldId: setup.name.id,
      fieldKey: setup.name.key,
      fieldLabel: setup.name.label,
      valueType: setup.name.valueType,
      required: setup.name.required,
      binding: setup.name.binding,
      formatter: setup.name.formatter,
      technicalBinding: { kind: "docx.sdt", identifier: "aifield:name" },
      sampleValue: "Иванов Иван Иванович",
      renderedValue: "Иванов Иван Иванович",
      readBackValue: "Иванов Иван Иванович",
      verification: { matched: true }
    }
  ] as const;
}

test("multi-field version stores ordered field rows, files, audit and event", async () => {
  const setup = await setupFixture();
  try {
    const input = {
      spaceId: DEFAULT_SPACE_ID,
      draftId: setup.draft.id,
      format: "docx" as const,
      compiledBuffer: Buffer.from("multi-compiled"),
      trialBuffer: Buffer.from("multi-trial"),
      fields: values(setup),
      verification: { matched: true, checkedFields: 2 }
    };
    const first = await setup.versions.recordTestedVersion(
      input,
      context("corr-version")
    );
    const duplicate = await setup.versions.recordTestedVersion(
      { ...input, fields: [...input.fields].reverse() },
      context("corr-version-repeat")
    );

    assert.equal(first.id, duplicate.id);
    assert.equal(first.fieldCount, 2);
    assert.deepEqual(
      first.fields.map((field) => field.fieldKey),
      ["recipient.full_name", "recipient.position"]
    );
    assert.deepEqual(first.sampleValues, {
      "recipient.full_name": "Иванов Иван Иванович",
      "recipient.position": "Ведущий инженер"
    });
    assert.deepEqual(first.fields[0]?.formatter, {
      version: 1,
      kind: "identity"
    });
    assert.equal(
      (await setup.objectStore.getBuffer(first.compiledSha256)).toString(),
      "multi-compiled"
    );
    assert.equal(setup.versions.listVersions(DEFAULT_SPACE_ID, setup.draft.id).length, 1);

    const eventCount = setup.fixture.store.execute((database) =>
      database
        .prepare(
          "SELECT COUNT(*) AS value FROM domain_events WHERE event_type = 'template.multi-test-version.created'"
        )
        .get()
    ) as { value: number };
    const auditCount = setup.fixture.store.execute((database) =>
      database
        .prepare(
          "SELECT COUNT(*) AS value FROM audit_log WHERE action = 'multi_field_trial_render'"
        )
        .get()
    ) as { value: number };
    assert.equal(Number(eventCount.value), 1);
    assert.equal(Number(auditCount.value), 1);
  } finally {
    setup.fixture.cleanup();
  }
});

test("multi-field version validates all fields and exact read-back values", async () => {
  const setup = await setupFixture();
  try {
    await assert.rejects(
      setup.versions.recordTestedVersion(
        {
          spaceId: DEFAULT_SPACE_ID,
          draftId: setup.draft.id,
          format: "docx",
          compiledBuffer: Buffer.from("compiled"),
          trialBuffer: Buffer.from("trial"),
          fields: [
            {
              ...values(setup)[0],
              readBackValue: "Другое значение"
            }
          ],
          verification: { matched: false }
        },
        context("corr-mismatch")
      ),
      MultiFieldTestVersionValidationError
    );

    await assert.rejects(
      setup.versions.recordTestedVersion(
        {
          spaceId: DEFAULT_SPACE_ID,
          draftId: setup.draft.id,
          format: "docx",
          compiledBuffer: Buffer.from("compiled"),
          trialBuffer: Buffer.from("trial"),
          fields: [
            {
              ...values(setup)[0],
              fieldKey: "changed.key"
            }
          ],
          verification: { matched: true }
        },
        context("corr-changed")
      ),
      /changed before multi-field testing/u
    );

    await assert.rejects(
      setup.versions.recordTestedVersion(
        {
          spaceId: DEFAULT_SPACE_ID,
          draftId: setup.draft.id,
          format: "docx",
          compiledBuffer: Buffer.from("compiled-formatter"),
          trialBuffer: Buffer.from("trial-formatter"),
          fields: [
            {
              ...values(setup)[0],
              formatter: { version: 1, kind: "legacy" }
            }
          ],
          verification: { matched: true }
        },
        context("corr-formatter-changed")
      ),
      /changed before multi-field testing/u
    );
  } finally {
    setup.fixture.cleanup();
  }
});

test("multi-field versions are immutable and hidden from another space", async () => {
  const setup = await setupFixture();
  try {
    const version = await setup.versions.recordTestedVersion(
      {
        spaceId: DEFAULT_SPACE_ID,
        draftId: setup.draft.id,
        format: "docx",
        compiledBuffer: Buffer.from("compiled"),
        trialBuffer: Buffer.from("trial"),
        fields: values(setup),
        verification: { matched: true }
      },
      context("corr-version")
    );
    const spaces = new SpaceRegistry(setup.fixture.store);
    const other = spaces.createSpace(
      { key: "other-multi", name: "Другое пространство" },
      context("corr-other")
    );
    assert.throws(
      () => setup.versions.getVersion(other.id, version.id),
      MultiFieldTestVersionNotFoundError
    );
    assert.throws(() =>
      setup.fixture.store.execute((database) =>
        database
          .prepare("UPDATE template_multi_test_versions SET field_count = 1 WHERE id = ?")
          .run(version.id)
      )
    );
  } finally {
    setup.fixture.cleanup();
  }
});
