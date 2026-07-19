import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  MultiFieldTestVersionRegistry,
  SpaceRegistry,
  SqliteStore,
  TemplateDraftRegistry,
  TemplateReleaseRegistry,
  TemplateTestVersionRegistry,
  WorkerQueue
} from "@docomator/storage";
import {
  readOoxmlPackage,
  writeOoxmlPackage
} from "@docomator/template-compiler";

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

function repeatTechnicalIdentifier(): string {
  return `airepeat:${createHash("sha256")
    .update("word/document.xml")
    .update("\u0000")
    .update("0")
    .update("\u0000")
    .update("1")
    .update("\u0000")
    .update("audience.members")
    .digest("hex")
    .slice(0, 24)}`;
}

function xlsxFieldIdentifier(fieldId: string): string {
  return `_DOCOMATOR_${createHash("sha256")
    .update(fieldId)
    .digest("hex")
    .slice(0, 24)
    .toUpperCase()}`;
}

function xlsxRepeatTechnicalIdentifier(): string {
  return `_DOCOMATOR_REPEAT_${createHash("sha256")
    .update("xl/worksheets/sheet1.xml")
    .update("\u0000")
    .update("2")
    .update("\u0000")
    .update("B2")
    .update("\u0000")
    .update("C2")
    .update("\u0000")
    .update("audience.members")
    .digest("hex")
    .slice(0, 24)
    .toUpperCase()}`;
}

function repeatCompiledTemplate(fieldId: string): Buffer {
  const fieldIdentifier = `aifield:${fieldId}`;
  const repeatIdentifier = repeatTechnicalIdentifier();
  const documentXml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Пользовательский заголовок</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>ФИО</w:t></w:r></w:p></w:tc></w:tr><w:sdt><w:sdtPr><w:tag w:val="${repeatIdentifier}"/><w:id w:val="100"/></w:sdtPr><w:sdtContent><w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:sdt><w:sdtPr><w:tag w:val="${fieldIdentifier}"/><w:id w:val="101"/></w:sdtPr><w:sdtContent><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>____</w:t></w:r></w:p></w:sdtContent></w:sdt></w:tc></w:tr></w:sdtContent></w:sdt></w:tbl><w:p><w:r><w:t>Пользовательская подпись</w:t></w:r></w:p></w:body></w:document>`;
  return writeOoxmlPackage([
    {
      name: "[Content_Types].xml",
      isDirectory: false,
      content: Buffer.from(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      )
    },
    {
      name: "_rels/.rels",
      isDirectory: false,
      content: Buffer.from(
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
      )
    },
    {
      name: "word/document.xml",
      isDirectory: false,
      content: Buffer.from(documentXml)
    }
  ]);
}

function xlsxRepeatCompiledTemplate(fieldId: string): Buffer {
  const fieldIdentifier = xlsxFieldIdentifier(fieldId);
  const repeatIdentifier = xlsxRepeatTechnicalIdentifier();
  return writeOoxmlPackage([
    {
      name: "[Content_Types].xml",
      isDirectory: false,
      content: Buffer.from(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
      )
    },
    {
      name: "_rels/.rels",
      isDirectory: false,
      content: Buffer.from(
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
      )
    },
    {
      name: "xl/workbook.xml",
      isDirectory: false,
      content: Buffer.from(
        `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Сотрудники" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="${fieldIdentifier}">'Сотрудники'!$B$2</definedName><definedName name="${repeatIdentifier}">'Сотрудники'!$B$2:$C$2</definedName></definedNames></workbook>`
      )
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      isDirectory: false,
      content: Buffer.from(
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'
      )
    },
    {
      name: "xl/worksheets/sheet1.xml",
      isDirectory: false,
      content: Buffer.from(
        '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="B2:C2"/><sheetData><row r="2" ht="20" customHeight="1"><c r="B2" t="inlineStr"><is><t>____</t></is></c><c r="C2"><f>B2</f><v>0</v></c></row></sheetData></worksheet>'
      )
    }
  ]);
}

