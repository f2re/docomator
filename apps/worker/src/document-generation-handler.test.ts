import assert from "node:assert/strict";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import {
  ContentAddressedObjectStore,
  DEFAULT_SPACE_ID,
  DocumentGenerationRegistry,
  DocumentQuarantineRegistry,
  SpaceRegistry,
  SqliteStore,
  TemplateDraftRegistry,
  TemplateReleaseRegistry,
  TemplateTestVersionRegistry,
  WorkerQueue
} from "@docomator/storage";
import { readOoxmlPackage } from "@docomator/template-compiler";

import { createDocumentGenerationHandler } from "./document-generation-handler.js";
import { JobHandlerRegistry, processNextJob } from "./processor.js";

const BASE_TIME = Date.parse("2026-07-16T08:00:00.000Z");
const STRUCTURE_SHA = "d".repeat(64);

function at(offsetMilliseconds: number): Date {
  return new Date(BASE_TIME + offsetMilliseconds);
}

function context(correlationId: string, offsetMilliseconds = 0) {
  return {
    correlationId,
    actorType: "test",
    actorId: "operator-1",
    now: at(offsetMilliseconds).toISOString()
  };
}

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

async function fixture() {
  const dataDir = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "docomator-generation-handler-")
  );
  applyMigrations(dataDir);
  const store = new SqliteStore({ databasePath: path.join(dataDir, "docomator.db") });
  const objectStore = new ContentAddressedObjectStore(path.join(dataDir, "objects"));
  const queue = new WorkerQueue(store);
  const quarantine = new DocumentQuarantineRegistry(store, objectStore);
  const drafts = new TemplateDraftRegistry(store);
  const testedVersions = new TemplateTestVersionRegistry(store, objectStore);
  const releases = new TemplateReleaseRegistry(store, objectStore, { queue });
  const spaces = new SpaceRegistry(store);

  const source = await quarantine.saveAcceptedDocument(
    {
      spaceId: DEFAULT_SPACE_ID,
      fileName: "Список участников.docx",
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
      title: "Список участников",
      format: "docx",
      sourceSha256: source.sha256,
      structureSha256: STRUCTURE_SHA,
      structure: { elements: [{ id: "paragraph-1", kind: "paragraph" }] },
      structureTruncated: false
    },
    context("corr-draft", 1)
  );
  const field = drafts.createField(
    DEFAULT_SPACE_ID,
    draft.id,
    {
      key: "recipient.full_name",
      label: "ФИО участника",
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
      originalPreview: "ФИО участника",
      structureSha256: STRUCTURE_SHA
    },
    context("corr-field", 2)
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
        part: "word/document.xml"
      },
      sampleValue: "Иванов Иван",
      renderedValue: "Иванов Иван",
      readBackValue: "Иванов Иван",
      verification: { matched: true }
    },
    context("corr-tested", 3)
  );
  const requested = releases.requestPreview(
    {
      spaceId: DEFAULT_SPACE_ID,
      versionId: tested.id,
      versionKind: "single"
    },
    context("corr-preview-request", 4)
  );
  await releases.completePreview(
    {
      requestId: requested.request.id,
      previewBuffer: Buffer.from("%PDF-1.4\n% generation test\n%%EOF\n"),
      converter: { converter: "test" }
    },
    context("corr-preview-ready", 5)
  );
  const previewJob = queue.claimNext({
    workerId: "preview-worker",
    leaseDurationMs: 1_000,
    now: at(5)
  });
  assert.equal(previewJob?.id, requested.request.workerJobId);
  queue.complete(requested.request.workerJobId, "preview-worker", at(6));
  const release = releases.activateVersion(
    {
      spaceId: DEFAULT_SPACE_ID,
      previewRequestId: requested.request.id
    },
    context("corr-activate", 7)
  );

  const anna = spaces.createEntity(
    DEFAULT_SPACE_ID,
    { entityTypeKey: "person", displayName: "Анна Алексеева" },
    context("corr-anna", 8)
  );
  const boris = spaces.createEntity(
    DEFAULT_SPACE_ID,
    { entityTypeKey: "person", displayName: "Борис Борисов" },
    context("corr-boris", 9)
  );
  const snapshot = spaces.createAudienceSnapshot(
    DEFAULT_SPACE_ID,
    {
      source: {
        kind: "selected",
        entityIds: [anna.entityId, boris.entityId]
      },
      targetMode: "aggregate"
    },
    context("corr-snapshot", 10)
  );
  const registry = new DocumentGenerationRegistry(store, objectStore, { queue });

  return {
    dataDir,
    store,
    objectStore,
    queue,
    registry,
    release,
    snapshot: snapshot.snapshot,
    async cleanup() {
      store.close();
      await fsPromises.rm(dataDir, { recursive: true, force: true });
    }
  };
}

function handlers(
  setup: Awaited<ReturnType<typeof fixture>>,
  workerId: string,
  now: () => Date
): JobHandlerRegistry {
  const registry = new JobHandlerRegistry();
  registry.register(
    "document.generate",
    createDocumentGenerationHandler({
      registry: setup.registry,
      objectStore: setup.objectStore,
      workerId,
      now
    })
  );
  return registry;
}

