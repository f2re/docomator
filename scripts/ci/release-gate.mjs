import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import fsPromises, {
  chmod,
  readFile,
  realpath,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { analyzeOoxmlBuffer } from "@docomator/document-intake";
import {
  ContentAddressedObjectStore,
  DEFAULT_SPACE_ID,
  DocumentQuarantineRegistry,
  MultiFieldTestVersionRegistry,
  SpaceRegistry,
  SqliteStore,
  TemplateDraftRegistry,
  TemplateReleaseRegistry,
  TemplateTestVersionRegistry,
  WorkerQueue,
  toJsonValue
} from "@docomator/storage";
import {
  compileScalarFields,
  readOoxmlPackage,
  renderScalarValues,
  verifyXlsxMetadata,
  writeOoxmlPackage
} from "@docomator/template-compiler";
import yauzl from "yauzl";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const keepArtifacts = process.env.DOCOMATOR_RELEASE_GATE_KEEP === "1";
const dataDir = await fsPromises.mkdtemp(
  path.join(os.tmpdir(), "docomator-release-gate-")
);
const sentinelPath = path.join(dataDir, ".release-gate-sentinel");
await chmod(dataDir, 0o700);
await writeFile(sentinelPath, "docomator-release-gate-v1\n", { mode: 0o600 });
const databasePath = path.join(dataDir, "docomator.db");
const objectRoot = path.join(dataDir, "objects");
const processes = new Set();
let contextSequence = 0;

function context(label) {
  contextSequence += 1;
  return {
    correlationId: `release-gate-${label}-${contextSequence}`,
    actorType: "release_gate",
    actorId: "release-gate",
    now: new Date(Date.now() + contextSequence).toISOString()
  };
}

function docxPackage(documentXml) {
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

function personalSource() {
  return docxPackage(
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Сотрудник: ____; проверено</w:t></w:r></w:p></w:body></w:document>'
  );
}

function repeatSource() {
  return docxPackage(
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Реестр сотрудников</w:t></w:r></w:p><w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr><w:tr><w:tc><w:p><w:r><w:t>ФИО</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:p><w:r><w:rPr><w:i/></w:rPr><w:t>____</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>Ответственный: отдел кадров</w:t></w:r></w:p></w:body></w:document>'
  );
}

function repeatXlsxSource() {
  return writeOoxmlPackage([
    {
      name: "[Content_Types].xml",
      isDirectory: false,
      content: Buffer.from(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'
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
        '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Сотрудники" sheetId="1" r:id="rId1"/></sheets></workbook>'
      )
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      isDirectory: false,
      content: Buffer.from(
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
      )
    },
    {
      name: "xl/styles.xml",
      isDirectory: false,
      content: Buffer.from(
        '<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="3"><xf/><xf/><xf numFmtId="2"/></cellXfs></styleSheet>'
      )
    },
    {
      name: "xl/worksheets/sheet1.xml",
      isDirectory: false,
      content: Buffer.from(
        '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="B2:C2"/><sheetData><row r="2" s="1" customFormat="1" ht="22" customHeight="1"><c r="B2" s="1" t="inlineStr"><is><t>____</t></is></c><c r="C2" s="2"><f>B2</f><v>0</v></c></row></sheetData></worksheet>'
      )
    }
  ]);
}

function elementBinding(element, selectedText) {
  const startOffset = element.text.indexOf(selectedText);
  assert.notEqual(startOffset, -1, "placeholder must exist in Document IR");
  return {
    version: 1,
    kind: "docx.text-range",
    elementId: element.id,
    part: element.part,
    index: element.index,
    startOffset,
    endOffset: startOffset + selectedText.length,
    selectedText,
    ...(element.tableLocation === undefined
      ? {}
      : { tableLocation: element.tableLocation })
  };
}

async function activateCandidate(releases, queue, tested, versionKind, label) {
  const requestedAt = context(`${label}-preview-request`);
  const requested = releases.requestPreview(
    {
      spaceId: DEFAULT_SPACE_ID,
      versionId: tested.id,
      versionKind
    },
    requestedAt
  );
  const completedAt = context(`${label}-preview-ready`);
  await releases.completePreview(
    {
      requestId: requested.request.id,
      previewBuffer: Buffer.from("%PDF-1.4\n% deterministic release gate\n%%EOF\n"),
      converter: toJsonValue({ kind: "release-gate-stub" })
    },
    completedAt
  );
  const previewJob = queue.claimNext({
    workerId: "release-gate-preview",
    leaseDurationMs: 5_000,
    now: new Date(completedAt.now)
  });
  assert.equal(previewJob?.id, requested.request.workerJobId);
  queue.complete(previewJob.id, "release-gate-preview", new Date());
  return releases.activateVersion(
    {
      spaceId: DEFAULT_SPACE_ID,
      previewRequestId: requested.request.id
    },
    context(`${label}-activate`)
  );
}

async function seedPersonalRelease(registries) {
  const sourceBuffer = personalSource();
  const structure = await analyzeOoxmlBuffer({
    buffer: sourceBuffer,
    fileName: "Личная карточка.docx",
    maxElements: 2_000
  });
  const paragraph = structure.elements.find(
    (element) => element.kind === "paragraph" && element.text.includes("____")
  );
  assert.ok(paragraph);
  const source = await registries.quarantine.saveAcceptedDocument(
    {
      spaceId: DEFAULT_SPACE_ID,
      fileName: "Личная карточка.docx",
      mediaType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      format: "docx",
      decision: "accepted",
      buffer: sourceBuffer,
      report: toJsonValue({ decision: "accepted", gate: "P4" })
    },
    context("personal-source")
  );
  const draft = registries.drafts.createOrGetDraft(
    {
      spaceId: DEFAULT_SPACE_ID,
      sourceRecordId: source.id,
      title: "Личная карточка",
      format: "docx",
      sourceSha256: source.sha256,
      structureSha256: structure.structureSha256,
      structure: toJsonValue(structure),
      structureTruncated: structure.truncated
    },
    context("personal-draft")
  );
  const binding = elementBinding(paragraph, "____");
  const field = registries.drafts.createField(
    DEFAULT_SPACE_ID,
    draft.id,
    {
      key: "person.full_name",
      label: "ФИО сотрудника",
      valueType: "string",
      required: true,
      elementId: paragraph.id,
      elementKind: "paragraph",
      binding: toJsonValue(binding),
      formatter: toJsonValue({ version: 1, kind: "identity" }),
      originalPreview: paragraph.text,
      structureSha256: structure.structureSha256
    },
    context("personal-field")
  );
  const compiled = await compileScalarFields({
    source: sourceBuffer,
    fileName: "Личная карточка.docx",
    expectedSourceSha256: structure.sourceSha256,
    expectedStructureSha256: structure.structureSha256,
    fields: [
      {
        id: field.id,
        key: field.key,
        label: field.label,
        elementId: field.elementId,
        binding: field.binding
      }
    ]
  });
  const compiledField = compiled.fields[0];
  assert.ok(compiledField);
  const trial = await renderScalarValues({
    compiled: compiled.output,
    fields: [
      {
        fieldId: field.id,
        fieldKey: field.key,
        technicalBinding: compiledField.technicalBinding,
        fieldBinding: field.binding,
        valueType: field.valueType,
        formatter: field.formatter,
        value: "Тестовый Сотрудник"
      }
    ]
  });
  const renderedField = trial.fields[0];
  assert.ok(renderedField);
  const tested = await registries.singleVersions.recordTestedVersion(
    {
      spaceId: DEFAULT_SPACE_ID,
      draftId: draft.id,
      fieldId: field.id,
      format: "docx",
      compiledBuffer: compiled.output,
      trialBuffer: trial.output,
      technicalBinding: toJsonValue(compiledField.technicalBinding),
      sampleValue: "Тестовый Сотрудник",
      renderedValue: renderedField.renderedValue,
      readBackValue: renderedField.readBackValue,
      verification: toJsonValue(trial.verification)
    },
    context("personal-tested")
  );
  return activateCandidate(
    registries.releases,
    registries.queue,
    tested,
    "single",
    "personal"
  );
}

async function seedRepeatRelease(registries) {
  const sourceBuffer = repeatSource();
  const structure = await analyzeOoxmlBuffer({
    buffer: sourceBuffer,
    fileName: "Реестр.docx",
    maxElements: 2_000
  });
  const paragraph = structure.elements.find(
    (element) =>
      element.kind === "paragraph" &&
      element.text === "____" &&
      element.tableLocation?.tableIndex === 0 &&
      element.tableLocation.rowIndex === 1
  );
  assert.ok(paragraph?.tableLocation);
  const source = await registries.quarantine.saveAcceptedDocument(
    {
      spaceId: DEFAULT_SPACE_ID,
      fileName: "Реестр.docx",
      mediaType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      format: "docx",
      decision: "accepted",
      buffer: sourceBuffer,
      report: toJsonValue({ decision: "accepted", gate: "P4" })
    },
    context("repeat-source")
  );
  const draft = registries.drafts.createOrGetDraft(
    {
      spaceId: DEFAULT_SPACE_ID,
      sourceRecordId: source.id,
      title: "Реестр сотрудников",
      format: "docx",
      sourceSha256: source.sha256,
      structureSha256: structure.structureSha256,
      structure: toJsonValue(structure),
      structureTruncated: structure.truncated
    },
    context("repeat-draft")
  );
  const binding = elementBinding(paragraph, "____");
  const repeatBinding = {
    version: 1,
    kind: "docx.repeat-row",
    source: "audience.members",
    anchorElementId: paragraph.id,
    part: paragraph.part,
    tableIndex: paragraph.tableLocation.tableIndex,
    rowIndex: paragraph.tableLocation.rowIndex
  };
  const field = registries.drafts.createField(
    DEFAULT_SPACE_ID,
    draft.id,
    {
      key: "person.full_name",
      label: "ФИО сотрудника",
      valueType: "string",
      required: true,
      elementId: paragraph.id,
      elementKind: "paragraph",
      binding: toJsonValue(binding),
      formatter: toJsonValue({ version: 1, kind: "identity" }),
      repeatBinding: toJsonValue(repeatBinding),
      originalPreview: paragraph.text,
      structureSha256: structure.structureSha256
    },
    context("repeat-field")
  );
  const compiled = await compileScalarFields({
    source: sourceBuffer,
    fileName: "Реестр.docx",
    expectedSourceSha256: structure.sourceSha256,
    expectedStructureSha256: structure.structureSha256,
    fields: [
      {
        id: field.id,
        key: field.key,
        label: field.label,
        elementId: field.elementId,
        binding: field.binding
      }
    ],
    repeatBinding
  });
  assert.ok(compiled.repeat);
  const compiledField = compiled.fields[0];
  assert.ok(compiledField);
  const trial = await renderScalarValues({
    compiled: compiled.output,
    fields: [
      {
        fieldId: field.id,
        fieldKey: field.key,
        technicalBinding: compiledField.technicalBinding,
        fieldBinding: field.binding,
        valueType: field.valueType,
        formatter: field.formatter,
        value: "Тестовый Сотрудник"
      }
    ]
  });
  const renderedField = trial.fields[0];
  assert.ok(renderedField);
  const repeatContract = toJsonValue({
    version: 1,
    kind: "docx.repeat-row-contract",
    binding: compiled.repeat.binding,
    technicalBinding: compiled.repeat.technicalBinding
  });
  const tested = await registries.multiVersions.recordTestedVersion(
    {
      spaceId: DEFAULT_SPACE_ID,
      draftId: draft.id,
      format: "docx",
      compiledBuffer: compiled.output,
      trialBuffer: trial.output,
      fields: [
        {
          fieldId: field.id,
          fieldKey: field.key,
          fieldLabel: field.label,
          valueType: field.valueType,
          required: field.required,
          binding: field.binding,
          formatter: field.formatter,
          technicalBinding: toJsonValue(compiledField.technicalBinding),
          sampleValue: "Тестовый Сотрудник",
          renderedValue: renderedField.renderedValue,
          readBackValue: renderedField.readBackValue,
          verification: toJsonValue({ matched: true })
        }
      ],
      repeatContract,
      verification: toJsonValue({
        matched: true,
        compiledFields: 1,
        readBackFields: 1
      })
    },
    context("repeat-tested")
  );
  return activateCandidate(
    registries.releases,
    registries.queue,
    tested,
    "multi",
    "repeat"
  );
}

async function seedXlsxRepeatRelease(registries) {
  const sourceBuffer = repeatXlsxSource();
  const structure = await analyzeOoxmlBuffer({
    buffer: sourceBuffer,
    fileName: "Реестр.xlsx",
    maxElements: 2_000
  });
  const fieldCell = structure.elements.find(
    (element) => element.kind === "cell" && element.address === "B2"
  );
  const formulaCell = structure.elements.find(
    (element) => element.kind === "cell" && element.address === "C2"
  );
  assert.ok(fieldCell);
  assert.ok(formulaCell);
  const source = await registries.quarantine.saveAcceptedDocument(
    {
      spaceId: DEFAULT_SPACE_ID,
      fileName: "Реестр.xlsx",
      mediaType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      format: "xlsx",
      decision: "accepted",
      buffer: sourceBuffer,
      report: toJsonValue({ decision: "accepted", gate: "P4" })
    },
    context("xlsx-repeat-source")
  );
  const draft = registries.drafts.createOrGetDraft(
    {
      spaceId: DEFAULT_SPACE_ID,
      sourceRecordId: source.id,
      title: "Реестр сотрудников XLSX",
      format: "xlsx",
      sourceSha256: source.sha256,
      structureSha256: structure.structureSha256,
      structure: toJsonValue(structure),
      structureTruncated: structure.truncated
    },
    context("xlsx-repeat-draft")
  );
  const binding = {
    version: 1,
    kind: "xlsx.cell",
    elementId: fieldCell.id,
    sheetName: fieldCell.sheetName,
    sheetPath: fieldCell.sheetPath,
    address: fieldCell.address
  };
  const repeatBinding = {
    version: 1,
    kind: "xlsx.repeat-row",
    source: "audience.members",
    selection: "used-row",
    sheetName: fieldCell.sheetName,
    sheetPath: fieldCell.sheetPath,
    rowNumber: 2,
    startAddress: fieldCell.address,
    endAddress: formulaCell.address,
    startElementId: fieldCell.id,
    endElementId: formulaCell.id
  };
  const field = registries.drafts.createField(
    DEFAULT_SPACE_ID,
    draft.id,
    {
      key: "person.full_name",
      label: "ФИО сотрудника",
      valueType: "string",
      required: true,
      elementId: fieldCell.id,
      elementKind: "cell",
      binding: toJsonValue(binding),
      formatter: toJsonValue({ version: 1, kind: "identity" }),
      repeatBinding: toJsonValue(repeatBinding),
      originalPreview: fieldCell.value,
      structureSha256: structure.structureSha256
    },
    context("xlsx-repeat-field")
  );
  const compiled = await compileScalarFields({
    source: sourceBuffer,
    fileName: "Реестр.xlsx",
    expectedSourceSha256: structure.sourceSha256,
    expectedStructureSha256: structure.structureSha256,
    fields: [
      {
        id: field.id,
        key: field.key,
        label: field.label,
        elementId: field.elementId,
        binding: field.binding
      }
    ],
    repeatBinding
  });
  assert.equal(compiled.repeat?.binding.kind, "xlsx.repeat-row");
  const compiledField = compiled.fields[0];
  assert.ok(compiledField);
  const expectedMetadata = [
    {
      kind: "field",
      identifier: compiledField.technicalBinding.identifier,
      part: compiledField.technicalBinding.part,
      target: compiledField.technicalBinding.target
    },
    {
      kind: "repeat",
      identifier: compiled.repeat.technicalBinding.identifier,
      part: compiled.repeat.technicalBinding.part,
      target: compiled.repeat.technicalBinding.target
    }
  ];
  const compiledMetadata = verifyXlsxMetadata(
    await readOoxmlPackage(compiled.output),
    {
      expectedRecords: expectedMetadata,
      exactExpectedRecords: true,
      definedNames: "present"
    }
  );
  assert.deepEqual(compiledMetadata, expectedMetadata);
  const trial = await renderScalarValues({
    compiled: compiled.output,
    repeatTechnicalBinding: compiled.repeat.technicalBinding,
    fields: [
      {
        fieldId: field.id,
        fieldKey: field.key,
        technicalBinding: compiledField.technicalBinding,
        fieldBinding: field.binding,
        valueType: field.valueType,
        formatter: field.formatter,
        value: "Тестовый Сотрудник"
      }
    ]
  });
  const renderedField = trial.fields[0];
  assert.ok(renderedField);
  const repeatContract = toJsonValue({
    version: 1,
    kind: "xlsx.repeat-row-contract",
    binding: compiled.repeat.binding,
    technicalBinding: compiled.repeat.technicalBinding
  });
  const tested = await registries.multiVersions.recordTestedVersion(
    {
      spaceId: DEFAULT_SPACE_ID,
      draftId: draft.id,
      format: "xlsx",
      compiledBuffer: compiled.output,
      trialBuffer: trial.output,
      fields: [
        {
          fieldId: field.id,
          fieldKey: field.key,
          fieldLabel: field.label,
          valueType: field.valueType,
          required: field.required,
          binding: field.binding,
          formatter: field.formatter,
          technicalBinding: toJsonValue(compiledField.technicalBinding),
          sampleValue: "Тестовый Сотрудник",
          renderedValue: renderedField.renderedValue,
          readBackValue: renderedField.readBackValue,
          verification: toJsonValue({ matched: true })
        }
      ],
      repeatContract,
      verification: toJsonValue({
        matched: true,
        compiledFields: 1,
        readBackFields: 1
      })
    },
    context("xlsx-repeat-tested")
  );
  const release = await activateCandidate(
    registries.releases,
    registries.queue,
    tested,
    "multi",
    "xlsx-repeat"
  );
  assert.equal(release.manifest.version, 5);
  assert.deepEqual(release.manifest.xlsxMetadata, {
    version: 1,
    sheetName: "_AI_META",
    visibility: "veryHidden"
  });
  return release;
}

function childEnvironment(env) {
  return {
    PATH: process.env.PATH,
    LANG: process.env.LANG ?? "C.UTF-8",
    LC_ALL: process.env.LC_ALL ?? "C.UTF-8",
    TMPDIR: process.env.TMPDIR ?? os.tmpdir(),
    HOME: process.env.HOME ?? os.tmpdir(),
    ...env
  };
}

function startProcess(name, entrypoint, env, options = {}) {
  const child = spawn(process.execPath, [entrypoint], {
    cwd: root,
    env: childEnvironment(env),
    stdio: options.ipc
      ? ["ignore", "pipe", "pipe", "ipc"]
      : ["ignore", "pipe", "pipe"]
  });
  let output = "";
  const append = (chunk) => {
    output = `${output}${chunk.toString("utf8")}`.slice(-40_000);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  const exited = new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  const messages = [];
  child.on("message", (message) => messages.push(message));
  const processRecord = {
    name,
    child,
    exited,
    messages,
    output: () => output
  };
  processes.add(processRecord);
  return processRecord;
}

async function waitForChildMessage(processRecord, wantedType, timeoutMs = 10_000) {
  const existing = processRecord.messages.find(
    (message) => message?.type === wantedType
  );
  if (existing !== undefined) return existing;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `${processRecord.name} did not send ${wantedType}:\n${processRecord.output()}`
        )
      );
    }, timeoutMs);
    const onMessage = (message) => {
      if (message?.type !== wantedType) return;
      cleanup();
      resolve(message);
    };
    const onExit = ({ code, signal }) => {
      cleanup();
      reject(
        new Error(
          `${processRecord.name} exited before ${wantedType} (${code ?? signal}):\n${processRecord.output()}`
        )
      );
    };
    const cleanup = () => {
      clearTimeout(timeout);
      processRecord.child.off("message", onMessage);
    };
    processRecord.child.on("message", onMessage);
    processRecord.exited.then(onExit);
  });
}