async function fixture(
  options: { repeat?: boolean; repeatFormat?: "docx" | "xlsx" } = {}
) {
  const format = options.repeatFormat ?? "docx";
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
  const multiTestedVersions = new MultiFieldTestVersionRegistry(
    store,
    objectStore
  );
  const releases = new TemplateReleaseRegistry(store, objectStore, { queue });
  const spaces = new SpaceRegistry(store);

  const source = await quarantine.saveAcceptedDocument(
    {
      spaceId: DEFAULT_SPACE_ID,
      fileName: `Список участников.${format}`,
      mediaType:
        format === "docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      format,
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
      format,
      sourceSha256: source.sha256,
      structureSha256: STRUCTURE_SHA,
      structure: {
        elements: [
          format === "docx"
            ? { id: "paragraph-1", kind: "paragraph" }
            : {
                id: "cell-b2",
                kind: "cell",
                sheetName: "Сотрудники",
                sheetPath: "xl/worksheets/sheet1.xml",
                address: "B2"
              }
        ]
      },
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
      elementId: format === "docx" ? "paragraph-1" : "cell-b2",
      elementKind: format === "docx" ? "paragraph" : "cell",
      binding:
        format === "docx"
          ? {
              version: 1,
              kind: "docx.paragraph",
              elementId: "paragraph-1",
              part: "word/document.xml",
              index: options.repeat ? 2 : 0,
              ...(options.repeat
                ? {
                    tableLocation: {
                      tableIndex: 0,
                      rowIndex: 1,
                      columnIndex: 0
                    }
                  }
                : {})
            }
          : {
              version: 1,
              kind: "xlsx.cell",
              elementId: "cell-b2",
              sheetName: "Сотрудники",
              sheetPath: "xl/worksheets/sheet1.xml",
              address: "B2"
            },
      ...(options.repeat
        ? {
            repeatBinding:
              format === "docx"
                ? {
                    version: 1,
                    kind: "docx.repeat-row",
                    source: "audience.members",
                    anchorElementId: "paragraph-1",
                    part: "word/document.xml",
                    tableIndex: 0,
                    rowIndex: 1
                  }
                : {
                    version: 1,
                    kind: "xlsx.repeat-row",
                    source: "audience.members",
                    selection: "used-row",
                    sheetName: "Сотрудники",
                    sheetPath: "xl/worksheets/sheet1.xml",
                    rowNumber: 2,
                    startAddress: "B2",
                    endAddress: "C2",
                    startElementId: "cell-b2",
                    endElementId: "cell-c2"
                  }
          }
        : {}),
      originalPreview: "ФИО участника",
      structureSha256: STRUCTURE_SHA
    },
    context("corr-field", 2)
  );
  const compiled = options.repeat
    ? format === "docx"
      ? repeatCompiledTemplate(field.id)
      : xlsxRepeatCompiledTemplate(field.id)
    : Buffer.from("compiled-template");
  const repeatContract =
    format === "docx"
      ? {
          version: 1 as const,
          kind: "docx.repeat-row-contract" as const,
          binding: {
            version: 1 as const,
            kind: "docx.repeat-row" as const,
            source: "audience.members" as const,
            anchorElementId: "paragraph-1",
            part: "word/document.xml",
            tableIndex: 0,
            rowIndex: 1
          },
          technicalBinding: {
            kind: "docx.repeat-sdt" as const,
            identifier: repeatTechnicalIdentifier(),
            part: "word/document.xml",
            target: "таблица 1, строка 2"
          }
        }
      : {
          version: 1 as const,
          kind: "xlsx.repeat-row-contract" as const,
          binding: {
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
          },
          technicalBinding: {
            kind: "xlsx.repeat-defined-name" as const,
            identifier: xlsxRepeatTechnicalIdentifier(),
            part: "xl/workbook.xml" as const,
            target: "'Сотрудники'!$B$2:$C$2"
          }
        };
  const tested = options.repeat
    ? await multiTestedVersions.recordTestedVersion(
        {
          spaceId: DEFAULT_SPACE_ID,
          draftId: draft.id,
          format,
          compiledBuffer: compiled,
          trialBuffer: compiled,
          fields: [
            {
              fieldId: field.id,
              fieldKey: field.key,
              fieldLabel: field.label,
              valueType: field.valueType,
              required: field.required,
              binding: field.binding,
              formatter: field.formatter,
              technicalBinding:
                format === "docx"
                  ? {
                      kind: "docx.sdt",
                      identifier: `aifield:${field.id}`,
                      part: "word/document.xml",
                      target: "таблица 1, строка 2, ячейка 1"
                    }
                  : {
                      kind: "xlsx.defined-name",
                      identifier: xlsxFieldIdentifier(field.id),
                      part: "xl/workbook.xml",
                      target: "'Сотрудники'!$B$2"
                    },
              sampleValue: "Иванов Иван",
              renderedValue: "Иванов Иван",
              readBackValue: "Иванов Иван",
              verification: { matched: true }
            }
          ],
          repeatContract,
          verification: { matched: true }
        },
        context("corr-tested", 3)
      )
    : await testedVersions.recordTestedVersion({
      spaceId: DEFAULT_SPACE_ID,
      draftId: draft.id,
      fieldId: field.id,
      format,
      compiledBuffer: compiled,
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
    }, context("corr-tested", 3));
  const requested = releases.requestPreview(
    {
      spaceId: DEFAULT_SPACE_ID,
      versionId: tested.id,
      versionKind: options.repeat ? "multi" : "single"
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
    spaces,
    memberIds: [anna.entityId, boris.entityId],
    release,
    snapshot: snapshot.snapshot,
    repeat: Boolean(options.repeat),
    format,
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
  if (setup.format === "xlsx") {
    const worksheet = entries.find(
      (entry) => entry.name === "xl/worksheets/sheet1.xml"
    );
    assert.ok(worksheet);
    const content = worksheet.content.toString("utf8");
    assert.match(content, /Анна Алексеева/u);
    assert.match(content, /Борис Борисов/u);
    assert.match(content, /<dimension ref="B2:C3"\/>/u);
    assert.match(content, /<f>B2<\/f>/u);
    assert.match(content, /<f>B3<\/f>/u);
    assert.doesNotMatch(content, /____/u);
  } else {
    const documentXml = entries.find(
      (entry) => entry.name === "word/document.xml"
    );
    assert.ok(documentXml);
    const content = documentXml.content.toString("utf8");
    assert.match(content, /Анна Алексеева/u);
    assert.match(content, /Борис Борисов/u);
    if (setup.repeat) {
      assert.match(content, /Пользовательский заголовок/u);
      assert.match(content, /Пользовательская подпись/u);
      assert.equal((content.match(/<w:tr>/gu) ?? []).length, 3);
      assert.equal((content.match(/<w:cantSplit\/>/gu) ?? []).length, 2);
      assert.doesNotMatch(content, /Участников: 2/u);
      assert.doesNotMatch(content, /____/u);
    }
  }

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

test("aggregate generation uses the activated user DOCX repeat row", async () => {
  const setup = await fixture({ repeat: true });
  try {
    const personal = setup.spaces.createAudienceSnapshot(
      DEFAULT_SPACE_ID,
      {
        source: { kind: "selected", entityIds: setup.memberIds },
        targetMode: "one_per_member"
      },
      context("corr-repeat-personal-snapshot", 19)
    );
    assert.throws(
      () =>
        setup.registry.createJob(
          {
            spaceId: DEFAULT_SPACE_ID,
            activeReleaseId: setup.release.id,
            snapshotId: personal.snapshot.id,
            idempotencyKey: "generation-repeat-personal"
          },
          context("corr-repeat-personal", 20)
        ),
      /aggregate audience snapshot/u
    );
    const created = setup.registry.createJob(
      {
        spaceId: DEFAULT_SPACE_ID,
        activeReleaseId: setup.release.id,
        snapshotId: setup.snapshot.id,
        idempotencyKey: "generation-user-repeat"
      },
      context("corr-repeat-generate", 20)
    ).job;
    const currentTime = at(20);
    const result = await processNextJob({
      queue: setup.queue,
      handlers: handlers(setup, "worker-repeat", () => currentTime),
      workerId: "worker-repeat",
      leaseDurationMs: 60_000,
      retryBaseMs: 100,
      retryMaxMs: 1_000,
      signal: new AbortController().signal,
      now: () => currentTime
    });
    assert.equal(result.status, "completed");
    await assertGeneratedDocument(setup, created.id);
  } finally {
    await setup.cleanup();
  }
});

test("aggregate generation uses the activated XLSX repeat row", async () => {
  const setup = await fixture({ repeat: true, repeatFormat: "xlsx" });
  try {
    const created = setup.registry.createJob(
      {
        spaceId: DEFAULT_SPACE_ID,
        activeReleaseId: setup.release.id,
        snapshotId: setup.snapshot.id,
        idempotencyKey: "generation-xlsx-repeat"
      },
      context("corr-xlsx-repeat-generate", 20)
    ).job;
    const currentTime = at(20);
    const result = await processNextJob({
      queue: setup.queue,
      handlers: handlers(setup, "worker-xlsx-repeat", () => currentTime),
      workerId: "worker-xlsx-repeat",
      leaseDurationMs: 60_000,
      retryBaseMs: 100,
      retryMaxMs: 1_000,
      signal: new AbortController().signal,
      now: () => currentTime
    });
    assert.equal(result.status, "completed");
    await assertGeneratedDocument(setup, created.id);
  } finally {
    await setup.cleanup();
  }
});