async function assertGeneratedDocument(
  setup: Awaited<ReturnType<typeof fixture>>,
  documentJobId: string
): Promise<void> {
  const job = setup.registry.getJob(DEFAULT_SPACE_ID, documentJobId);
  assert.equal(job.state, "completed");
  assert.equal(job.generatedCount, 1);
  assert.equal(job.failedCount, 0);
  assert.equal(job.error, null);
  assert.equal(job.units.length, 1);
  const outputSha256 = job.units[0]?.outputSha256;
  assert.ok(outputSha256);

  const output = await setup.objectStore.getBuffer(outputSha256);
  assert.equal(output.subarray(0, 2).toString(), "PK");
  const entries = await readOoxmlPackage(output);
  const documentXml = entries.find((entry) => entry.name === "word/document.xml");
  assert.ok(documentXml);
  const content = documentXml.content.toString("utf8");
  assert.match(content, /Анна Алексеева/u);
  assert.match(content, /Борис Борисов/u);

  const persisted = setup.store.execute((database) =>
    database
      .prepare(
        `
          SELECT
            (SELECT COUNT(*) FROM document_generation_units WHERE job_id = ?) AS unit_count,
            (SELECT COUNT(*) FROM files WHERE sha256 = ?) AS output_file_count,
            (SELECT COUNT(*) FROM domain_events
              WHERE dedupe_key = ?) AS finished_event_count
        `
      )
      .get(
        documentJobId,
        outputSha256,
        `document.generation.finished:${documentJobId}:completed`
      )
  ) as {
    unit_count: number;
    output_file_count: number;
    finished_event_count: number;
  };
  assert.equal(Number(persisted.unit_count), 1);
  assert.equal(Number(persisted.output_file_count), 1);
  assert.equal(Number(persisted.finished_event_count), 1);
}

test("expired document generation lease is reclaimed without duplicate output", async () => {
  const setup = await fixture();
  try {
    const created = setup.registry.createJob(
      {
        spaceId: DEFAULT_SPACE_ID,
        activeReleaseId: setup.release.id,
        snapshotId: setup.snapshot.id,
        idempotencyKey: "generation-after-crash"
      },
      context("corr-generate", 20)
    ).job;
    const queued = setup.queue.getById(created.workerJobId);
    assert.equal(queued?.maxAttempts, 5);

    const abandoned = setup.queue.claimNext({
      workerId: "worker-before-crash",
      leaseDurationMs: 1_000,
      now: at(20)
    });
    assert.equal(abandoned?.id, created.workerJobId);
    setup.registry.startJob(created.id, context("corr-start-before-crash", 21));

    const recoveryTime = at(1_021);
    const result = await processNextJob({
      queue: setup.queue,
      handlers: handlers(setup, "worker-after-crash", () => recoveryTime),
      workerId: "worker-after-crash",
      leaseDurationMs: 60_000,
      retryBaseMs: 100,
      retryMaxMs: 1_000,
      signal: new AbortController().signal,
      now: () => recoveryTime
    });
    assert.equal(result.status, "completed");
    assert.equal(result.job.id, created.workerJobId);
    assert.equal(result.job.attempts, 2);
    assert.equal(setup.queue.getById(created.workerJobId)?.state, "completed");
    await assertGeneratedDocument(setup, created.id);
  } finally {
    await setup.cleanup();
  }
});

test("graceful interruption keeps generation retryable and the next worker finishes it", async () => {
  const setup = await fixture();
  try {
    const created = setup.registry.createJob(
      {
        spaceId: DEFAULT_SPACE_ID,
        activeReleaseId: setup.release.id,
        snapshotId: setup.snapshot.id,
        idempotencyKey: "generation-after-interruption"
      },
      context("corr-generate", 20)
    ).job;
    let currentTime = at(20);
    const interrupted = new AbortController();
    interrupted.abort();
    const first = await processNextJob({
      queue: setup.queue,
      handlers: handlers(setup, "worker-interrupted", () => currentTime),
      workerId: "worker-interrupted",
      leaseDurationMs: 60_000,
      retryBaseMs: 100,
      retryMaxMs: 1_000,
      signal: interrupted.signal,
      now: () => currentTime
    });
    assert.equal(first.status, "retry");

    const retryable = setup.registry.getJob(DEFAULT_SPACE_ID, created.id);
    assert.equal(retryable.state, "running");
    assert.equal(retryable.error, null);
    assert.equal(retryable.units[0]?.state, "pending");
    assert.equal(setup.queue.getById(created.workerJobId)?.state, "retry");

    currentTime = at(120);
    const second = await processNextJob({
      queue: setup.queue,
      handlers: handlers(setup, "worker-recovery", () => currentTime),
      workerId: "worker-recovery",
      leaseDurationMs: 60_000,
      retryBaseMs: 100,
      retryMaxMs: 1_000,
      signal: new AbortController().signal,
      now: () => currentTime
    });
    assert.equal(second.status, "completed");
    assert.equal(second.job.attempts, 2);
    await assertGeneratedDocument(setup, created.id);
  } finally {
    await setup.cleanup();
  }
});
