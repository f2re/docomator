import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeOoxmlBuffer,
  type DocxParagraphElement,
  type XlsxCellElement
} from "@docomator/document-intake";
import {
  buildZipFixture,
  minimalDocxEntries,
  type ZipFixtureEntry
} from "@docomator/document-intake/testing";

import { TemplateCompilerError } from "./compiler.js";
import {
  compileScalarFields,
  renderScalarValues
} from "./multi-field.js";
import { packageEntry, readOoxmlPackage } from "./ooxml-package.js";

function docxFixture(): Buffer {
  return buildZipFixture(
    minimalDocxEntries().map((entry) =>
      entry.name === "word/document.xml"
        ? {
            ...entry,
            content:
              '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>ФИО получателя</w:t></w:r></w:p><w:p><w:r><w:t>Должность получателя</w:t></w:r></w:p><w:p><w:r><w:t>Неизменяемый текст</w:t></w:r></w:p></w:body></w:document>'
          }
        : entry
    )
  );
}

function xlsxFixture(): Buffer {
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
        '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="2"><c r="B2" s="1" t="inlineStr"><is><t>ФИО</t></is></c><c r="C2" s="2" t="inlineStr"><is><t>Стаж</t></is></c><c r="D2"><v>7</v></c></row></sheetData></worksheet>'
    }
  ];
  return buildZipFixture(entries);
}

async function docxDefinitions() {
  const source = docxFixture();
  const structure = await analyzeOoxmlBuffer({
    buffer: source,
    fileName: "Письмо.docx",
    maxElements: 2_000
  });
  const name = structure.elements.find(
    (element): element is DocxParagraphElement =>
      element.kind === "paragraph" && element.text === "ФИО получателя"
  );
  const position = structure.elements.find(
    (element): element is DocxParagraphElement =>
      element.kind === "paragraph" && element.text === "Должность получателя"
  );
  assert.ok(name);
  assert.ok(position);
  const fields = [
    {
      id: "field-position",
      key: "recipient.position",
      label: "Должность получателя",
      elementId: position.id,
      binding: {
        version: 1,
        kind: "docx.paragraph",
        elementId: position.id,
        part: position.part,
        index: position.index
      }
    },
    {
      id: "field-name",
      key: "recipient.full_name",
      label: "ФИО получателя",
      elementId: name.id,
      binding: {
        version: 1,
        kind: "docx.paragraph",
        elementId: name.id,
        part: name.part,
        index: name.index
      }
    }
  ] as const;
  return { source, structure, fields };
}

async function xlsxDefinitions() {
  const source = xlsxFixture();
  const structure = await analyzeOoxmlBuffer({
    buffer: source,
    fileName: "Сотрудники.xlsx",
    maxElements: 2_000
  });
  const name = structure.elements.find(
    (element): element is XlsxCellElement =>
      element.kind === "cell" && element.address === "B2"
  );
  const years = structure.elements.find(
    (element): element is XlsxCellElement =>
      element.kind === "cell" && element.address === "C2"
  );
  assert.ok(name);
  assert.ok(years);
  const fields = [
    {
      id: "field-years",
      key: "person.experience_years",
      label: "Стаж",
      elementId: years.id,
      binding: {
        version: 1,
        kind: "xlsx.cell",
        elementId: years.id,
        sheetName: years.sheetName,
        sheetPath: years.sheetPath,
        address: years.address
      }
    },
    {
      id: "field-name",
      key: "person.full_name",
      label: "ФИО",
      elementId: name.id,
      binding: {
        version: 1,
        kind: "xlsx.cell",
        elementId: name.id,
        sheetName: name.sheetName,
        sheetPath: name.sheetPath,
        address: name.address
      }
    }
  ] as const;
  return { source, structure, fields };
}

test("DOCX compilation is deterministic for multiple fields regardless of input order", async () => {
  const input = await docxDefinitions();
  const first = await compileScalarFields({
    source: input.source,
    fileName: "Письмо.docx",
    expectedSourceSha256: input.structure.sourceSha256,
    expectedStructureSha256: input.structure.structureSha256,
    fields: input.fields
  });
  const second = await compileScalarFields({
    source: input.source,
    fileName: "Письмо.docx",
    expectedSourceSha256: input.structure.sourceSha256,
    expectedStructureSha256: input.structure.structureSha256,
    fields: [...input.fields].reverse()
  });

  assert.equal(first.outputSha256, second.outputSha256);
  assert.deepEqual(first.output, second.output);
  assert.equal(first.fields.length, 2);
  assert.equal(first.verification.checkedFields, 2);
  assert.deepEqual(
    first.fields.map((field) => field.fieldKey),
    ["recipient.full_name", "recipient.position"]
  );

  const entries = await readOoxmlPackage(first.output);
  const xml = packageEntry(entries, "word/document.xml").content.toString("utf8");
  assert.match(xml, /aifield:field-name/u);
  assert.match(xml, /aifield:field-position/u);
  assert.match(xml, /Неизменяемый текст/u);
});

