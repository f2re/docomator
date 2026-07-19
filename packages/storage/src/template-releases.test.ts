import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { DocumentQuarantineRegistry } from "./document-quarantine.js";
import { DocumentScheduleRegistry } from "./document-schedules.js";
import { MultiFieldTestVersionRegistry } from "./multi-field-test-versions.js";
import { ContentAddressedObjectStore } from "./object-store.js";
import { DEFAULT_SPACE_ID, SpaceRegistry } from "./spaces.js";
import { TemplateDraftRegistry } from "./template-drafts.js";
import {
  TemplatePreviewConflictError,
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
      formatter: { version: 1, kind: "identity" },
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
      formatter: { version: 1, kind: "identity" },
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
          formatter: positionField.formatter,
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
          formatter: nameField.formatter,
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
    nameField,
    positionField,
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
      fields: Array<{ key: string; required: boolean; formatter: unknown }>;
    };
    assert.equal(manifest.version, 4);
    assert.equal(manifest.versionKind, "multi");
    assert.equal(manifest.fieldCount, 2);
    assert.deepEqual((multiRelease.manifest as { repeats: unknown[] }).repeats, []);
    assert.deepEqual(
      manifest.fields.map((field) => [field.key, field.required]),
      [
        ["recipient.full_name", true],
        ["recipient.position", true]
      ]
    );
    assert.deepEqual(manifest.fields[0]?.formatter, {
      version: 1,
      kind: "identity"
    });

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

