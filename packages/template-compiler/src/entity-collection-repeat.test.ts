import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeOoxmlBuffer,
  type DocxParagraphElement
} from "@docomator/document-intake";
import {
  buildZipFixture,
  minimalDocxEntries
} from "@docomator/document-intake/testing";

import {
  compileEntityCollectionDocx,
  renderEntityCollectionDocxTrial
} from "./entity-collection-repeat.js";
import { packageEntry, readOoxmlPackage } from "./ooxml-package.js";
import { defaultScalarFormatter } from "./scalar-formatter.js";

function fixture(): Buffer {
  return buildZipFixture(
    minimalDocxEntries().map((entry) =>
      entry.name === "word/document.xml"
        ? {
            ...entry,
            content:
              '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Студент: ____</w:t></w:r></w:p><w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr><w:tr><w:tc><w:p><w:r><w:t>№</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Вопрос</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Срок</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Отчётность</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>____</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>____</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>____</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>____</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>Подпись после таблицы</w:t></w:r></w:p></w:body></w:document>'
          }
        : entry
    )
  );
}

function textRange(element: DocxParagraphElement) {
  const startOffset = element.text.indexOf("____");
  assert.notEqual(startOffset, -1);
  return {
    version: 1 as const,
    kind: "docx.text-range" as const,
    elementId: element.id,
    part: element.part,
    index: element.index,
    startOffset,
    endOffset: startOffset + 4,
    selectedText: "____",
    tableLocation: element.tableLocation
  };
}

async function definitions() {
  const source = fixture();
  const structure = await analyzeOoxmlBuffer({
    buffer: source,
    fileName: "План.docx",
    maxElements: 2_000
  });
  const paragraphs = structure.elements.filter(
    (element): element is DocxParagraphElement => element.kind === "paragraph"
  );
  const scalar = paragraphs.find((element) => element.text === "Студент: ____");
  const row = paragraphs.filter(
    (element) =>
      element.text === "____" &&
      element.tableLocation?.tableIndex === 0 &&
      element.tableLocation.rowIndex === 1
  );
  assert.ok(scalar);
  assert.equal(row.length, 4);
  const rowFields = [
    {
      id: "field-row-number",
      key: "system.row_number",
      label: "№",
      element: row[0]!
    },
    {
      id: "field-question",
      key: "collection.question",
      label: "Наименование вопроса",
      element: row[1]!
    },
    {
      id: "field-due-date",
      key: "collection.due_date",
      label: "Срок выполнения",
      element: row[2]!
    },
    {
      id: "field-reporting",
      key: "collection.reporting",
      label: "Отчётность",
      element: row[3]!
    }
  ].map((field) => ({
    id: field.id,
    key: field.key,
    label: field.label,
    elementId: field.element.id,
    binding: textRange(field.element)
  }));
  const fields = [
    {
      id: "field-student",
      key: "person.full_name",
      label: "ФИО студента",
      elementId: scalar.id,
      binding: textRange(scalar)
    },
    ...rowFields
  ];
  const anchor = row[0]!;
  assert.ok(anchor.tableLocation);
  return {
    source,
    structure,
    fields,
    repeat: {
      anchorElementId: anchor.id,
      part: anchor.part,
      tableIndex: anchor.tableLocation.tableIndex,
      rowIndex: anchor.tableLocation.rowIndex
    }
  };
}

test("entity collection DOCX keeps scalar owner fields outside one repeated row", async () => {
  const input = await definitions();
  const compiled = await compileEntityCollectionDocx({
    source: input.source,
    fileName: "План.docx",
    expectedSourceSha256: input.structure.sourceSha256,
    expectedStructureSha256: input.structure.structureSha256,
    fields: input.fields,
    repeat: input.repeat
  });

  assert.deepEqual(compiled.scalarFieldIds, ["field-student"]);
  assert.deepEqual(compiled.rowFieldIds, [
    "field-row-number",
    "field-question",
    "field-due-date",
    "field-reporting"
  ]);
  assert.equal(compiled.verification.repeatFieldCount, 4);

  const byId = new Map(compiled.fields.map((field) => [field.fieldId, field]));
  const trial = await renderEntityCollectionDocxTrial({
    compiled: compiled.output,
    repeat: compiled.repeat,
    fields: [
      {
        fieldId: "field-student",
        fieldKey: "person.full_name",
        required: true,
        technicalBinding: byId.get("field-student")!.technicalBinding,
        fieldBinding: input.fields[0]!.binding,
        valueType: "string",
        value: "Иванов Иван Иванович",
        formatter: defaultScalarFormatter("string")
      },
      {
        fieldId: "field-row-number",
        fieldKey: "system.row_number",
        required: true,
        technicalBinding: byId.get("field-row-number")!.technicalBinding,
        fieldBinding: input.fields[1]!.binding,
        valueType: "integer",
        value: 1,
        formatter: defaultScalarFormatter("integer")
      },
      {
        fieldId: "field-question",
        fieldKey: "collection.question",
        required: true,
        technicalBinding: byId.get("field-question")!.technicalBinding,
        fieldBinding: input.fields[2]!.binding,
        valueType: "text",
        value: "Подготовить обзор литературы",
        formatter: defaultScalarFormatter("text")
      },
      {
        fieldId: "field-due-date",
        fieldKey: "collection.due_date",
        required: false,
        technicalBinding: byId.get("field-due-date")!.technicalBinding,
        fieldBinding: input.fields[3]!.binding,
        valueType: "date",
        value: "2026-10-15",
        formatter: defaultScalarFormatter("date")
      },
      {
        fieldId: "field-reporting",
        fieldKey: "collection.reporting",
        required: false,
        technicalBinding: byId.get("field-reporting")!.technicalBinding,
        fieldBinding: input.fields[4]!.binding,
        valueType: "string",
        value: "Доклад",
        formatter: defaultScalarFormatter("string")
      }
    ]
  });

  assert.equal(trial.verification.matched, true);
  assert.equal(trial.verification.repeatCheckedValues, 4);
  const entries = await readOoxmlPackage(trial.output);
  const xml = packageEntry(entries, "word/document.xml").content.toString("utf8");
  assert.match(xml, /Студент: /u);
  assert.match(xml, /Иванов Иван Иванович/u);
  assert.match(xml, /Подготовить обзор литературы/u);
  assert.match(xml, /15\.10\.2026/u);
  assert.match(xml, /Доклад/u);
  assert.match(xml, /Подпись после таблицы/u);
});
