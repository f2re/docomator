import assert from "node:assert/strict";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { loadApiConfig } from "@docomator/config";
import {
  buildZipFixture,
  minimalDocxEntries,
  type ZipFixtureEntry
} from "@docomator/document-intake/testing";
import { DEFAULT_SPACE_ID } from "@docomator/storage";

import { buildApp } from "./app.js";

function applyMigrations(dataDir: string): void {
  const database = new DatabaseSync(path.join(dataDir, "docomator.db"));
  database.exec("PRAGMA foreign_keys = ON;");
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDirectory = path.resolve(currentDirectory, "../../../migrations");
  const migrations = fs
    .readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  for (const migration of migrations) {
    database.exec(fs.readFileSync(path.join(migrationsDirectory, migration), "utf8"));
  }
  database.close();
}

async function testApp() {
  const dataDir = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "docomator-template-draft-api-")
  );
  applyMigrations(dataDir);
  const app = buildApp(
    loadApiConfig({
      DOCOMATOR_DATA_DIR: dataDir,
      DOCOMATOR_LOG_LEVEL: "fatal"
    })
  );
  return { app, dataDir };
}

function sourceDocx(): Buffer {
  return buildZipFixture(
    minimalDocxEntries().map((entry) =>
      entry.name === "word/document.xml"
        ? {
            ...entry,
            content:
              '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>ФИО получателя</w:t></w:r></w:p><w:p><w:r><w:t>Должность</w:t></w:r></w:p><w:p><w:r><w:t>ФИО: ______</w:t></w:r></w:p></w:body></w:document>'
          }
        : entry
    )
  );
}

function repeatSourceDocx(): Buffer {
  return buildZipFixture(
    minimalDocxEntries().map((entry) =>
      entry.name === "word/document.xml"
        ? {
            ...entry,
            content:
              '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Список сотрудников</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>ФИО</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Должность</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>____</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>____</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'
          }
        : entry
    )
  );
}

function repeatSourceXlsx(): Buffer {
  const entries: ZipFixtureEntry[] = [
    {
      name: "[Content_Types].xml",
      content:
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
    },
    {
      name: "_rels/.rels",
      content:
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    },
    {
      name: "xl/workbook.xml",
      content:
        '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Сотрудники" sheetId="1" r:id="rId1"/></sheets></workbook>'
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content:
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'
    },
    {
      name: "xl/worksheets/sheet1.xml",
      content:
        '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="2"><c r="B2" t="inlineStr"><is><t>ФИО</t></is></c><c r="C2"><v>10</v></c><c r="D2"><f>C2*2</f><v>20</v></c></row></sheetData></worksheet>'
    }
  ];
  return buildZipFixture(entries);
}

async function quarantineSource(
  app: ReturnType<typeof buildApp>,
  buffer = sourceDocx()
) {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/document-sources/quarantine?fileName=${encodeURIComponent("Письмо.docx")}`,
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "x-actor-id": "editor-1",
      "x-correlation-id": "corr-source"
    },
    payload: buffer
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().data as { id: string; sha256: string };
}

async function quarantineXlsxSource(app: ReturnType<typeof buildApp>) {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/document-sources/quarantine?fileName=${encodeURIComponent("Сотрудники.xlsx")}`,
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    },
    payload: repeatSourceXlsx()
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().data as { id: string; sha256: string };
}

