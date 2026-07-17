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

import {
  compileScalarField,
  TemplateCompilerError
} from "./compiler.js";
import { packageEntry, readOoxmlPackage } from "./ooxml-package.js";
import { readScalarValue, renderScalarValue } from "./scalar-render.js";

function docxFixture(): Buffer {
  return buildZipFixture(
    minimalDocxEntries().map((entry) =>
      entry.name === "word/document.xml"
        ? {
            ...entry,
            content:
              '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>ФИО получателя</w:t></w:r></w:p><w:p><w:r><w:t>Неизменяемый текст</w:t></w:r></w:p></w:body></w:document>'
          }
        : entry
    )
  );
}

function xlsxFixture(formula = false): Buffer {
  const cell = formula
    ? '<c r="B7"><f>1+1</f><v>2</v></c>'
    : '<c r="B7" s="2" t="inlineStr"><is><t>Исходное значение</t></is></c>';
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
      content: `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="7">${cell}</row></sheetData></worksheet>`
    }
  ];
  return buildZipFixture(entries);
}

async function compiledDocx() {
  const source = docxFixture();
  const structure = await analyzeOoxmlBuffer({
    buffer: source,
    fileName: "Письмо.docx",
    maxElements: 2_000
  });
  const element = structure.elements.find(
    (candidate): candidate is DocxParagraphElement =>
      candidate.kind === "paragraph" && candidate.text === "ФИО получателя"
  );
  assert.ok(element);
  const fieldBinding = {
    version: 1 as const,
    kind: "docx.paragraph" as const,
    elementId: element.id,
    part: element.part,
    index: element.index,
    tableLocation: element.tableLocation
  };
  const compiled = await compileScalarField({
    source,
    fileName: "Письмо.docx",
    expectedSourceSha256: structure.sourceSha256,
    expectedStructureSha256: structure.structureSha256,
    field: {
      id: "field-recipient-name",
      key: "recipient.full_name",
      label: "ФИО получателя",
      elementId: element.id,
      binding: fieldBinding
    }
  });
  return { source, structure, element, fieldBinding, compiled };
}

async function compiledDocxTextRange() {
  const source = buildZipFixture(
    minimalDocxEntries().map((entry) =>
      entry.name === "word/document.xml"
        ? {
            ...entry,
            content:
              '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Должность: </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>____</w:t></w:r><w:r><w:t xml:space="preserve"> / штатная</w:t></w:r></w:p></w:body></w:document>'
          }
        : entry
    )
  );
  const structure = await analyzeOoxmlBuffer({
    buffer: source,
    fileName: "Карточка.docx",
    maxElements: 2_000
  });
  const element = structure.elements.find(
    (candidate): candidate is DocxParagraphElement =>
      candidate.kind === "paragraph" && candidate.text.includes("Должность:")
  );
  assert.ok(element);
  const selectedText = "____";
  const startOffset = element.text.indexOf(selectedText);
  const fieldBinding = {
    version: 1 as const,
    kind: "docx.text-range" as const,
    elementId: element.id,
    part: element.part,
    index: element.index,
    startOffset,
    endOffset: startOffset + selectedText.length,
    selectedText,
    tableLocation: element.tableLocation
  };
  const compiled = await compileScalarField({
    source,
    fileName: "Карточка.docx",
    expectedSourceSha256: structure.sourceSha256,
    expectedStructureSha256: structure.structureSha256,
    field: {
      id: "field-position",
      key: "person.position",
      label: "Должность",
      elementId: element.id,
      binding: fieldBinding
    }
  });
  return { source, structure, element, fieldBinding, compiled };
}

async function compiledXlsx(formula = false) {
  const source = xlsxFixture(formula);
  const structure = await analyzeOoxmlBuffer({
    buffer: source,
    fileName: "Сотрудники.xlsx",
    maxElements: 2_000
  });
  const element = structure.elements.find(
    (candidate): candidate is XlsxCellElement =>
      candidate.kind === "cell" && candidate.address === "B7"
  );
  assert.ok(element);
  const fieldBinding = {
    version: 1 as const,
    kind: "xlsx.cell" as const,
    elementId: element.id,
    sheetName: element.sheetName,
    sheetPath: element.sheetPath,
    address: element.address
  };
  const compiled = await compileScalarField({
    source,
    fileName: "Сотрудники.xlsx",
    expectedSourceSha256: structure.sourceSha256,
    expectedStructureSha256: structure.structureSha256,
    field: {
      id: "field-recipient-name",
      key: "recipient.full_name",
      label: "ФИО получателя",
      elementId: element.id,
      binding: fieldBinding
    }
  });
  return { source, structure, element, fieldBinding, compiled };
}

test("DOCX trial render writes and reads back text while preserving other content", async () => {
  const input = await compiledDocx();
  const compiledSnapshot = Buffer.from(input.compiled.output);
  const result = await renderScalarValue({
    compiled: input.compiled.output,
    technicalBinding: input.compiled.technicalBinding,
    fieldBinding: input.fieldBinding,
    valueType: "string",
    value: "Иванов Иван Иванович"
  });

  assert.deepEqual(input.compiled.output, compiledSnapshot);
  assert.equal(result.renderedValue, "Иванов Иван Иванович");
  assert.equal(result.readBackValue, "Иванов Иван Иванович");
  assert.equal(result.verification.matched, true);
  assert.notEqual(result.outputSha256, result.inputSha256);

  const entries = await readOoxmlPackage(result.output);
  const xml = packageEntry(entries, "word/document.xml").content.toString("utf8");
  assert.match(xml, /<w:pPr><w:jc w:val="center"\/><\/w:pPr>/u);
  assert.match(xml, /<w:rPr><w:b\/><\/w:rPr>/u);
  assert.match(xml, /<w:t xml:space="preserve">Иванов Иван Иванович<\/w:t>/u);
  assert.match(xml, /<w:t>Неизменяемый текст<\/w:t>/u);

  const readBack = await readScalarValue({
    document: result.output,
    technicalBinding: input.compiled.technicalBinding,
    fieldBinding: input.fieldBinding,
    valueType: "string"
  });
  assert.equal(readBack.value, "Иванов Иван Иванович");
});

