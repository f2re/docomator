import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  DataExtractionConflictError,
  DataExtractionNotFoundError,
  DataExtractionRegistry
} from "./data-extraction.js";
import { DocumentQuarantineRegistry } from "./document-quarantine.js";
import { ContentAddressedObjectStore } from "./object-store.js";
import { DEFAULT_SPACE_ID, SpaceRegistry } from "./spaces.js";
import { createMigratedTestStore } from "./test-helpers.js";

const T0 = "2026-08-24T10:00:00.000Z";

function context(correlationId: string, now = T0) {
  return {
    correlationId,
    actorType: "test",
    actorId: "operator-1",
    now
  };
}

function sourceInput(spaceId: string, name = "Акт.docx", body = "source") {
  return {
    spaceId,
    fileName: name,
    mediaType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    format: "docx" as const,
    decision: "accepted" as const,
    buffer: Buffer.from(body),
    report: { decision: "accepted" }
  };
}

const definition = {
  version: 1,
  format: "docx",
  fields: [
    {
      id: "field-1",
      label: "Номер",
      outputType: "text",
      selector: { kind: "docx.paragraph", part: "word/document.xml", index: 0 }
    }
  ],
  repeat: null
};

const result = {
  version: 1,
  fields: [
    {
      fieldId: "field-1",
      label: "Номер",
      value: "42",
      source: "word/document.xml#p1"
    }
  ],
  repeat: null
};

test("extraction templates, runs and corrections are space isolated and recoverable", async () => {
  const fixture = createMigratedTestStore();
  try {
    const objectStore = new ContentAddressedObjectStore(path.join(fixture.directory, "objects"));
    const quarantine = new DocumentQuarantineRegistry(fixture.store, objectStore);
    const spaces = new SpaceRegistry(fixture.store);
    const extraction = new DataExtractionRegistry(fixture.store);
    const other = spaces.createSpace(
      { key: "extract-other", name: "Другой отдел" },
      context("corr-space")
    );

    const sourceA = await quarantine.saveAcceptedDocument(
      sourceInput(DEFAULT_SPACE_ID, "Одинаковое имя.docx", "same bytes"),
      context("corr-source-a")
    );
    const sourceB = await quarantine.saveAcceptedDocument(
      sourceInput(other.id, "Одинаковое имя.docx", "same bytes"),
      context("corr-source-b")
    );
    assert.equal(sourceA.fileId, sourceB.fileId);

    const template = extraction.createTemplate(
      {
        spaceId: DEFAULT_SPACE_ID,
        title: "Извлечь номер",
        format: "docx",
        sampleSourceRecordId: sourceA.id,
        sampleSha256: sourceA.sha256,
        structureSha256: "a".repeat(64),
        definition
      },
      context("corr-template")
    );

    assert.equal(extraction.listTemplates(DEFAULT_SPACE_ID).length, 1);
    assert.equal(extraction.listTemplates(other.id).length, 0);
    assert.throws(
      () => extraction.getTemplate(other.id, template.id),
      DataExtractionNotFoundError
    );
    assert.throws(
      () =>
        extraction.createTemplate(
          {
            spaceId: DEFAULT_SPACE_ID,
            title: "Чужой исходник",
            format: "docx",
            sampleSourceRecordId: sourceB.id,
            sampleSha256: sourceB.sha256,
            structureSha256: "b".repeat(64),
            definition
          },
          context("corr-cross-template")
        ),
      DataExtractionNotFoundError
    );

    const first = extraction.createOrGetRun(
      {
        spaceId: DEFAULT_SPACE_ID,
        templateId: template.id,
        idempotencyKey: "run-key-1",
        templateSnapshot: definition,
        items: [
          {
            sourceRecordId: sourceA.id,
            sourceName: sourceA.fileName,
            sourceSha256: sourceA.sha256,
            result,
            issues: []
          }
        ]
      },
      context("corr-run")
    );
    const retried = extraction.createOrGetRun(
      {
        spaceId: DEFAULT_SPACE_ID,
        templateId: template.id,
        idempotencyKey: "run-key-1",
        templateSnapshot: definition,
        items: [
          {
            sourceRecordId: sourceA.id,
            sourceName: sourceA.fileName,
            sourceSha256: sourceA.sha256,
            result,
            issues: []
          }
        ]
      },
      context("corr-run-retry")
    );
    assert.equal(retried.id, first.id);
    assert.equal(first.items[0]?.sourceName, "Одинаковое имя.docx");

    assert.throws(
      () =>
        extraction.createOrGetRun(
          {
            spaceId: DEFAULT_SPACE_ID,
            templateId: template.id,
            idempotencyKey: "run-key-1",
            templateSnapshot: { ...definition, fields: [] },
            items: [
              {
                sourceRecordId: sourceA.id,
                sourceName: sourceA.fileName,
                sourceSha256: sourceA.sha256,
                result,
                issues: []
              }
            ]
          },
          context("corr-run-conflict")
        ),
      DataExtractionConflictError
    );

    const item = first.items[0]!;
    const corrected = extraction.replaceItemCorrections(
      DEFAULT_SPACE_ID,
      first.id,
      item.id,
      { fields: { "field-1": "43" }, repeat: {} },
      item.version,
      context("corr-correction", "2026-08-24T10:01:00.000Z")
    );
    assert.equal(corrected.version, 2);
    assert.deepEqual(corrected.corrections, {
      fields: { "field-1": "43" },
      repeat: {}
    });
    assert.throws(
      () =>
        extraction.replaceItemCorrections(
          DEFAULT_SPACE_ID,
          first.id,
          item.id,
          { fields: { "field-1": "44" } },
          1,
          context("corr-stale", "2026-08-24T10:02:00.000Z")
        ),
      DataExtractionConflictError
    );
    assert.throws(
      () => extraction.getRun(other.id, first.id),
      DataExtractionNotFoundError
    );

    assert.throws(
      () =>
        fixture.store.execute((connection) => {
          connection
            .prepare(`
              INSERT INTO data_extraction_items(
                id, run_id, space_id, position, source_record_id, source_name,
                source_sha256, result_json, issues_json, corrections_json,
                version, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', 1, ?, ?)
            `)
            .run(
              "cross-space-item",
              first.id,
              DEFAULT_SPACE_ID,
              99,
              sourceB.id,
              sourceB.fileName,
              sourceB.sha256,
              JSON.stringify(result),
              "[]",
              T0,
              T0
            );
        }),
      /space boundary/u
    );
  } finally {
    fixture.cleanup();
  }
});