test("API creates a draft from quarantined bytes and saves a verified field", async () => {
  const { app, dataDir } = await testApp();
  try {
    const source = await quarantineSource(app);
    const draftResponse = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/document-sources/${source.id}/draft`,
      headers: {
        "content-type": "application/json",
        "x-actor-id": "editor-1",
        "x-correlation-id": "corr-draft-api"
      },
      payload: { title: "Официальное письмо" }
    });
    assert.equal(draftResponse.statusCode, 201, draftResponse.body);
    const draft = draftResponse.json().data as {
      id: string;
      title: string;
      sourceSha256: string;
      structureSha256: string;
      structure: {
        elements: Array<{ id: string; kind: string; text: string }>;
      };
      fields: unknown[];
    };
    assert.equal(draft.title, "Официальное письмо");
    assert.equal(draft.sourceSha256, source.sha256);
    assert.equal(draft.fields.length, 0);
    const paragraph = draft.structure.elements.find(
      (element) => element.kind === "paragraph" && element.text === "ФИО получателя"
    );
    assert.ok(paragraph);

    const fieldResponse = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${draft.id}/fields`,
      headers: {
        "content-type": "application/json",
        "x-actor-id": "editor-1",
        "x-correlation-id": "corr-field-api"
      },
      payload: {
        key: "recipient.full_name",
        label: "ФИО получателя",
        valueType: "string",
        required: true,
        elementId: paragraph.id
      }
    });
    assert.equal(fieldResponse.statusCode, 201, fieldResponse.body);
    const field = fieldResponse.json().data.field as {
      key: string;
      elementId: string;
      originalPreview: string;
      binding: { kind: string; part: string; index: number };
      formatter: { version: number; kind: string };
    };
    assert.equal(field.key, "recipient.full_name");
    assert.equal(field.elementId, paragraph.id);
    assert.equal(field.originalPreview, "ФИО получателя");
    assert.equal(field.binding.kind, "docx.paragraph");
    assert.equal(field.binding.part, "word/document.xml");
    assert.equal(field.binding.index, 0);
    assert.deepEqual(field.formatter, { version: 1, kind: "identity" });

    const getResponse = await app.inject({
      method: "GET",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${draft.id}`
    });
    assert.equal(getResponse.statusCode, 200, getResponse.body);
    assert.equal(getResponse.json().data.fields.length, 1);

    const database = new DatabaseSync(path.join(dataDir, "docomator.db"));
    const events = database
      .prepare(
        "SELECT event_type FROM domain_events WHERE event_type LIKE 'template.draft.%' ORDER BY event_type"
      )
      .all() as Array<{ event_type: string }>;
    database.close();
    assert.deepEqual(
      events.map((row) => row.event_type),
      ["template.draft.created", "template.draft.field.created"]
    );
  } finally {
    await app.close();
    await fsPromises.rm(dataDir, { recursive: true, force: true });
  }
});

test("API stores a verified DOCX text range without changing Document IR", async () => {
  const { app, dataDir } = await testApp();
  try {
    const source = await quarantineSource(app);
    const draftResponse = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/document-sources/${source.id}/draft`,
      headers: { "content-type": "application/json" },
      payload: {}
    });
    const draft = draftResponse.json().data as {
      id: string;
      structureSha256: string;
      structure: {
        elements: Array<{ id: string; kind: string; text: string }>;
      };
    };
    const paragraph = draft.structure.elements.find(
      (element) => element.kind === "paragraph" && element.text === "ФИО: ______"
    );
    assert.ok(paragraph);
    const startOffset = paragraph.text.indexOf("______");

    const fieldResponse = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${draft.id}/fields`,
      headers: { "content-type": "application/json" },
      payload: {
        key: "person.full_name",
        label: "ФИО",
        valueType: "string",
        required: true,
        elementId: paragraph.id,
        textRange: {
          startOffset,
          endOffset: startOffset + 6
        }
      }
    });
    assert.equal(fieldResponse.statusCode, 201, fieldResponse.body);
    const responseData = fieldResponse.json().data as {
      structureSha256: string;
      field: {
        originalPreview: string;
        binding: {
          kind: string;
          startOffset: number;
          endOffset: number;
          selectedText: string;
        };
      };
    };
    assert.equal(responseData.structureSha256, draft.structureSha256);
    assert.equal(responseData.field.originalPreview, "______");
    assert.deepEqual(responseData.field.binding, {
      version: 1,
      kind: "docx.text-range",
      elementId: paragraph.id,
      part: "word/document.xml",
      index: 2,
      startOffset,
      endOffset: startOffset + 6,
      selectedText: "______",
      tableLocation: null
    });

    const invalid = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${draft.id}/fields`,
      headers: { "content-type": "application/json" },
      payload: {
        key: "person.position",
        label: "Должность",
        valueType: "string",
        elementId: paragraph.id,
        textRange: { startOffset: 0, endOffset: 100 }
      }
    });
    assert.equal(invalid.statusCode, 400, invalid.body);
    assert.match(invalid.json().error.message, /границ.*текст/ui);
  } finally {
    await app.close();
    await fsPromises.rm(dataDir, { recursive: true, force: true });
  }
});