test("DOCX text-range render preserves the label and suffix", async () => {
  const input = await compiledDocxTextRange();
  const result = await renderScalarValue({
    compiled: input.compiled.output,
    technicalBinding: input.compiled.technicalBinding,
    fieldBinding: input.fieldBinding,
    valueType: "string",
    value: "Ведущий инженер"
  });

  assert.equal(result.readBackValue, "Ведущий инженер");
  const entries = await readOoxmlPackage(result.output);
  const xml = packageEntry(entries, "word/document.xml").content.toString("utf8");
  assert.match(xml, /Должность: /u);
  assert.match(xml, /<w:sdt>.*<w:r><w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">Ведущий инженер<\/w:t><\/w:r>.*<\/w:sdt>/u);
  assert.match(xml, / \/ штатная/u);
  assert.doesNotMatch(xml, /____/u);

  const readBack = await readScalarValue({
    document: result.output,
    technicalBinding: input.compiled.technicalBinding,
    fieldBinding: input.fieldBinding,
    valueType: "string"
  });
  assert.equal(readBack.value, "Ведущий инженер");
});

test("XLSX trial render supports text, numbers and booleans and preserves cell style", async () => {
  const input = await compiledXlsx();
  const text = await renderScalarValue({
    compiled: input.compiled.output,
    technicalBinding: input.compiled.technicalBinding,
    fieldBinding: input.fieldBinding,
    valueType: "string",
    value: "Петров Пётр"
  });
  assert.equal(text.readBackValue, "Петров Пётр");
  let entries = await readOoxmlPackage(text.output);
  let xml = packageEntry(entries, "xl/worksheets/sheet1.xml").content.toString("utf8");
  assert.match(xml, /<c r="B7" s="2" t="inlineStr">/u);

  const number = await renderScalarValue({
    compiled: input.compiled.output,
    technicalBinding: input.compiled.technicalBinding,
    fieldBinding: input.fieldBinding,
    valueType: "number",
    value: "12,5"
  });
  assert.equal(number.renderedValue, "12,5");
  assert.equal(number.readBackValue, "12,5");
  entries = await readOoxmlPackage(number.output);
  xml = packageEntry(entries, "xl/worksheets/sheet1.xml").content.toString("utf8");
  assert.match(xml, /<c r="B7" s="2"><v>12\.5<\/v><\/c>/u);

  const fixedNumber = await renderScalarValue({
    compiled: input.compiled.output,
    technicalBinding: input.compiled.technicalBinding,
    fieldBinding: input.fieldBinding,
    valueType: "number",
    value: "12,5",
    formatter: { version: 1, kind: "number.ru", fractionDigits: 2 }
  });
  assert.equal(fixedNumber.renderedValue, "12,50");
  assert.equal(fixedNumber.readBackValue, "12,50");
  entries = await readOoxmlPackage(fixedNumber.output);
  xml = packageEntry(entries, "xl/worksheets/sheet1.xml").content.toString("utf8");
  assert.match(xml, /<c r="B7" s="2"><v>12\.5<\/v><\/c>/u);

  const boolean = await renderScalarValue({
    compiled: input.compiled.output,
    technicalBinding: input.compiled.technicalBinding,
    fieldBinding: input.fieldBinding,
    valueType: "boolean",
    value: true
  });
  assert.equal(boolean.readBackValue, "Да");
});

test("trial render refuses to overwrite an XLSX formula", async () => {
  const input = await compiledXlsx(true);
  await assert.rejects(
    renderScalarValue({
      compiled: input.compiled.output,
      technicalBinding: input.compiled.technicalBinding,
      fieldBinding: input.fieldBinding,
      valueType: "number",
      value: 7
    }),
    (error: unknown) =>
      error instanceof TemplateCompilerError &&
      error.code === "formula_cell_not_supported" &&
      /формул/u.test(error.userMessage)
  );
});

test("trial render validates dates, integers and binding pairs", async () => {
  const input = await compiledDocx();
  await assert.rejects(
    renderScalarValue({
      compiled: input.compiled.output,
      technicalBinding: input.compiled.technicalBinding,
      fieldBinding: input.fieldBinding,
      valueType: "date",
      value: "2026-02-30"
    }),
    /несуществующая календарная дата/u
  );
  await assert.rejects(
    renderScalarValue({
      compiled: input.compiled.output,
      technicalBinding: input.compiled.technicalBinding,
      fieldBinding: input.fieldBinding,
      valueType: "integer",
      value: 1.5
    }),
    /целым числом/u
  );
  await assert.rejects(
    renderScalarValue({
      compiled: input.compiled.output,
      technicalBinding: { ...input.compiled.technicalBinding, kind: "xlsx.defined-name" },
      fieldBinding: input.fieldBinding,
      valueType: "string",
      value: "Иванов"
    }),
    (error: unknown) =>
      error instanceof TemplateCompilerError &&
      error.code === "technical_binding_mismatch"
  );
});

test("production fallback renders a missing optional value as an empty string", async () => {
  const input = await compiledDocx();
  const result = await renderScalarValue({
    compiled: input.compiled.output,
    technicalBinding: input.compiled.technicalBinding,
    fieldBinding: input.fieldBinding,
    valueType: "string",
    value: ""
  });
  assert.equal(result.renderedValue, "");
  assert.equal(result.readBackValue, "");
});