test("DOCX renders and finally reads back every field", async () => {
  const input = await docxDefinitions();
  const compiled = await compileScalarFields({
    source: input.source,
    fileName: "Письмо.docx",
    expectedSourceSha256: input.structure.sourceSha256,
    expectedStructureSha256: input.structure.structureSha256,
    fields: input.fields
  });
  const byId = new Map(compiled.fields.map((field) => [field.fieldId, field]));
  const rendered = await renderScalarValues({
    compiled: compiled.output,
    fields: input.fields.map((field) => ({
      fieldId: field.id,
      fieldKey: field.key,
      technicalBinding: byId.get(field.id)?.technicalBinding!,
      fieldBinding: field.binding,
      valueType: "string" as const,
      value:
        field.id === "field-name"
          ? "Иванов Иван Иванович"
          : "Ведущий инженер"
    }))
  });

  assert.equal(rendered.verification.checkedFields, 2);
  assert.deepEqual(
    rendered.fields.map((field) => [field.fieldKey, field.readBackValue]),
    [
      ["recipient.full_name", "Иванов Иван Иванович"],
      ["recipient.position", "Ведущий инженер"]
    ]
  );
  const entries = await readOoxmlPackage(rendered.output);
  const xml = packageEntry(entries, "word/document.xml").content.toString("utf8");
  assert.match(xml, /Иванов Иван Иванович/u);
  assert.match(xml, /Ведущий инженер/u);
  assert.match(xml, /Неизменяемый текст/u);
});

test("XLSX compiles and renders two typed cells without changing a neighbour", async () => {
  const input = await xlsxDefinitions();
  const compiled = await compileScalarFields({
    source: input.source,
    fileName: "Сотрудники.xlsx",
    expectedSourceSha256: input.structure.sourceSha256,
    expectedStructureSha256: input.structure.structureSha256,
    fields: input.fields
  });
  const byId = new Map(compiled.fields.map((field) => [field.fieldId, field]));
  const rendered = await renderScalarValues({
    compiled: compiled.output,
    fields: input.fields.map((field) => ({
      fieldId: field.id,
      fieldKey: field.key,
      technicalBinding: byId.get(field.id)?.technicalBinding!,
      fieldBinding: field.binding,
      valueType: field.id === "field-years" ? "integer" : "string",
      value: field.id === "field-years" ? 12 : "Петров Пётр"
    }))
  });

  assert.deepEqual(
    rendered.fields.map((field) => [field.fieldKey, field.readBackValue]),
    [
      ["person.experience_years", "12"],
      ["person.full_name", "Петров Пётр"]
    ]
  );
  const entries = await readOoxmlPackage(rendered.output);
  const workbook = packageEntry(entries, "xl/workbook.xml").content.toString("utf8");
  const sheet = packageEntry(entries, "xl/worksheets/sheet1.xml").content.toString("utf8");
  assert.equal((workbook.match(/<definedName\b/gu) ?? []).length, 2);
  assert.match(sheet, /<c r="B2" s="1" t="inlineStr">/u);
  assert.match(sheet, /Петров Пётр/u);
  assert.match(sheet, /<c r="C2" s="2"><v>12<\/v><\/c>/u);
  assert.match(sheet, /<c r="D2"><v>7<\/v><\/c>/u);
});

test("multi-field compiler rejects duplicate coordinates and stale element identifiers", async () => {
  const input = await docxDefinitions();
  await assert.rejects(
    compileScalarFields({
      source: input.source,
      fileName: "Письмо.docx",
      expectedSourceSha256: input.structure.sourceSha256,
      expectedStructureSha256: input.structure.structureSha256,
      fields: [
  input.fields[0],
  {
    ...input.fields[1],
    elementId: input.fields[0].elementId,
    binding: input.fields[0].binding
  }
]
    }),
    (error: unknown) =>
      error instanceof TemplateCompilerError &&
      error.code === "duplicate_field_coordinate"
  );

  await assert.rejects(
    compileScalarFields({
      source: input.source,
      fileName: "Письмо.docx",
      expectedSourceSha256: input.structure.sourceSha256,
      expectedStructureSha256: input.structure.structureSha256,
      fields: [{ ...input.fields[0], elementId: "paragraph-stale" }]
    }),
    (error: unknown) =>
      error instanceof TemplateCompilerError &&
      error.code === "binding_element_mismatch"
  );
});