test("API derives and stores safe formatter contracts from field settings", async () => {
  const { app, dataDir } = await testApp();
  try {
    const source = await quarantineSource(app);
    const draftResponse = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/document-sources/${source.id}/draft`,
      headers: { "content-type": "application/json" },
      payload: {}
    });
    const draft = draftResponse.json().data as {
      id: string;
      structure: {
        elements: Array<{ id: string; kind: string; text: string }>;
      };
    };
    const first = draft.structure.elements.find(
      (element) => element.kind === "paragraph" && element.text === "ФИО получателя"
    );
    const second = draft.structure.elements.find(
      (element) => element.kind === "paragraph" && element.text === "Должность"
    );
    assert.ok(first);
    assert.ok(second);

    const numberResponse = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${draft.id}/fields`,
      headers: { "content-type": "application/json" },
      payload: {
        key: "person.rate",
        label: "Ставка",
        valueType: "number",
        decimalPlaces: 2,
        elementId: first.id
      }
    });
    assert.equal(numberResponse.statusCode, 201, numberResponse.body);
    assert.deepEqual(numberResponse.json().data.field.formatter, {
      version: 1,
      kind: "number.ru",
      fractionDigits: 2
    });

    const dateTimeResponse = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${draft.id}/fields`,
      headers: { "content-type": "application/json" },
      payload: {
        key: "person.approved_at",
        label: "Дата согласования",
        valueType: "date-time",
        timeZone: "Europe/Moscow",
        elementId: second.id
      }
    });
    assert.equal(dateTimeResponse.statusCode, 201, dateTimeResponse.body);
    assert.deepEqual(dateTimeResponse.json().data.field.formatter, {
      version: 1,
      kind: "date-time.ru",
      timeZone: "Europe/Moscow"
    });

    const invalid = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${draft.id}/fields`,
      headers: { "content-type": "application/json" },
      payload: {
        key: "person.position",
        label: "Должность",
        valueType: "string",
        decimalPlaces: 2,
        elementId: second.id
      }
    });
    assert.equal(invalid.statusCode, 400, invalid.body);
    assert.match(invalid.json().error.message, /знаков после запятой/ui);
  } finally {
    await app.close();
    await fsPromises.rm(dataDir, { recursive: true, force: true });
  }
});

test("API derives one DOCX repeat row and keeps every field inside it", async () => {
  const { app, dataDir } = await testApp();
  try {
    const source = await quarantineSource(app, repeatSourceDocx());
    const draftResponse = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/document-sources/${source.id}/draft`,
      headers: { "content-type": "application/json" },
      payload: { title: "Список сотрудников" }
    });
    const draft = draftResponse.json().data as {
      id: string;
      structure: {
        elements: Array<{
          id: string;
          kind: string;
          text: string;
          tableLocation: {
            tableIndex: number;
            rowIndex: number;
            columnIndex: number;
          } | null;
        }>;
      };
    };
    const rowFields = draft.structure.elements.filter(
      (element) =>
        element.kind === "paragraph" &&
        element.text === "____" &&
        element.tableLocation?.rowIndex === 1
    );
    assert.equal(rowFields.length, 2);
    const first = rowFields[0];
    assert.ok(first);
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${draft.id}/fields`,
      headers: { "content-type": "application/json" },
      payload: {
        key: "person.full_name",
        label: "ФИО",
        valueType: "string",
        required: true,
        elementId: first.id,
        textRange: { startOffset: 0, endOffset: 4 },
        repeatRow: true
      }
    });
    assert.equal(created.statusCode, 201, created.body);
    assert.deepEqual(created.json().data.repeatBinding, {
      version: 1,
      kind: "docx.repeat-row",
      source: "audience.members",
      anchorElementId: first.id,
      part: "word/document.xml",
      tableIndex: 0,
      rowIndex: 1
    });

    const outside = draft.structure.elements.find(
      (element) => element.text === "Список сотрудников"
    );
    assert.ok(outside);
    const rejected = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${draft.id}/fields`,
      headers: { "content-type": "application/json" },
      payload: {
        key: "document.title",
        label: "Заголовок",
        valueType: "string",
        elementId: outside.id
      }
    });
    assert.equal(rejected.statusCode, 400, rejected.body);
    assert.match(rejected.json().error.message, /внутри выбранной/ui);

    const refreshed = await app.inject({
      method: "GET",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${draft.id}`
    });
    assert.deepEqual(
      refreshed.json().data.repeatBinding,
      created.json().data.repeatBinding
    );
  } finally {
    await app.close();
    await fsPromises.rm(dataDir, { recursive: true, force: true });
  }
});

