import assert from "node:assert/strict";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import type { WorkerConfig } from "@docomator/config";
import {
  ContentAddressedObjectStore,
  DEFAULT_SPACE_ID,
  DocumentQuarantineRegistry,
  SqliteStore,
  TemplateDraftRegistry,
  TemplatePreviewActivationRegistry,
  TemplateTestVersionRegistry,
  WorkerQueue
} from "@docomator/storage";

import {
  LibreOfficePreviewError,
  type LibreOfficePreviewResult
} from "./libreoffice-preview.js";
import { JobHandlerRegistry, processNextJob } from "./processor.js";
import { createTemplatePreviewHandler } from "./template-preview-handler.js";

const NOW = "2026-07-12T23:00:00.000Z";
const STRUCTURE_SHA = "c".repeat(64);

function applyMigrations(dataDir: string): void {
  const database = new DatabaseSync(path.join(dataDir, "docomator.db"));
  database.exec("PRAGMA foreign_keys = ON;");
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDirectory = path.resolve(currentDirectory, "../../../migrations");
  for (const migration of fs
    .readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort()) {
    database.exec(fs.readFileSync(path.join(migrationsDirectory, migration), "utf8"));
  }
  database.close();
}

function context(correlationId: string, offsetSeconds = 0) {
  return {
    correlationId,
    actorType: "test",
    actorId: "editor-1",
    now: new Date(Date.parse(NOW) + offsetSeconds * 1_000).toISOString()
  };
}

async function fixture() {
  const dataDir = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "docomator-preview-handler-")
  );
  applyMigrations(dataDir);
  const store = new SqliteStore({ databasePath: path.join(dataDir, "docomator.db") });
  const objectStore = new ContentAddressedObjectStore(path.join(dataDir, "objects"));
  const queue = new WorkerQueue(store);
  const quarantine = new DocumentQuarantineRegistry(store, objectStore);
  const drafts = new TemplateDraftRegistry(store);
  const testedVersions = new TemplateTestVersionRegistry(store, objectStore);
  const previews = new TemplatePreviewActivationRegistry(store, objectStore, {
    queue
  });

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
      technicalBinding: { kind: "docx.sdt", identifier: `aifield:${field.id}` },
      sampleValue: "Иванов",
      renderedValue: "Иванов",
      readBackValue: "Иванов",
      verification: { matched: true }
    },
    context("corr-tested")
  );
  const requested = previews.requestPreview(
    { spaceId: DEFAULT_SPACE_ID, testVersionId: tested.id },
    context("corr-preview")
  );

  const config: Pick<
    WorkerConfig,
    | "dataDir"
    | "workerId"
    | "previewEnabled"
    | "libreOfficeBinary"
    | "previewTimeoutMs"
    | "previewMaxOutputBytes"
  > = {
    dataDir,
    workerId: "worker-preview-test",
    previewEnabled: true,
    libreOfficeBinary: "/usr/bin/libreoffice",
    previewTimeoutMs: 30_000,
    previewMaxOutputBytes: 1024 * 1024
  };

  return {
    dataDir,
    store,
    objectStore,
    queue,
    previews,
    tested,
    request: requested.request,
    config,
    async cleanup() {
      store.close();
      await fsPromises.rm(dataDir, { recursive: true, force: true });
    }
  };
}

function successfulConversion(): LibreOfficePreviewResult {
  const pdf = Buffer.from("%PDF-1.4\n% preview\n%%EOF\n");
  return {
    pdf,
    metadata: {
      converter: "LibreOffice",
      binaryName: "libreoffice",
      exitCode: 0,
      durationMs: 25,
      outputBytes: pdf.byteLength,
      stdout: "",
      stderr: ""
    }
  };
}

test("worker completes preview, stores PDF and completes the queue job", async () => {
  const setup = await fixture();
  try {
    const handlers = new JobHandlerRegistry();
    handlers.register(
      "template.preview",
      createTemplatePreviewHandler({
        registry: setup.previews,
        objectStore: setup.objectStore,
        config: setup.config,
        convert: async (options) => {
          assert.equal(Buffer.from(options.input).toString(), "trial-template");
          assert.equal(options.format, "docx");
          assert.match(options.temporaryRoot, /tmp\/previews$/u);
          return successfulConversion();
        },
        now: () => new Date(NOW)
      })
    );

    const result = await processNextJob({
      queue: setup.queue,
      handlers,
      workerId: setup.config.workerId,
      leaseDurationMs: 60_000,
      retryBaseMs: 100,
      retryMaxMs: 1_000,
      signal: new AbortController().signal,
      now: () => new Date(NOW)
    });
    assert.equal(result.status, "completed");

    const preview = setup.previews.getPreview(
      DEFAULT_SPACE_ID,
      setup.request.id
    );
    assert.equal(preview.state, "ready");
    assert.equal(preview.workerJobState, "completed");
    assert.ok(preview.previewSha256);
    assert.equal(
      (await setup.objectStore.getBuffer(preview.previewSha256))
        .subarray(0, 5)
        .toString(),
      "%PDF-"
    );
  } finally {
    await setup.cleanup();
  }
});

test("worker records a Russian failure and dead-letters a permanent conversion error", async () => {
  const setup = await fixture();
  try {
    const handlers = new JobHandlerRegistry();
    handlers.register(
      "template.preview",
      createTemplatePreviewHandler({
        registry: setup.previews,
        objectStore: setup.objectStore,
        config: setup.config,
        convert: async () => {
          throw new LibreOfficePreviewError(
            "preview_conversion_failed",
            "LibreOffice не смог создать PDF. Проверьте документ и повторите действие.",
            "fake conversion failed"
          );
        },
        now: () => new Date(NOW)
      })
    );

    const result = await processNextJob({
      queue: setup.queue,
      handlers,
      workerId: setup.config.workerId,
      leaseDurationMs: 60_000,
      retryBaseMs: 100,
      retryMaxMs: 1_000,
      signal: new AbortController().signal,
      now: () => new Date(NOW)
    });
    assert.equal(result.status, "dead_letter");

    const preview = setup.previews.getPreview(
      DEFAULT_SPACE_ID,
      setup.request.id
    );
    assert.equal(preview.state, "failed");
    assert.equal(preview.workerJobState, "dead_letter");
    assert.deepEqual(preview.error, {
      code: "preview_conversion_failed",
      message: "LibreOffice не смог создать PDF. Проверьте документ и повторите действие."
    });
  } finally {
    await setup.cleanup();
  }
});

test("disabled preview is persisted as a recoverable user-facing failure", async () => {
  const setup = await fixture();
  try {
    const handlers = new JobHandlerRegistry();
    handlers.register(
      "template.preview",
      createTemplatePreviewHandler({
        registry: setup.previews,
        objectStore: setup.objectStore,
        config: { ...setup.config, previewEnabled: false },
        now: () => new Date(NOW)
      })
    );
    const result = await processNextJob({
      queue: setup.queue,
      handlers,
      workerId: setup.config.workerId,
      leaseDurationMs: 60_000,
      retryBaseMs: 100,
      retryMaxMs: 1_000,
      signal: new AbortController().signal,
      now: () => new Date(NOW)
    });
    assert.equal(result.status, "dead_letter");
    const preview = setup.previews.getPreview(
      DEFAULT_SPACE_ID,
      setup.request.id
    );
    assert.equal(preview.state, "failed");
    assert.deepEqual(preview.error, {
      code: "preview_disabled",
      message: "Предварительный просмотр отключён администратором."
    });
  } finally {
    await setup.cleanup();
  }
});
