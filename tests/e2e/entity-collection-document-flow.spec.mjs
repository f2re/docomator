import { randomUUID } from "node:crypto";

import { analyzeOoxmlBuffer } from "@docomator/document-intake";
import { writeOoxmlPackage } from "@docomator/template-compiler";

import { expect, test } from "./fixtures/test.mjs";
import { ОформляторPage } from "./pages/docomator-page.mjs";

const realStackEnabled = process.env.DOCOMATOR_E2E_REAL_STACK === "1";

const headers = {
  accept: "application/json",
  "content-type": "application/json"
};

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function packageEntries(entries) {
  return entries.map((entry) => ({
    name: entry.name,
    content: Buffer.from(entry.content, "utf8"),
    isDirectory: false
  }));
}

function workPlanDocx() {
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Индивидуальный план работы студента</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">Руководитель: </w:t></w:r><w:r><w:t>____</w:t></w:r></w:p>
    <w:tbl>
      <w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="9200" w:type="dxa"/></w:tblPr>
      <w:tblGrid><w:gridCol w:w="700"/><w:gridCol w:w="4300"/><w:gridCol w:w="2000"/><w:gridCol w:w="2200"/></w:tblGrid>
      <w:tr>
        <w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>№</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Наименование вопроса</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Срок выполнения</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Отчётность</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>____</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>____</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>____</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>____</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
    <w:p><w:r><w:t>Подпись руководителя __________________</w:t></w:r></w:p>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="850"/></w:sectPr>
  </w:body>
</w:document>`;
  return writeOoxmlPackage(
    packageEntries([
      {
        name: "[Content_Types].xml",
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`
      },
      {
        name: "_rels/.rels",
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
      },
      { name: "word/document.xml", content: document },
      {
        name: "word/styles.xml",
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Обычный"/></w:style>
  <w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Сетка таблицы"/></w:style>
</w:styles>`
      },
      {
        name: "word/_rels/document.xml.rels",
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
      }
    ])
  );
}

async function workerReady(page) {
  await expect
    .poll(
      async () => {
        const response = await page.request.get("/api/v1/operations/readiness");
        if (!response.ok()) return `http-${response.status()}`;
        const payload = await response.json();
        return payload?.data?.checks?.find((item) => item.id === "worker")?.state;
      },
      { timeout: 30_000, message: "worker должен быть готов" }
    )
    .toBe("ok");
}

async function spaceId(page) {
  return page.evaluate(() =>
    String(globalThis.docomatorCurrentSpaceId || localStorage.getItem("docomator.space") || "")
  );
}

async function postJson(page, url, data) {
  const response = await page.request.post(url, { headers, data });
  expect(response.ok(), `${url}: ${await response.text()}`).toBe(true);
  return (await response.json()).data;
}

async function putJson(page, url, data) {
  const response = await page.request.put(url, { headers, data });
  expect(response.ok(), `${url}: ${await response.text()}`).toBe(true);
  return (await response.json()).data;
}

async function createStudent(page, selectedSpaceId, displayName, supervisorLabel, supervisorValue, propertyKey = null) {
  const profile = await postJson(page, `/api/v1/spaces/${encodeURIComponent(selectedSpaceId)}/employees`, {
    displayName,
    fields: [
      propertyKey
        ? { propertyKey, value: supervisorValue }
        : {
            definition: {
              label: supervisorLabel,
              valueType: "string",
              uiGroup: "student"
            },
            value: supervisorValue
          }
    ]
  });
  return { ...profile, entityId: profile.id };
}

async function collectionDefinition(page, selectedSpaceId, suffix) {
  return postJson(page, `/api/v1/spaces/${encodeURIComponent(selectedSpaceId)}/entity-collections`, {
    label: `Пункты плана ${suffix}`,
    ownerEntityTypeKey: "person",
    fields: [
      { label: "Наименование вопроса", valueType: "text", required: true },
      { label: "Срок выполнения", valueType: "date", required: true },
      { label: "Отчётность", valueType: "string", required: true }
    ]
  });
}

function fieldByLabel(definition, label) {
  const field = definition.fields.find((candidate) => candidate.label === label);
  expect(field, `поле коллекции «${label}» должно существовать`).toBeTruthy();
  return field;
}

function planRows(prefix, count) {
  return Array.from({ length: count }, (_value, index) => ({
    question: `${prefix} вопрос ${index + 1}`,
    due: `2026-${String(9 + Math.floor(index / 3)).padStart(2, "0")}-${String(10 + index).padStart(2, "0")}`,
    reporting: index % 2 === 0 ? "Доклад" : "Отчёт"
  }));
}

function collectionPayload(definition, rows) {
  const question = fieldByLabel(definition, "Наименование вопроса");
  const due = fieldByLabel(definition, "Срок выполнения");
  const reporting = fieldByLabel(definition, "Отчётность");
  return rows.map((row) => ({
    values: {
      [question.key]: row.question,
      [due.key]: row.due,
      [reporting.key]: row.reporting
    }
  }));
}

async function saveCollection(page, selectedSpaceId, entityId, definition, rows) {
  return putJson(
    page,
    `/api/v1/spaces/${encodeURIComponent(selectedSpaceId)}/entities/${encodeURIComponent(entityId)}/collections/${encodeURIComponent(definition.id)}/items`,
    { items: collectionPayload(definition, rows) }
  );
}

async function createGroup(page, selectedSpaceId, name, entityIds) {
  const group = await postJson(page, `/api/v1/spaces/${encodeURIComponent(selectedSpaceId)}/groups`, { name });
  await putJson(
    page,
    `/api/v1/spaces/${encodeURIComponent(selectedSpaceId)}/groups/${encodeURIComponent(group.id)}/members`,
    { entityIds }
  );
  return group;
}

async function quarantineAndDraft(page, selectedSpaceId, suffix) {
  const buffer = workPlanDocx();
  const quarantine = await page.request.post(
    `/api/v1/spaces/${encodeURIComponent(selectedSpaceId)}/document-sources/quarantine?fileName=${encodeURIComponent(`work-plan-${suffix}.docx`)}`,
    {
      headers: { accept: "application/json", "content-type": "application/octet-stream" },
      data: buffer
    }
  );
  expect(quarantine.status(), await quarantine.text()).toBe(201);
  const source = (await quarantine.json()).data;
  const draft = await postJson(
    page,
    `/api/v1/spaces/${encodeURIComponent(selectedSpaceId)}/document-sources/${encodeURIComponent(source.id)}/draft`,
    { title: `План работ ${suffix}` }
  );
  return draft;
}

function structureParagraphs(draft) {
  return (draft.structure?.elements || []).filter((element) => element.kind === "paragraph");
}

function placeholderRange(element) {
  const startOffset = element.text.indexOf("____");
  expect(startOffset).toBeGreaterThanOrEqual(0);
  return { startOffset, endOffset: startOffset + 4 };
}

async function saveDraftField(page, selectedSpaceId, draftId, field) {
  return postJson(
    page,
    `/api/v1/spaces/${encodeURIComponent(selectedSpaceId)}/template-drafts/${encodeURIComponent(draftId)}/fields`,
    field
  );
}

async function configureTemplate(page, selectedSpaceId, draft, supervisorKey, collection) {
  const paragraphs = structureParagraphs(draft);
  const supervisor = paragraphs.find((element) => element.text.includes("Руководитель: ____"));
  expect(supervisor).toBeTruthy();
  const row = paragraphs
    .filter(
      (element) =>
        element.text === "____" &&
        element.tableLocation?.tableIndex === 0 &&
        element.tableLocation?.rowIndex === 1
    )
    .sort(
      (left, right) =>
        left.tableLocation.columnIndex - right.tableLocation.columnIndex
    );
  expect(row).toHaveLength(4);
  const question = fieldByLabel(collection, "Наименование вопроса");
  const due = fieldByLabel(collection, "Срок выполнения");
  const reporting = fieldByLabel(collection, "Отчётность");

  const scalar = await saveDraftField(page, selectedSpaceId, draft.id, {
    key: supervisorKey,
    label: "Руководитель",
    valueType: "string",
    required: true,
    elementId: supervisor.id,
    textRange: placeholderRange(supervisor)
  });
  const numberField = await saveDraftField(page, selectedSpaceId, draft.id, {
    key: "system.row_number",
    label: "Номер строки",
    valueType: "integer",
    required: true,
    elementId: row[0].id,
    textRange: placeholderRange(row[0])
  });
  const questionField = await saveDraftField(page, selectedSpaceId, draft.id, {
    key: question.key,
    label: question.label,
    valueType: question.valueType,
    required: true,
    elementId: row[1].id,
    textRange: placeholderRange(row[1])
  });
  const dueField = await saveDraftField(page, selectedSpaceId, draft.id, {
    key: due.key,
    label: due.label,
    valueType: due.valueType,
    required: true,
    elementId: row[2].id,
    textRange: placeholderRange(row[2])
  });
  const reportingField = await saveDraftField(page, selectedSpaceId, draft.id, {
    key: reporting.key,
    label: reporting.label,
    valueType: reporting.valueType,
    required: true,
    elementId: row[3].id,
    textRange: placeholderRange(row[3])
  });
  const repeat = await putJson(
    page,
    `/api/v1/spaces/${encodeURIComponent(selectedSpaceId)}/template-drafts/${encodeURIComponent(draft.id)}/entity-collection-repeat`,
    {
      collectionId: collection.id,
      anchorElementId: row[0].id,
      numberingStart: 1,
      numberingStep: 1
    }
  );
  return {
    repeat,
    fields: {
      scalar: scalar.field,
      number: numberField.field,
      question: questionField.field,
      due: dueField.field,
      reporting: reportingField.field
    }
  };
}

async function trialAndActivate(page, selectedSpaceId, draft, fields, supervisorValue) {
  const trial = await postJson(
    page,
    `/api/v1/spaces/${encodeURIComponent(selectedSpaceId)}/template-drafts/${encodeURIComponent(draft.id)}/trial-all`,
    {
      values: [
        { fieldId: fields.scalar.id, value: supervisorValue },
        { fieldId: fields.question.id, value: "Пробный вопрос" },
        { fieldId: fields.due.id, value: "2026-09-01" },
        { fieldId: fields.reporting.id, value: "Пробный отчёт" }
      ]
    }
  );
  expect(trial.verification?.repeatSource?.kind).toBe("entity_collection");
  const active = await postJson(
    page,
    `/api/v1/spaces/${encodeURIComponent(selectedSpaceId)}/template-multi-test-versions/${encodeURIComponent(trial.version.id)}/activate`,
    {}
  );
  return active.active;
}

async function audienceSnapshot(page, selectedSpaceId, groupId) {
  return postJson(
    page,
    `/api/v1/spaces/${encodeURIComponent(selectedSpaceId)}/audience-snapshots`,
    {
      source: { kind: "group", groupId },
      targetMode: "one_per_member"
    }
  );
}

async function generate(page, selectedSpaceId, activeReleaseId, snapshotId, idempotencyKey) {
  const created = await postJson(page, `/api/v1/spaces/${encodeURIComponent(selectedSpaceId)}/document-jobs`, {
    activeReleaseId,
    snapshotId,
    idempotencyKey
  });
  const jobId = created.job.id;
  let payload = created;
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `/api/v1/spaces/${encodeURIComponent(selectedSpaceId)}/document-jobs/${encodeURIComponent(jobId)}`
        );
        expect(response.status()).toBe(200);
        payload = (await response.json()).data;
        return payload.job.state;
      },
      { timeout: 90_000, message: `формирование ${jobId} должно завершиться` }
    )
    .toMatch(/^(?:completed|partial|failed)$/u);
  return payload.job;
}

async function downloadUnit(page, selectedSpaceId, jobId, unit) {
  const response = await page.request.get(
    `/api/v1/spaces/${encodeURIComponent(selectedSpaceId)}/document-jobs/${encodeURIComponent(jobId)}/outputs/${encodeURIComponent(unit.id)}`
  );
  expect(response.status(), await response.text()).toBe(200);
  return Buffer.from(await response.body());
}

async function verifyPlan(buffer, fileName, expectedSupervisor, expectedRows) {
  const structure = await analyzeOoxmlBuffer({ buffer, fileName, maxElements: 2_000 });
  const text = structure.elements
    .map((element) => (element.kind === "cell" ? element.value : element.text || ""))
    .join("\n");
  expect(text).toContain(expectedSupervisor);
  for (const [index, row] of expectedRows.entries()) {
    expect(text).toContain(String(index + 1));
    expect(text).toContain(row.question);
    expect(text).toContain(row.reporting);
  }
  const tableRows = new Set(
    structure.elements
      .filter(
        (element) =>
          element.kind === "paragraph" &&
          element.tableLocation?.tableIndex === 0 &&
          element.tableLocation.rowIndex > 0
      )
      .map((element) => element.tableLocation.rowIndex)
  );
  expect(tableRows.size).toBe(expectedRows.length);
  return text;
}

test("студент → таблица плана → mixed DOCX → группа → разные 1..N строки", async ({ page }) => {
  test.skip(
    !realStackEnabled,
    "Сценарий запускается только с настоящими API, SQLite и worker."
  );
  test.setTimeout(240_000);

  const app = new ОформляторPage(page);
  await app.open();
  await workerReady(page);
  const selectedSpaceId = await spaceId(page);
  expect(selectedSpaceId).not.toBe("");
  const suffix = randomUUID().slice(0, 8);
  const supervisorLabel = `Руководитель ${suffix}`;
  const supervisorA = `доц. Руководитель А ${suffix}`;
  const supervisorB = `проф. Руководитель Б ${suffix}`;

  const studentA = await createStudent(
    page,
    selectedSpaceId,
    `Студент А ${suffix}`,
    supervisorLabel,
    supervisorA
  );
  const definitionsResponse = await page.request.get(
    `/api/v1/knowledge/property-definitions?spaceId=${encodeURIComponent(selectedSpaceId)}&limit=500`
  );
  expect(definitionsResponse.status()).toBe(200);
  const supervisorDefinition = (await definitionsResponse.json()).data.find(
    (definition) => definition.label === supervisorLabel
  );
  expect(supervisorDefinition).toBeTruthy();
  const studentB = await createStudent(
    page,
    selectedSpaceId,
    `Студент Б ${suffix}`,
    supervisorLabel,
    supervisorB,
    supervisorDefinition.key
  );

  const collection = await collectionDefinition(page, selectedSpaceId, suffix);
  const rowsA = planRows(`А-${suffix}`, 3);
  const rowsB = planRows(`Б-${suffix}`, 5);
  await saveCollection(page, selectedSpaceId, studentA.entityId, collection, rowsA);
  await saveCollection(page, selectedSpaceId, studentB.entityId, collection, rowsB);
  const group = await createGroup(
    page,
    selectedSpaceId,
    `Студенты с планом ${suffix}`,
    [studentA.entityId, studentB.entityId]
  );

  const draft = await quarantineAndDraft(page, selectedSpaceId, suffix);
  const configured = await configureTemplate(
    page,
    selectedSpaceId,
    draft,
    supervisorDefinition.key,
    collection
  );
  expect(configured.repeat.collectionDefinitionId).toBe(collection.id);
  expect(configured.repeat.numbering).toEqual({ start: 1, step: 1 });
  const active = await trialAndActivate(
    page,
    selectedSpaceId,
    draft,
    configured.fields,
    supervisorA
  );
  const snapshot = await audienceSnapshot(page, selectedSpaceId, group.id);
  const firstJob = await generate(
    page,
    selectedSpaceId,
    active.id,
    snapshot.snapshot.id,
    `collection-repeat-first-${suffix}`
  );
  expect(firstJob.state).toBe("completed");
  expect(firstJob.units).toHaveLength(2);

  const firstBuffers = new Map();
  for (const unit of firstJob.units) {
    const buffer = await downloadUnit(page, selectedSpaceId, firstJob.id, unit);
    firstBuffers.set(unit.primaryEntityId, buffer);
    if (unit.primaryEntityId === studentA.entityId) {
      await verifyPlan(buffer, unit.outputName, supervisorA, rowsA);
    } else if (unit.primaryEntityId === studentB.entityId) {
      await verifyPlan(buffer, unit.outputName, supervisorB, rowsB);
    } else {
      throw new Error(`Неизвестный участник результата: ${unit.primaryEntityId}`);
    }
  }

  const secondSpace = await postJson(page, "/api/v1/spaces", {
    name: `Чужое пространство ${suffix}`
  });
  const foreignList = await page.request.get(
    `/api/v1/spaces/${encodeURIComponent(secondSpace.id)}/entity-collections?ownerEntityTypeKey=person`
  );
  expect(foreignList.status()).toBe(200);
  expect((await foreignList.json()).data.some((item) => item.id === collection.id)).toBe(false);
  const foreignRead = await page.request.get(
    `/api/v1/spaces/${encodeURIComponent(secondSpace.id)}/entities/${encodeURIComponent(studentA.entityId)}/collections/${encodeURIComponent(collection.id)}`
  );
  expect(foreignRead.status()).toBe(404);

  const reorderedA = [...rowsA].reverse();
  await saveCollection(page, selectedSpaceId, studentA.entityId, collection, reorderedA);
  const secondJob = await generate(
    page,
    selectedSpaceId,
    active.id,
    snapshot.snapshot.id,
    `collection-repeat-reordered-${suffix}`
  );
  expect(secondJob.state).toBe("completed");
  const secondA = secondJob.units.find((unit) => unit.primaryEntityId === studentA.entityId);
  expect(secondA).toBeTruthy();
  const reorderedBuffer = await downloadUnit(page, selectedSpaceId, secondJob.id, secondA);
  const reorderedText = await verifyPlan(
    reorderedBuffer,
    secondA.outputName,
    supervisorA,
    reorderedA
  );
  expect(reorderedText.indexOf(reorderedA[0].question)).toBeLessThan(
    reorderedText.indexOf(reorderedA[1].question)
  );
  const originalText = (await analyzeOoxmlBuffer({
    buffer: firstBuffers.get(studentA.entityId),
    fileName: "first-a.docx",
    maxElements: 2_000
  })).elements.map((element) => element.text || element.value || "").join("\n");
  expect(originalText.indexOf(rowsA[0].question)).toBeLessThan(
    originalText.indexOf(rowsA[1].question)
  );

  await saveCollection(page, selectedSpaceId, studentB.entityId, collection, []);
  const emptyJob = await generate(
    page,
    selectedSpaceId,
    active.id,
    snapshot.snapshot.id,
    `collection-repeat-empty-${suffix}`
  );
  expect(emptyJob.state).toBe("partial");
  const failedB = emptyJob.units.find((unit) => unit.primaryEntityId === studentB.entityId);
  expect(failedB?.state).toBe("failed");
  expect(failedB?.error?.code).toBe("entity_collection_empty");
});