test("API derives a used XLSX row from server-side element identifiers", async () => {
  const { app, dataDir } = await testApp();
  try {
    const source = await quarantineXlsxSource(app);
    const draftResponse = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/document-sources/${source.id}/draft`,
      headers: { "content-type": "application/json" },
      payload: { title: "Сотрудники" }
    });
    assert.equal(draftResponse.statusCode, 201, draftResponse.body);
    const draft = draftResponse.json().data as {
      id: string;
      structure: {
        elements: Array<{
          id: string;
          kind: string;
          address: string;
          formula: string | null;
        }>;
      };
    };
    const byAddress = new Map(
      draft.structure.elements.map((element) => [element.address, element])
    );
    const name = byAddress.get("B2");
    const experience = byAddress.get("C2");
    const formula = byAddress.get("D2");
    assert.ok(name);
    assert.ok(experience);
    assert.ok(formula);

    const created = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${draft.id}/fields`,
      headers: { "content-type": "application/json" },
      payload: {
        key: "person.full_name",
        label: "ФИО",
        valueType: "string",
        required: true,
        elementId: name.id,
        repeatArea: { selection: "used-row" }
      }
    });
    assert.equal(created.statusCode, 201, created.body);
    assert.deepEqual(created.json().data.repeatBinding, {
      version: 1,
      kind: "xlsx.repeat-row",
      source: "audience.members",
      selection: "used-row",
      sheetName: "Сотрудники",
      sheetPath: "xl/worksheets/sheet1.xml",
      rowNumber: 2,
      startAddress: "B2",
      endAddress: "D2",
      startElementId: name.id,
      endElementId: formula.id
    });

    const second = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${draft.id}/fields`,
      headers: { "content-type": "application/json" },
      payload: {
        key: "person.experience_years",
        label: "Стаж",
        valueType: "integer",
        elementId: experience.id
      }
    });
    assert.equal(second.statusCode, 201, second.body);

    const rejectedFormula = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${draft.id}/fields`,
      headers: { "content-type": "application/json" },
      payload: {
        key: "person.total",
        label: "Итог",
        valueType: "number",
        elementId: formula.id
      }
    });
    assert.equal(rejectedFormula.statusCode, 400, rejectedFormula.body);
    assert.match(rejectedFormula.json().error.message, /формул/ui);
  } finally {
    await app.close();
    await fsPromises.rm(dataDir, { recursive: true, force: true });
  }
});

test("API rejects an element that is absent from the server structure", async () => {
  const { app, dataDir } = await testApp();
  try {
    const source = await quarantineSource(app);
    const draftResponse = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/document-sources/${source.id}/draft`,
      headers: { "content-type": "application/json" },
      payload: {}
    });
    const draftId = draftResponse.json().data.id as string;

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${draftId}/fields`,
      headers: { "content-type": "application/json" },
      payload: {
        key: "recipient.full_name",
        label: "ФИО получателя",
        valueType: "string",
        elementId: "paragraph-invented"
      }
    });
    assert.equal(response.statusCode, 400, response.body);
    assert.match(response.json().error.message, /элемент.*не найден/ui);
  } finally {
    await app.close();
    await fsPromises.rm(dataDir, { recursive: true, force: true });
  }
});

test("API hides a draft from another space and rejects a duplicate element", async () => {
  const { app, dataDir } = await testApp();
  try {
    const source = await quarantineSource(app);
    const draftResponse = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/document-sources/${source.id}/draft`,
      headers: { "content-type": "application/json" },
      payload: {}
    });
    const draft = draftResponse.json().data as {
      id: string;
      structure: { elements: Array<{ id: string }> };
    };
    const elementId = draft.structure.elements[0]?.id;
    assert.ok(elementId);

    const firstField = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${draft.id}/fields`,
      headers: { "content-type": "application/json" },
      payload: {
        key: "recipient.full_name",
        label: "ФИО получателя",
        valueType: "string",
        elementId
      }
    });
    assert.equal(firstField.statusCode, 201, firstField.body);

    const duplicate = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${draft.id}/fields`,
      headers: { "content-type": "application/json" },
      payload: {
        key: "recipient.position",
        label: "Должность",
        valueType: "string",
        elementId
      }
    });
    assert.equal(duplicate.statusCode, 409, duplicate.body);

    const spaceResponse = await app.inject({
      method: "POST",
      url: "/api/v1/spaces",
      headers: { "content-type": "application/json" },
      payload: { key: "other-draft", name: "Другое пространство" }
    });
    const otherSpaceId = spaceResponse.json().data.id as string;
    const hidden = await app.inject({
      method: "GET",
      url: `/api/v1/spaces/${otherSpaceId}/template-drafts/${draft.id}`
    });
    assert.equal(hidden.statusCode, 404, hidden.body);
  } finally {
    await app.close();
    await fsPromises.rm(dataDir, { recursive: true, force: true });
  }
});