test("XLSX _AI_META bindings use manifest v5 while legacy bindings stay on v4", async () => {
  const fixture = createMigratedTestStore();
  const objectStore = new ContentAddressedObjectStore(
    path.join(fixture.directory, "objects")
  );
  const quarantine = new DocumentQuarantineRegistry(fixture.store, objectStore);
  const drafts = new TemplateDraftRegistry(fixture.store);
  const versions = new TemplateTestVersionRegistry(fixture.store, objectStore);
  const multiVersions = new MultiFieldTestVersionRegistry(
    fixture.store,
    objectStore
  );
  const releases = new TemplateReleaseRegistry(fixture.store, objectStore);
  try {
    const source = await quarantine.saveAcceptedDocument(
      {
        spaceId: DEFAULT_SPACE_ID,
        fileName: "Реестр.xlsx",
        mediaType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        format: "xlsx",
        decision: "accepted",
        buffer: Buffer.from("verified-xlsx-source"),
        report: { decision: "accepted" }
      },
      context("corr-xlsx-source", 20)
    );
    const draft = drafts.createOrGetDraft(
      {
        spaceId: DEFAULT_SPACE_ID,
        sourceRecordId: source.id,
        title: "Реестр",
        format: "xlsx",
        sourceSha256: source.sha256,
        structureSha256: STRUCTURE_SHA,
        structure: {
          elements: [
            { id: "cell-b2", kind: "cell" },
            { id: "cell-c2", kind: "cell" }
          ]
        },
        structureTruncated: false
      },
      context("corr-xlsx-draft", 21)
    );
    const fieldBinding = {
      version: 1 as const,
      kind: "xlsx.cell" as const,
      elementId: "cell-b2",
      sheetName: "Реестр",
      sheetPath: "xl/worksheets/sheet1.xml",
      address: "B2"
    };
    const field = drafts.createField(
      DEFAULT_SPACE_ID,
      draft.id,
      {
        key: "person.full_name",
        label: "ФИО",
        valueType: "string",
        required: true,
        elementId: "cell-b2",
        elementKind: "cell",
        binding: fieldBinding,
        formatter: { version: 1, kind: "identity" },
        originalPreview: "ФИО",
        structureSha256: STRUCTURE_SHA
      },
      context("corr-xlsx-field", 22)
    );
    const record = (suffix: string, metadataVersion?: 1) =>
      versions.recordTestedVersion(
        {
          spaceId: DEFAULT_SPACE_ID,
          draftId: draft.id,
          fieldId: field.id,
          format: "xlsx",
          compiledBuffer: Buffer.from(`xlsx-compiled-${suffix}`),
          trialBuffer: Buffer.from(`xlsx-trial-${suffix}`),
          technicalBinding: {
            kind: "xlsx.defined-name",
            identifier: "_DOCOMATOR_FIELD_A",
            part: "xl/workbook.xml",
            target: "'Реестр'!$B$2",
            ...(metadataVersion === undefined ? {} : { metadataVersion })
          },
          sampleValue: suffix,
          renderedValue: suffix,
          readBackValue: suffix,
          verification: { matched: true }
        },
        context(`corr-xlsx-version-${suffix}`, suffix === "legacy" ? 23 : 27)
      );
    const activate = async (
      versionId: string,
      suffix: string,
      offset: number
    ) => {
      const request = releases.requestPreview(
        {
          spaceId: DEFAULT_SPACE_ID,
          versionId,
          versionKind: "single"
        },
        context(`corr-xlsx-preview-${suffix}`, offset)
      );
      const ready = await releases.completePreview(
        {
          requestId: request.request.id,
          previewBuffer: pdf(`xlsx-${suffix}`),
          converter: { converter: "LibreOffice", durationMs: 10 }
        },
        context(`corr-xlsx-ready-${suffix}`, offset + 1)
      );
      return releases.activateVersion(
        {
          spaceId: DEFAULT_SPACE_ID,
          previewRequestId: ready.id
        },
        context(`corr-xlsx-activate-${suffix}`, offset + 2)
      );
    };

    const legacyVersion = await record("legacy");
    const legacyRelease = await activate(legacyVersion.id, "legacy", 24);
    assert.equal((legacyRelease.manifest as { version: number }).version, 4);
    assert.equal(
      Object.hasOwn(legacyRelease.manifest as object, "xlsxMetadata"),
      false
    );

    const metadataVersion = await record("metadata", 1);
    const metadataRelease = await activate(metadataVersion.id, "metadata", 28);
    const manifest = metadataRelease.manifest as {
      version: number;
      xlsxMetadata: unknown;
      fields: Array<{ technicalBinding: unknown }>;
    };
    assert.equal(manifest.version, 5);
    assert.deepEqual(manifest.xlsxMetadata, {
      version: 1,
      sheetName: "_AI_META",
      visibility: "veryHidden"
    });
    assert.deepEqual(manifest.fields[0]?.technicalBinding, {
      kind: "xlsx.defined-name",
      identifier: "_DOCOMATOR_FIELD_A",
      part: "xl/workbook.xml",
      target: "'Реестр'!$B$2",
      metadataVersion: 1
    });

    const secondBinding = {
      version: 1 as const,
      kind: "xlsx.cell" as const,
      elementId: "cell-c2",
      sheetName: "Реестр",
      sheetPath: "xl/worksheets/sheet1.xml",
      address: "C2"
    };
    const secondField = drafts.createField(
      DEFAULT_SPACE_ID,
      draft.id,
      {
        key: "person.position",
        label: "Должность",
        valueType: "string",
        required: true,
        elementId: "cell-c2",
        elementKind: "cell",
        binding: secondBinding,
        formatter: { version: 1, kind: "identity" },
        originalPreview: "Должность",
        structureSha256: STRUCTURE_SHA
      },
      context("corr-xlsx-second-field", 31)
    );
    const mixedVersion = await multiVersions.recordTestedVersion(
      {
        spaceId: DEFAULT_SPACE_ID,
        draftId: draft.id,
        format: "xlsx",
        compiledBuffer: Buffer.from("xlsx-mixed-compiled"),
        trialBuffer: Buffer.from("xlsx-mixed-trial"),
        fields: [
          {
            fieldId: field.id,
            fieldKey: field.key,
            fieldLabel: field.label,
            valueType: field.valueType,
            required: field.required,
            binding: field.binding,
            formatter: field.formatter,
            technicalBinding: {
              kind: "xlsx.defined-name",
              identifier: "_DOCOMATOR_FIELD_A",
              part: "xl/workbook.xml",
              target: "'Реестр'!$B$2",
              metadataVersion: 1
            },
            sampleValue: "Иванов И.И.",
            renderedValue: "Иванов И.И.",
            readBackValue: "Иванов И.И.",
            verification: { matched: true }
          },
          {
            fieldId: secondField.id,
            fieldKey: secondField.key,
            fieldLabel: secondField.label,
            valueType: secondField.valueType,
            required: secondField.required,
            binding: secondField.binding,
            formatter: secondField.formatter,
            technicalBinding: {
              kind: "xlsx.defined-name",
              identifier: "_DOCOMATOR_FIELD_B",
              part: "xl/workbook.xml",
              target: "'Реестр'!$C$2"
            },
            sampleValue: "Инженер",
            renderedValue: "Инженер",
            readBackValue: "Инженер",
            verification: { matched: true }
          }
        ],
        verification: { matched: true }
      },
      context("corr-xlsx-mixed-version", 32)
    );
    const mixedRequest = releases.requestPreview(
      {
        spaceId: DEFAULT_SPACE_ID,
        versionId: mixedVersion.id,
        versionKind: "multi"
      },
      context("corr-xlsx-mixed-preview", 33)
    );
    const mixedReady = await releases.completePreview(
      {
        requestId: mixedRequest.request.id,
        previewBuffer: pdf("xlsx-mixed"),
        converter: { converter: "LibreOffice", durationMs: 10 }
      },
      context("corr-xlsx-mixed-ready", 34)
    );
    assert.throws(
      () =>
        releases.activateVersion(
          {
            spaceId: DEFAULT_SPACE_ID,
            previewRequestId: mixedReady.id
          },
          context("corr-xlsx-mixed-activate", 35)
        ),
      (error: unknown) =>
        error instanceof TemplatePreviewConflictError &&
        /смешивает прежние и новые/u.test(error.message)
    );
  } finally {
    fixture.cleanup();
  }
});

