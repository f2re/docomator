import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

async function setupFixture(options: { repeat?: boolean } = {}) {
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
      ...(options.repeat
        ? {
            repeatBinding: {
              version: 1,
              kind: "docx.repeat-row",
              source: "audience.members",
              anchorElementId: "p1",
              part: "word/document.xml",
              tableIndex: 0,
              rowIndex: 1
            }
          }
        : {}),
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
  return {
    fixture,
    objectStore,
    versions,
    draft: drafts.getDraft(DEFAULT_SPACE_ID, draft.id),
    name,
    position
  };
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

function repeatTechnicalIdentifier(binding: {
  part: string;
  tableIndex: number;
  rowIndex: number;
}): string {
  return `airepeat:${createHash("sha256")
    .update(binding.part)
    .update("\u0000")
    .update(String(binding.tableIndex))
    .update("\u0000")
    .update(String(binding.rowIndex))
    .update("\u0000")
    .update("audience.members")
    .digest("hex")
    .slice(0, 24)}`;
}

function xlsxRepeatTechnicalIdentifier(binding: {
  sheetPath: string;
  rowNumber: number;
  startAddress: string;
  endAddress: string;
}): string {
  return `_DOCOMATOR_REPEAT_${createHash("sha256")
    .update(binding.sheetPath)
    .update("\u0000")
    .update(String(binding.rowNumber))
    .update("\u0000")
    .update(binding.startAddress)
    .update("\u0000")
    .update(binding.endAddress)
    .update("\u0000")
    .update("audience.members")
    .digest("hex")
    .slice(0, 24)
    .toUpperCase()}`;
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

test("repeat contract is frozen in multi-field version and release candidate", async () => {
  const setup = await setupFixture({ repeat: true });
  try {
    assert.ok(setup.draft.repeatBinding);
    assert.equal(typeof setup.draft.repeatBinding, "object");
    const binding = setup.draft.repeatBinding as {
      part: string;
      tableIndex: number;
      rowIndex: number;
    };
    const repeatContract = {
      version: 1,
      kind: "docx.repeat-row-contract",
      binding: setup.draft.repeatBinding,
      technicalBinding: {
        kind: "docx.repeat-sdt",
        identifier: repeatTechnicalIdentifier(binding),
        part: "word/document.xml",
        target: "таблица 1, строка 2"
      }
    };
    const otherBinding = {
      version: 1 as const,
      kind: "docx.repeat-row" as const,
      source: "audience.members" as const,
      anchorElementId: "p1",
      part: "word/document.xml",
      tableIndex: 0,
      rowIndex: 2
    };
    const version = await setup.versions.recordTestedVersion(
      {
        spaceId: DEFAULT_SPACE_ID,
        draftId: setup.draft.id,
        format: "docx",
        compiledBuffer: Buffer.from("repeat-compiled"),
        trialBuffer: Buffer.from("repeat-trial"),
        fields: values(setup),
        repeatContract,
        verification: { matched: true }
      },
      context("corr-repeat-version")
    );
    assert.deepEqual(version.repeatContract, repeatContract);
    const candidate = setup.fixture.store.execute((database) =>
      database
        .prepare(
          "SELECT repeat_contract_json FROM template_release_candidates WHERE id = ?"
        )
        .get(version.id)
    ) as { repeat_contract_json: string };
    assert.deepEqual(JSON.parse(candidate.repeat_contract_json), repeatContract);

    await assert.rejects(
      setup.versions.recordTestedVersion(
        {
          spaceId: DEFAULT_SPACE_ID,
          draftId: setup.draft.id,
          format: "docx",
          compiledBuffer: Buffer.from("repeat-compiled-mismatch"),
          trialBuffer: Buffer.from("repeat-trial-mismatch"),
          fields: values(setup),
          repeatContract: {
            ...repeatContract,
            binding: otherBinding,
            technicalBinding: {
              ...repeatContract.technicalBinding,
              identifier: repeatTechnicalIdentifier(otherBinding)
            }
          },
          verification: { matched: true }
        },
        context("corr-repeat-mismatch")
      ),
      /does not match/u
    );
    await assert.rejects(
      setup.versions.recordTestedVersion(
        {
          spaceId: DEFAULT_SPACE_ID,
          draftId: setup.draft.id,
          format: "docx",
          compiledBuffer: Buffer.from("repeat-compiled-forged"),
          trialBuffer: Buffer.from("repeat-trial-forged"),
          fields: values(setup),
          repeatContract: {
            ...repeatContract,
            technicalBinding: {
              ...repeatContract.technicalBinding,
              identifier: "airepeat:0123456789abcdef01234567"
            }
          },
          verification: { matched: true }
        },
        context("corr-repeat-forged")
      ),
      /supported DOCX repeat row contract/u
    );
  } finally {
    setup.fixture.cleanup();
  }
});

test("XLSX repeat contract is validated and frozen with its draft", async () => {
  const fixture = createMigratedTestStore();
  const objectStore = new ContentAddressedObjectStore(
    path.join(fixture.directory, "objects")
  );
  const quarantine = new DocumentQuarantineRegistry(fixture.store, objectStore);
  const drafts = new TemplateDraftRegistry(fixture.store);
  const versions = new MultiFieldTestVersionRegistry(fixture.store, objectStore);
  try {
    const source = await quarantine.saveAcceptedDocument(
      {
        spaceId: DEFAULT_SPACE_ID,
        fileName: "Сотрудники.xlsx",
        mediaType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        format: "xlsx",
        decision: "accepted",
        buffer: Buffer.from("verified-xlsx-source"),
        report: { decision: "accepted" }
      },
      context("corr-xlsx-source")
    );
    const draft = drafts.createOrGetDraft(
      {
        spaceId: DEFAULT_SPACE_ID,
        sourceRecordId: source.id,
        title: "Сотрудники",
        format: "xlsx",
        sourceSha256: source.sha256,
        structureSha256: STRUCTURE_SHA,
        structure: { elements: [{ id: "cell-b2" }, { id: "cell-c2" }] },
        structureTruncated: false
      },
      context("corr-xlsx-draft")
    );
    const repeatBinding = {
      version: 1 as const,
      kind: "xlsx.repeat-row" as const,
      source: "audience.members" as const,
      selection: "used-row" as const,
      sheetName: "Сотрудники",
      sheetPath: "xl/worksheets/sheet1.xml",
      rowNumber: 2,
      startAddress: "B2",
      endAddress: "C2",
      startElementId: "cell-b2",
      endElementId: "cell-c2"
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
        binding: {
          version: 1,
          kind: "xlsx.cell",
          elementId: "cell-b2",
          sheetName: "Сотрудники",
          sheetPath: "xl/worksheets/sheet1.xml",
          address: "B2"
        },
        formatter: { version: 1, kind: "identity" },
        repeatBinding,
        originalPreview: "ФИО",
        structureSha256: STRUCTURE_SHA
      },
      context("corr-xlsx-field")
    );
    const repeatContract = {
      version: 1 as const,
      kind: "xlsx.repeat-row-contract" as const,
      binding: repeatBinding,
      technicalBinding: {
        kind: "xlsx.repeat-defined-name" as const,
        identifier: xlsxRepeatTechnicalIdentifier(repeatBinding),
        part: "xl/workbook.xml" as const,
        target: "'Сотрудники'!$B$2:$C$2"
      }
    };
    const record = () =>
      versions.recordTestedVersion(
        {
          spaceId: DEFAULT_SPACE_ID,
          draftId: draft.id,
          format: "xlsx",
          compiledBuffer: Buffer.from("xlsx-repeat-compiled"),
          trialBuffer: Buffer.from("xlsx-repeat-trial"),
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
                identifier: "_DOCOMATOR_FIELD"
              },
              sampleValue: "Иванов И.И.",
              renderedValue: "Иванов И.И.",
              readBackValue: "Иванов И.И.",
              verification: { matched: true }
            }
          ],
          repeatContract,
          verification: { matched: true }
        },
        context("corr-xlsx-version")
      );
    const version = await record();
    assert.deepEqual(version.repeatContract, repeatContract);

    assert.throws(
      () =>
        fixture.store.execute((database) =>
          database
            .prepare(`
              INSERT INTO template_multi_test_versions(
                id, space_id, draft_id, version_number, format,
                compiled_file_id, trial_file_id, compiled_sha256, trial_sha256,
                sample_values_json, verification_json, field_count, status,
                repeat_contract_json, created_by, correlation_id, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `)
            .run(
              "xlsx-repeat-sql-forged",
              DEFAULT_SPACE_ID,
              draft.id,
              version.versionNumber + 1,
              "xlsx",
              version.compiledFileId,
              version.trialFileId,
              "a".repeat(64),
              "b".repeat(64),
              '{"person.full_name":"SQL"}',
              '{"matched":true}',
              1,
              "tested",
              JSON.stringify({
                ...repeatContract,
                kind: "docx.repeat-row-contract"
              }),
              "migration-test",
              "corr-xlsx-sql-forged",
              NOW
            )
        ),
      /multi-field test version must match its draft and repeat binding/u
    );

    await assert.rejects(
      versions.recordTestedVersion(
        {
          spaceId: DEFAULT_SPACE_ID,
          draftId: draft.id,
          format: "xlsx",
          compiledBuffer: Buffer.from("xlsx-repeat-forged"),
          trialBuffer: Buffer.from("xlsx-repeat-forged-trial"),
          fields: [
            {
              fieldId: field.id,
              fieldKey: field.key,
              fieldLabel: field.label,
              valueType: field.valueType,
              required: field.required,
              binding: field.binding,
              formatter: field.formatter,
              technicalBinding: { kind: "xlsx.defined-name" },
              sampleValue: "Петров П.П.",
              renderedValue: "Петров П.П.",
              readBackValue: "Петров П.П.",
              verification: { matched: true }
            }
          ],
          repeatContract: {
            ...repeatContract,
            technicalBinding: {
              ...repeatContract.technicalBinding,
              target: "'Сотрудники'!$B$2:$D$2"
            }
          },
          verification: { matched: true }
        },
        context("corr-xlsx-forged")
      ),
      /supported XLSX repeat row contract/u
    );
  } finally {
    fixture.cleanup();
  }
});
