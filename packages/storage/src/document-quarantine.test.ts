import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  DocumentQuarantineNotFoundError,
  DocumentQuarantineRegistry,
  DocumentQuarantineValidationError
} from "./document-quarantine.js";
import { ContentAddressedObjectStore } from "./object-store.js";
import { DEFAULT_SPACE_ID, SpaceRegistry } from "./spaces.js";
import { createMigratedTestStore } from "./test-helpers.js";

const T0 = "2026-07-12T12:50:00.000Z";

function context(correlationId: string, actorId = "template-editor-1") {
  return {
    correlationId,
    actorType: "test",
    actorId,
    now: T0
  };
}

function acceptedInput(buffer = Buffer.from("checked DOCX bytes")) {
  return {
    spaceId: DEFAULT_SPACE_ID,
    fileName: "Проверенный шаблон.docx",
    mediaType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    format: "docx" as const,
    decision: "accepted" as const,
    buffer,
    report: {
      decision: "accepted",
      summary: { fileCount: 3, externalRelationships: 0 }
    }
  };
}

test("accepted source is stored immutably with audit and outbox", async () => {
  const fixture = createMigratedTestStore();
  try {
    const objectStore = new ContentAddressedObjectStore(
      path.join(fixture.directory, "objects")
    );
    const registry = new DocumentQuarantineRegistry(fixture.store, objectStore);

    const first = await registry.saveAcceptedDocument(
      acceptedInput(),
      context("corr-quarantine-first")
    );
    const second = await registry.saveAcceptedDocument(
      acceptedInput(),
      context("corr-quarantine-second")
    );

    assert.equal(second.id, first.id);
    assert.equal(first.spaceId, DEFAULT_SPACE_ID);
    assert.equal(first.fileName, "Проверенный шаблон.docx");
    assert.equal(first.decision, "accepted");
    assert.equal(first.sha256.length, 64);
    assert.equal(first.createdBy, "template-editor-1");
    assert.equal(first.correlationId, "corr-quarantine-first");
    assert.equal(
      fs.existsSync(path.join(fixture.directory, "objects", first.storagePath)),
      true
    );
    assert.deepEqual(
      registry.listDocuments(DEFAULT_SPACE_ID).map((record) => record.id),
      [first.id]
    );
    assert.equal(registry.getDocument(DEFAULT_SPACE_ID, first.id).sha256, first.sha256);

    const counts = fixture.store.execute((connection) => ({
      files: Number(
        (connection.prepare("SELECT COUNT(*) AS value FROM files").get() as {
          value: number;
        }).value
      ),
      events: Number(
        (
          connection
            .prepare(
              "SELECT COUNT(*) AS value FROM domain_events WHERE event_type = 'document.quarantined'"
            )
            .get() as { value: number }
        ).value
      ),
      audit: Number(
        (
          connection
            .prepare(
              "SELECT COUNT(*) AS value FROM audit_log WHERE object_type = 'document_source'"
            )
            .get() as { value: number }
        ).value
      )
    }));
    assert.deepEqual(counts, { files: 1, events: 1, audit: 1 });

    assert.throws(
      () =>
        fixture.store.execute((connection) => {
          connection
            .prepare("UPDATE document_quarantine_records SET decision = 'accepted' WHERE id = ?")
            .run(first.id);
        }),
      /immutable/u
    );
  } finally {
    fixture.cleanup();
  }
});

test("quarantine records remain isolated by space", async () => {
  const fixture = createMigratedTestStore();
  try {
    const objectStore = new ContentAddressedObjectStore(
      path.join(fixture.directory, "objects")
    );
    const registry = new DocumentQuarantineRegistry(fixture.store, objectStore);
    const spaces = new SpaceRegistry(fixture.store);
    const otherSpace = spaces.createSpace(
      { key: "other", name: "Другое пространство" },
      context("corr-other-space")
    );

    const defaultRecord = await registry.saveAcceptedDocument(
      acceptedInput(),
      context("corr-default-document")
    );
    const otherRecord = await registry.saveAcceptedDocument(
      { ...acceptedInput(), spaceId: otherSpace.id },
      context("corr-other-document")
    );

    assert.notEqual(defaultRecord.id, otherRecord.id);
    assert.equal(defaultRecord.fileId, otherRecord.fileId);
    assert.equal(registry.listDocuments(DEFAULT_SPACE_ID).length, 1);
    assert.equal(registry.listDocuments(otherSpace.id).length, 1);
    assert.throws(
      () => registry.getDocument(otherSpace.id, defaultRecord.id),
      DocumentQuarantineNotFoundError
    );
  } finally {
    fixture.cleanup();
  }
});

test("rejected or checksum-changed documents cannot be quarantined", async () => {
  const fixture = createMigratedTestStore();
  try {
    const registry = new DocumentQuarantineRegistry(
      fixture.store,
      new ContentAddressedObjectStore(path.join(fixture.directory, "objects"))
    );

    await assert.rejects(
      registry.saveAcceptedDocument(
        { ...acceptedInput(), decision: "rejected" as never },
        context("corr-rejected")
      ),
      DocumentQuarantineValidationError
    );
    await assert.rejects(
      registry.saveAcceptedDocument(
        { ...acceptedInput(), expectedSha256: "0".repeat(64) },
        context("corr-changed")
      ),
      (error: unknown) =>
        error instanceof DocumentQuarantineValidationError &&
        /checksum changed/u.test(error.message)
    );

    assert.equal(registry.listDocuments(DEFAULT_SPACE_ID).length, 0);
  } finally {
    fixture.cleanup();
  }
});