test("formatter contracts stay immutable and constrained across release rows", async () => {
  const setup = await setupFixture();
  try {
    const stored = setup.fixture.store.execute((database) =>
      database
        .prepare(`
          SELECT formatter_json
          FROM template_release_candidate_fields
          WHERE candidate_id = ?
          ORDER BY ordinal
        `)
        .all(setup.multi.id)
    ) as Array<{ formatter_json: string }>;
    assert.equal(stored.length, 2);
    assert.deepEqual(
      stored.map((row) => JSON.parse(row.formatter_json)),
      [
        { version: 1, kind: "identity" },
        { version: 1, kind: "identity" }
      ]
    );

    assert.throws(() =>
      setup.fixture.store.execute((database) =>
        database
          .prepare("UPDATE template_draft_fields SET formatter_json = '[]' WHERE id = ?")
          .run(setup.nameField.id)
      )
    );
    assert.throws(() =>
      setup.fixture.store.execute((database) =>
        database
          .prepare(
            "UPDATE template_release_candidate_fields SET formatter_json = ? WHERE candidate_id = ?"
          )
          .run('{"version":1,"kind":"legacy"}', setup.multi.id)
      )
    );

    const checks = setup.fixture.store.execute((database) => ({
      integrity: database.prepare("PRAGMA integrity_check").get() as {
        integrity_check: string;
      },
      foreignKeys: database.prepare("PRAGMA foreign_key_check").all()
    }));
    assert.equal(checks.integrity.integrity_check, "ok");
    assert.deepEqual(checks.foreignKeys, []);
  } finally {
    setup.fixture.cleanup();
  }
});

test("document schedules generate opaque keys when omitted and keep explicit keys", async () => {
  const setup = await setupFixture();
  try {
    const request = setup.releases.requestPreview(
      {
        spaceId: DEFAULT_SPACE_ID,
        versionId: setup.single.id,
        versionKind: "single"
      },
      context("corr-schedule-preview", 3)
    );
    const ready = await setup.releases.completePreview(
      {
        requestId: request.request.id,
        previewBuffer: pdf("schedule"),
        converter: { converter: "LibreOffice", durationMs: 10 }
      },
      context("corr-schedule-ready", 4)
    );
    const release = setup.releases.activateVersion(
      {
        spaceId: DEFAULT_SPACE_ID,
        previewRequestId: ready.id
      },
      context("corr-schedule-release", 5)
    );
    const spaces = new SpaceRegistry(setup.fixture.store);
    const group = spaces.createGroup(
      DEFAULT_SPACE_ID,
      { key: "schedule-group", name: "Группа для расписания" },
      context("corr-schedule-group", 6)
    );
    const keys = [
      "document_schedule.collision",
      "document_schedule.generated"
    ];
    const schedules = new DocumentScheduleRegistry(setup.fixture.store, {
      keyFactory: () => keys.shift() ?? "document_schedule.unexpected"
    });
    const common = {
      activeReleaseId: release.id,
      groupId: group.id,
      targetMode: "aggregate",
      recurrenceKind: "once",
      timezone: "Europe/Moscow",
      localTime: "12:00",
      startDate: "2026-07-16",
      deliveryChannel: "none"
    } as const;
    const explicit = schedules.create(
      DEFAULT_SPACE_ID,
      { ...common, key: "document_schedule.collision", name: "Явное расписание" },
      context("corr-schedule-explicit", 7)
    );
    assert.equal(explicit.key, "document_schedule.collision");

    const generated = schedules.create(
      DEFAULT_SPACE_ID,
      { ...common, name: "Расписание без ключа" },
      context("corr-schedule-generated", 8)
    );
    assert.equal(generated.key, "document_schedule.generated");

    const legacy = schedules.create(
      DEFAULT_SPACE_ID,
      { ...common, key: "legacy-schedule", name: "Совместимое расписание" },
      context("corr-schedule-legacy", 9)
    );
    assert.equal(legacy.key, "legacy-schedule");
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