async function stopProcess(processRecord, signal = "SIGTERM") {
  if (processRecord.child.exitCode !== null || processRecord.child.signalCode) {
    processes.delete(processRecord);
    return;
  }
  processRecord.child.kill(signal);
  const timedOut = Symbol("timed-out");
  const result = await Promise.race([
    processRecord.exited,
    new Promise((resolve) => setTimeout(() => resolve(timedOut), 5_000))
  ]);
  if (result === timedOut) {
    processRecord.child.kill("SIGKILL");
    await processRecord.exited;
  }
  processes.delete(processRecord);
}

async function waitFor(description, predicate, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `${description} did not complete within ${timeoutMs} ms${lastError instanceof Error ? `: ${lastError.message}` : ""}`
  );
}

async function apiJson(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      accept: "application/json",
      "x-actor-id": "release-gate",
      "x-correlation-id": `release-gate-http-${Date.now()}`,
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...options.headers
    }
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${pathname}: ${JSON.stringify(body)}`
    );
  }
  return { status: response.status, data: body?.data };
}

async function jobCompleted(baseUrl, jobId) {
  return waitFor(`document job ${jobId}`, async () => {
    const response = await apiJson(
      baseUrl,
      `/api/v1/spaces/${DEFAULT_SPACE_ID}/document-jobs/${jobId}`
    );
    const job = response.data?.job;
    if (job?.state === "failed") {
      throw new Error(job.error?.message ?? "document generation failed");
    }
    return job?.state === "completed" ? job : null;
  });
}

async function readZipEntries(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true },
      (openError, zipFile) => {
        if (openError || zipFile === undefined) {
          reject(openError ?? new Error("ZIP could not be opened"));
          return;
        }
        const entries = new Map();
        let totalBytes = 0;
        zipFile.once("error", reject);
        zipFile.on("entry", (entry) => {
          if (/\/$/u.test(entry.fileName)) {
            zipFile.readEntry();
            return;
          }
          if (
            entry.fileName.startsWith("/") ||
            entry.fileName.includes("\\") ||
            entry.fileName.split("/").some((segment) => segment === "..") ||
            /[\u0000-\u001f\u007f]/u.test(entry.fileName) ||
            entries.has(entry.fileName)
          ) {
            zipFile.close();
            reject(new Error(`ZIP contains an unsafe entry: ${entry.fileName}`));
            return;
          }
          if (entries.size >= 100 || entry.uncompressedSize > 32 * 1024 * 1024) {
            zipFile.close();
            reject(new Error("ZIP exceeds release-gate limits"));
            return;
          }
          zipFile.openReadStream(entry, (streamError, stream) => {
            if (streamError || stream === undefined) {
              reject(streamError ?? new Error("ZIP entry could not be read"));
              return;
            }
            const chunks = [];
            stream.on("data", (chunk) => chunks.push(chunk));
            stream.once("error", reject);
            stream.once("end", () => {
              const content = Buffer.concat(chunks);
              totalBytes += content.length;
              if (totalBytes > 128 * 1024 * 1024) {
                zipFile.close();
                reject(new Error("ZIP expanded size exceeds release-gate limit"));
                return;
              }
              entries.set(entry.fileName, content);
              zipFile.readEntry();
            });
          });
        });
        zipFile.once("end", () => resolve(entries));
        zipFile.readEntry();
      }
    );
  });
}

async function download(baseUrl, pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: { "x-correlation-id": `release-gate-download-${Date.now()}` }
  });
  assert.equal(response.status, 200, `download failed: ${pathname}`);
  return Buffer.from(await response.arrayBuffer());
}

function generationFacts(jobId) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return database
      .prepare(`
        SELECT
          (SELECT COUNT(*) FROM document_generation_units WHERE job_id = ?) AS units,
          (SELECT COUNT(*) FROM document_generation_units WHERE job_id = ? AND state = 'completed') AS completed_units,
          (SELECT COUNT(DISTINCT output_sha256) FROM document_generation_units WHERE job_id = ? AND output_sha256 IS NOT NULL) AS unique_outputs,
          (SELECT COUNT(*) FROM domain_events WHERE dedupe_key = ?) AS finished_events,
          (SELECT attempts FROM worker_jobs WHERE id = (SELECT worker_job_id FROM document_generation_jobs WHERE id = ?)) AS attempts
      `)
      .get(
        jobId,
        jobId,
        jobId,
        `document.generation.finished:${jobId}:completed`,
        jobId
      );
  } finally {
    database.close();
  }
}

function unitFacts(unitId) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return database
      .prepare(`
        SELECT id, state, output_sha256, completed_at
        FROM document_generation_units
        WHERE id = ?
      `)
      .get(unitId);
  } finally {
    database.close();
  }
}

function leaseFacts(workerJobId) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return database
      .prepare(
        "SELECT state, attempts, lease_expires_at FROM worker_jobs WHERE id = ?"
      )
      .get(workerJobId);
  } finally {
    database.close();
  }
}

async function main() {
  for (const entrypoint of [
    "apps/api/dist/server.js",
    "apps/worker/dist/main.js"
  ]) {
    assert.ok(
      fs.existsSync(path.join(root, entrypoint)),
      `Build output is missing: ${entrypoint}. Run npm run build first.`
    );
  }
  const migration = spawnSync(
    process.execPath,
    [path.join(root, "scripts/runtime/migrate.mjs")],
    {
      cwd: root,
      env: childEnvironment({ DOCOMATOR_DATA_DIR: dataDir }),
      encoding: "utf8"
    }
  );
  assert.equal(
    migration.status,
    0,
    migration.stderr || migration.stdout || "migration failed"
  );

  const store = new SqliteStore({ databasePath });
  const objectStore = new ContentAddressedObjectStore(objectRoot);
  const queue = new WorkerQueue(store);
  const registries = {
    queue,
    quarantine: new DocumentQuarantineRegistry(store, objectStore),
    drafts: new TemplateDraftRegistry(store),
    singleVersions: new TemplateTestVersionRegistry(store, objectStore),
    multiVersions: new MultiFieldTestVersionRegistry(store, objectStore),
    releases: new TemplateReleaseRegistry(store, objectStore, { queue })
  };
  const personalRelease = await seedPersonalRelease(registries);
  const repeatRelease = await seedRepeatRelease(registries);
  const xlsxRepeatRelease = await seedXlsxRepeatRelease(registries);
  const spaces = new SpaceRegistry(store);
  const members = Array.from({ length: 10 }, (_, index) =>
    spaces.createEntity(
      DEFAULT_SPACE_ID,
      {
        entityTypeKey: "person",
        displayName: `Сотрудник ${String(index + 1).padStart(2, "0")}`
      },
      context(`member-${index + 1}`)
    )
  );
  store.close();

  const commonEnv = {
    DOCOMATOR_DATA_DIR: dataDir,
    HOME: path.join(dataDir, "runtime-home"),
    DOCOMATOR_LOG_LEVEL: "error",
    DOCOMATOR_LLM_ENABLED: "false",
    DOCOMATOR_PREVIEW_ENABLED: "false",
    DOCOMATOR_SMTP_ENABLED: "false",
    DOCOMATOR_WORKER_POLL_MS: "100",
    DOCOMATOR_WORKER_HEARTBEAT_MS: "1000",
    DOCOMATOR_WORKER_LEASE_MS: "10000",
    DOCOMATOR_WORKER_RETRY_BASE_MS: "100",
    DOCOMATOR_WORKER_RETRY_MAX_MS: "1000"
  };
  await fsPromises.mkdir(commonEnv.HOME, { mode: 0o700 });
  const api = startProcess(
    "api",
    "apps/api/dist/server.js",
    {
      ...commonEnv,
      DOCOMATOR_PORT: "0"
    },
    { ipc: true }
  );
  const listening = await waitForChildMessage(api, "listening", 15_000);
  assert.equal(listening.host, "127.0.0.1");
  assert.ok(Number.isInteger(listening.port) && listening.port > 0);
  const baseUrl = `http://127.0.0.1:${listening.port}`;
  await waitFor("API readiness", async () => {
    if (api.child.exitCode !== null) {
      throw new Error(`API exited early:\n${api.output()}`);
    }
    const response = await fetch(`${baseUrl}/readyz`);
    return response.ok;
  }, 15_000);

  const selected = {
    kind: "selected",
    entityIds: members.map((member) => member.entityId)
  };
  const personalSnapshotResponse = await apiJson(
    baseUrl,
    `/api/v1/spaces/${DEFAULT_SPACE_ID}/audience-snapshots`,
    {
      method: "POST",
      body: JSON.stringify({ source: selected, targetMode: "one_per_member" })
    }
  );
  const personalPreflight = await apiJson(
    baseUrl,
    `/api/v1/spaces/${DEFAULT_SPACE_ID}/document-jobs/preflight`,
    {
      method: "POST",
      body: JSON.stringify({
        activeReleaseId: personalRelease.id,
        snapshotId: personalSnapshotResponse.data.snapshot.id
      })
    }
  );
  assert.equal(personalPreflight.data.memberCount, 10);
  assert.equal(personalPreflight.data.expectedCount, 10);
  assert.equal(personalPreflight.data.canStart, true);
  const personalJobResponse = await apiJson(
    baseUrl,
    `/api/v1/spaces/${DEFAULT_SPACE_ID}/document-jobs`,
    {
      method: "POST",
      body: JSON.stringify({
        activeReleaseId: personalRelease.id,
        snapshotId: personalSnapshotResponse.data.snapshot.id,
        idempotencyKey: "release-gate-personal"
      })
    }
  );
  assert.equal(personalJobResponse.status, 201);
  const duplicatePersonal = await apiJson(
    baseUrl,
    `/api/v1/spaces/${DEFAULT_SPACE_ID}/document-jobs`,
    {
      method: "POST",
      body: JSON.stringify({
        activeReleaseId: personalRelease.id,
        snapshotId: personalSnapshotResponse.data.snapshot.id,
        idempotencyKey: "release-gate-personal"
      })
    }
  );
  assert.equal(duplicatePersonal.status, 200);
  assert.equal(
    duplicatePersonal.data.job.id,
    personalJobResponse.data.job.id,
    "idempotent API retry must return the same document job"
  );

  const crashWorker = startProcess(
    "crash-worker",
    "scripts/ci/release-gate-crash-worker.mjs",
    {
      ...commonEnv,
      DOCOMATOR_WORKER_ID: "release-gate-crash-worker"
    },
    { ipc: true }
  );
  const crashMessage = await waitForChildMessage(
    crashWorker,
    "unit-completed"
  );
  const firstUnitBeforeRestart = unitFacts(crashMessage.unitId);
  assert.equal(firstUnitBeforeRestart.state, "completed");
  assert.ok(firstUnitBeforeRestart.output_sha256);
  assert.ok(firstUnitBeforeRestart.completed_at);
  const beforeRestartFacts = generationFacts(personalJobResponse.data.job.id);
  assert.equal(Number(beforeRestartFacts.completed_units), 1);
  assert.equal(Number(beforeRestartFacts.finished_events), 0);
  assert.equal(Number(beforeRestartFacts.attempts), 1);
  await stopProcess(crashWorker, "SIGKILL");
  await waitFor("crashed worker lease expiry", async () => {
    const lease = leaseFacts(personalJobResponse.data.job.workerJobId);
    return (
      lease.state === "running" &&
      typeof lease.lease_expires_at === "string" &&
      Date.parse(lease.lease_expires_at) <= Date.now()
    );
  }, 10_000);

  const workerOne = startProcess("worker-one", "apps/worker/dist/main.js", {
    ...commonEnv,
    DOCOMATOR_WORKER_ID: "release-gate-worker-one"
  });
  const personalJob = await jobCompleted(
    baseUrl,
    personalJobResponse.data.job.id
  );
  assert.equal(personalJob.generatedCount, 10);
  assert.equal(personalJob.failedCount, 0);
  assert.equal(personalJob.units.length, 10);
  const personalArchive = await download(
    baseUrl,
    `/api/v1/spaces/${DEFAULT_SPACE_ID}/document-jobs/${personalJob.id}/download`
  );
  assert.equal(personalArchive.subarray(0, 2).toString(), "PK");
  const archiveEntries = await readZipEntries(personalArchive);
  const docxEntries = [...archiveEntries.entries()].filter(([name]) =>
    name.endsWith(".docx")
  );
  assert.equal(docxEntries.length, 10);
  for (const unit of personalJob.units) {
    assert.equal(unit.state, "completed");
    assert.ok(unit.outputName);
    const documentBuffer = await download(
      baseUrl,
      `/api/v1/spaces/${DEFAULT_SPACE_ID}/document-jobs/${personalJob.id}/outputs/${unit.id}`
    );
    assert.deepEqual(archiveEntries.get(unit.outputName), documentBuffer);
    const document = (await readOoxmlPackage(documentBuffer)).find(
      (entry) => entry.name === "word/document.xml"
    );
    assert.ok(document);
    const xml = document.content.toString("utf8");
    assert.match(xml, /Сотрудник: /u);
    assert.match(xml, /; проверено/u);
    assert.match(xml, /<w:rPr><w:b\/><\/w:rPr>/u);
    assert.match(
      xml,
      new RegExp(
        `Сотрудник ${String(unit.position + 1).padStart(2, "0")}`,
        "u"
      )
    );
    assert.doesNotMatch(xml, /____/u);
  }
  const personalFacts = generationFacts(personalJob.id);
  assert.deepEqual(
    {
      units: Number(personalFacts.units),
      completedUnits: Number(personalFacts.completed_units),
      uniqueOutputs: Number(personalFacts.unique_outputs),
      finishedEvents: Number(personalFacts.finished_events),
      attempts: Number(personalFacts.attempts)
    },
    {
      units: 10,
      completedUnits: 10,
      uniqueOutputs: 10,
      finishedEvents: 1,
      attempts: 2
    }
  );
  assert.deepEqual(unitFacts(firstUnitBeforeRestart.id), firstUnitBeforeRestart);

  await stopProcess(workerOne, "SIGKILL");
  const workerTwo = startProcess("worker-two", "apps/worker/dist/main.js", {
    ...commonEnv,
    DOCOMATOR_WORKER_ID: "release-gate-worker-two"
  });
  const repeatSnapshotResponse = await apiJson(
    baseUrl,
    `/api/v1/spaces/${DEFAULT_SPACE_ID}/audience-snapshots`,
    {
      method: "POST",
      body: JSON.stringify({ source: selected, targetMode: "aggregate" })
    }
  );
  const repeatPreflight = await apiJson(
    baseUrl,
    `/api/v1/spaces/${DEFAULT_SPACE_ID}/document-jobs/preflight`,
    {
      method: "POST",
      body: JSON.stringify({
        activeReleaseId: repeatRelease.id,
        snapshotId: repeatSnapshotResponse.data.snapshot.id
      })
    }
  );
  assert.equal(repeatPreflight.data.memberCount, 10);
  assert.equal(repeatPreflight.data.expectedCount, 1);
  assert.equal(repeatPreflight.data.canStart, true);
  const repeatJobResponse = await apiJson(
    baseUrl,
    `/api/v1/spaces/${DEFAULT_SPACE_ID}/document-jobs`,
    {
      method: "POST",
      body: JSON.stringify({
        activeReleaseId: repeatRelease.id,
        snapshotId: repeatSnapshotResponse.data.snapshot.id,
        idempotencyKey: "release-gate-repeat"
      })
    }
  );
  const repeatJob = await jobCompleted(baseUrl, repeatJobResponse.data.job.id);
  assert.equal(repeatJob.generatedCount, 1);
  assert.equal(repeatJob.failedCount, 0);
  const repeatDocument = await download(
    baseUrl,
    `/api/v1/spaces/${DEFAULT_SPACE_ID}/document-jobs/${repeatJob.id}/download`
  );
  const repeatXmlEntry = (await readOoxmlPackage(repeatDocument)).find(
    (entry) => entry.name === "word/document.xml"
  );
  assert.ok(repeatXmlEntry);
  const repeatXml = repeatXmlEntry.content.toString("utf8");
  assert.match(repeatXml, /Реестр сотрудников/u);
  assert.match(repeatXml, /Ответственный: отдел кадров/u);
  assert.equal((repeatXml.match(/<w:tr>/gu) ?? []).length, 11);
  assert.equal((repeatXml.match(/<w:cantSplit\/>/gu) ?? []).length, 10);
  assert.equal((repeatXml.match(/aifield:/gu) ?? []).length, 10);
  assert.equal((repeatXml.match(/airepeat:/gu) ?? []).length, 1);
  const repeatWordIds = [...repeatXml.matchAll(/<w:id\s+w:val="(\d+)"\/>/gu)].map(
    (match) => match[1]
  );
  assert.equal(repeatWordIds.length, 11);
  assert.equal(new Set(repeatWordIds).size, repeatWordIds.length);
  let previousPosition = -1;
  for (const [index] of members.entries()) {
    const name = `Сотрудник ${String(index + 1).padStart(2, "0")}`;
    const position = repeatXml.indexOf(name);
    assert.ok(position > previousPosition, `repeat order is wrong for ${name}`);
    assert.equal(repeatXml.split(name).length - 1, 1);
    previousPosition = position;
  }
  assert.doesNotMatch(repeatXml, /____|Участников:/u);
  assert.deepEqual(generationFacts(personalJob.id), personalFacts);
  assert.deepEqual(
    {
      units: Number(generationFacts(repeatJob.id).units),
      completedUnits: Number(generationFacts(repeatJob.id).completed_units),
      finishedEvents: Number(generationFacts(repeatJob.id).finished_events)
    },
    { units: 1, completedUnits: 1, finishedEvents: 1 }
  );

  const xlsxPreflight = await apiJson(
    baseUrl,
    `/api/v1/spaces/${DEFAULT_SPACE_ID}/document-jobs/preflight`,
    {
      method: "POST",
      body: JSON.stringify({
        activeReleaseId: xlsxRepeatRelease.id,
        snapshotId: repeatSnapshotResponse.data.snapshot.id
      })
    }
  );
  assert.equal(xlsxPreflight.data.format, "xlsx");
  assert.equal(xlsxPreflight.data.memberCount, 10);
  assert.equal(xlsxPreflight.data.expectedCount, 1);
  assert.equal(xlsxPreflight.data.canStart, true);
  const xlsxJobResponse = await apiJson(
    baseUrl,
    `/api/v1/spaces/${DEFAULT_SPACE_ID}/document-jobs`,
    {
      method: "POST",
      body: JSON.stringify({
        activeReleaseId: xlsxRepeatRelease.id,
        snapshotId: repeatSnapshotResponse.data.snapshot.id,
        idempotencyKey: "release-gate-xlsx-repeat"
      })
    }
  );
  const xlsxJob = await jobCompleted(baseUrl, xlsxJobResponse.data.job.id);
  assert.equal(xlsxJob.generatedCount, 1);
  assert.equal(xlsxJob.failedCount, 0);
  const xlsxDocument = await download(
    baseUrl,
    `/api/v1/spaces/${DEFAULT_SPACE_ID}/document-jobs/${xlsxJob.id}/download`
  );
  const xlsxEntries = await readOoxmlPackage(xlsxDocument);
  const worksheet = xlsxEntries.find(
    (entry) => entry.name === "xl/worksheets/sheet1.xml"
  );
  const workbook = xlsxEntries.find(
    (entry) => entry.name === "xl/workbook.xml"
  );
  assert.ok(worksheet);
  assert.ok(workbook);
  const worksheetXml = worksheet.content.toString("utf8");
  const workbookXml = workbook.content.toString("utf8");
  assert.equal((worksheetXml.match(/<row\b/gu) ?? []).length, 10);
  assert.equal((worksheetXml.match(/customHeight="1"/gu) ?? []).length, 10);
  assert.equal((worksheetXml.match(/<f>B\d+<\/f>/gu) ?? []).length, 10);
  assert.match(worksheetXml, /<dimension ref="B2:C11"\/>/u);
  assert.doesNotMatch(worksheetXml, /____/u);
  assert.doesNotMatch(workbookXml, /_DOCOMATOR_/u);
  const resultMetadata = verifyXlsxMetadata(xlsxEntries, {
    expectedRecords: [
      {
        kind: "field",
        identifier:
          xlsxRepeatRelease.manifest.fields[0].technicalBinding.identifier,
        part: xlsxRepeatRelease.manifest.fields[0].technicalBinding.part,
        target: xlsxRepeatRelease.manifest.fields[0].technicalBinding.target
      },
      {
        kind: "repeat",
        identifier:
          xlsxRepeatRelease.manifest.repeats[0].technicalBinding.identifier,
        part: xlsxRepeatRelease.manifest.repeats[0].technicalBinding.part,
        target: xlsxRepeatRelease.manifest.repeats[0].technicalBinding.target
      }
    ],
    exactExpectedRecords: true,
    definedNames: "absent"
  });
  assert.equal(resultMetadata.length, 2);
  let previousXlsxPosition = -1;
  for (const [index] of members.entries()) {
    const name = `Сотрудник ${String(index + 1).padStart(2, "0")}`;
    const position = worksheetXml.indexOf(name);
    assert.ok(position > previousXlsxPosition, `XLSX repeat order is wrong for ${name}`);
    assert.equal(worksheetXml.split(name).length - 1, 1);
    previousXlsxPosition = position;
  }
  assert.deepEqual(
    {
      units: Number(generationFacts(xlsxJob.id).units),
      completedUnits: Number(generationFacts(xlsxJob.id).completed_units),
      finishedEvents: Number(generationFacts(xlsxJob.id).finished_events)
    },
    { units: 1, completedUnits: 1, finishedEvents: 1 }
  );

  await stopProcess(workerTwo);
  await stopProcess(api);
  process.stdout.write(
    `Release gate passed: 10 personal DOCX + ZIP, repeat DOCX, repeat XLSX, recovered lease, worker restart.${keepArtifacts ? ` Artifacts: ${dataDir}` : ""}\n`
  );
}

try {
  await main();
} catch (error) {
  for (const processRecord of processes) {
    process.stderr.write(`\n[${processRecord.name}]\n${processRecord.output()}\n`);
  }
  throw error;
} finally {
  for (const processRecord of [...processes]) {
    await stopProcess(processRecord).catch(() => undefined);
  }
  if (!keepArtifacts) {
    const [resolvedDataDir, resolvedTemporaryRoot, sentinel] = await Promise.all([
      realpath(dataDir),
      realpath(os.tmpdir()),
      readFile(sentinelPath, "utf8")
    ]);
    const relative = path.relative(resolvedTemporaryRoot, resolvedDataDir);
    assert.ok(
      relative.length > 0 &&
        !relative.startsWith("..") &&
        !path.isAbsolute(relative) &&
        path.basename(resolvedDataDir).startsWith("docomator-release-gate-") &&
        sentinel === "docomator-release-gate-v1\n",
      "release-gate cleanup refused an unexpected path"
    );
    await fsPromises.rm(resolvedDataDir, { recursive: true, force: true });
  }
}
