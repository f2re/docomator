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

import { compileScalarField, TemplateCompilerError } from "./compiler.js";
import {
  packageEntry,
  readOoxmlPackage,
  writeOoxmlPackage
} from "./ooxml-package.js";

function docxFixture(): Buffer {
  return buildZipFixture(
    minimalDocxEntries().map((entry) =>
      entry.name === "word/document.xml"
        ? {
            ...entry,
            content:
              '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>ФИО получателя</w:t></w:r></w:p><w:p><w:r><w:t>Неизменяемый текст</w:t></w:r></w:p></w:body></w:document>'
          }
        : entry
    )
  );
}

function docxTextRangeFixture(
  runs =
    '<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Должность: __</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>__</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve"> / штатная</w:t></w:r>'
): Buffer {
  return buildZipFixture(
    minimalDocxEntries().map((entry) =>
      entry.name === "word/document.xml"
        ? {
            ...entry,
            content: `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tr><w:tc><w:p>${runs}</w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>Неизменяемый текст</w:t></w:r></w:p></w:body></w:document>`
          }
        : entry
    )
  );
}

function xlsxFixture(sheetName = "Отдел 'А'"): Buffer {
  const entries: ZipFixtureEntry[] = [
    {
      name: "[Content_Types].xml",
      content:
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
    },
    {
      name: "_rels/.rels",
      content:
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    },
    {
      name: "xl/workbook.xml",
      content: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="1"/></workbook>`
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content:
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'
    },
    {
      name: "xl/worksheets/sheet1.xml",
      content:
        '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="7"><c r="B7" t="inlineStr"><is><t>Иванов Иван</t></is></c></row></sheetData></worksheet>'
    }
  ];
  return buildZipFixture(entries);
}

async function docxInput() {
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
  return {
    source,
    structure,
    element,
    field: {
      id: "field-recipient-name",
      key: "recipient.full_name",
      label: "ФИО получателя",
      elementId: element.id,
      binding: {
        version: 1,
        kind: "docx.paragraph",
        elementId: element.id,
        part: element.part,
        index: element.index,
        tableLocation: element.tableLocation
      }
    }
  } as const;
}

async function xlsxInput(sheetName = "Отдел 'А'") {
  const source = xlsxFixture(sheetName);
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
  return {
    source,
    structure,
    element,
    field: {
      id: "field-recipient-name",
      key: "recipient.full_name",
      label: "ФИО получателя",
      elementId: element.id,
      binding: {
        version: 1,
        kind: "xlsx.cell",
        elementId: element.id,
        sheetName: element.sheetName,
        sheetPath: element.sheetPath,
        address: element.address
      }
    }
  } as const;
}

async function docxTextRangeInput(runs?: string) {
  const source = docxTextRangeFixture(runs);
  const structure = await analyzeOoxmlBuffer({
    buffer: source,
    fileName: "Кадровая карточка.docx",
    maxElements: 2_000
  });
  const element = structure.elements.find(
    (candidate): candidate is DocxParagraphElement =>
      candidate.kind === "paragraph" && candidate.text.includes("Должность:")
  );
  assert.ok(element);
  const selectedText = "____";
  const startOffset = element.text.indexOf(selectedText);
  assert.notEqual(startOffset, -1);
  return {
    source,
    structure,
    element,
    field: {
      id: "field-position",
      key: "person.position",
      label: "Должность",
      elementId: element.id,
      binding: {
        version: 1,
        kind: "docx.text-range",
        elementId: element.id,
        part: element.part,
        index: element.index,
        startOffset,
        endOffset: startOffset + selectedText.length,
        selectedText,
        tableLocation: element.tableLocation
      }
    }
  } as const;
}

test("DOCX compiler creates w:sdt, preserves content and is deterministic", async () => {
  const input = await docxInput();
  const sourceSnapshot = Buffer.from(input.source);
  const first = await compileScalarField({
    source: input.source,
    fileName: "Письмо.docx",
    expectedSourceSha256: input.structure.sourceSha256,
    expectedStructureSha256: input.structure.structureSha256,
    field: input.field
  });
  const second = await compileScalarField({
    source: input.source,
    fileName: "Письмо.docx",
    expectedSourceSha256: input.structure.sourceSha256,
    expectedStructureSha256: input.structure.structureSha256,
    field: input.field
  });

  assert.deepEqual(input.source, sourceSnapshot);
  assert.deepEqual(first.output, second.output);
  assert.equal(first.outputSha256, second.outputSha256);
  assert.notEqual(first.outputSha256, first.sourceSha256);
  assert.equal(first.technicalBinding.kind, "docx.sdt");
  assert.equal(first.technicalBinding.identifier, "aifield:field-recipient-name");
  assert.equal(first.verification.found, true);

  const sourceEntries = await readOoxmlPackage(input.source);
  const outputEntries = await readOoxmlPackage(first.output);
  assert.deepEqual(
    packageEntry(outputEntries, "_rels/.rels").content,
    packageEntry(sourceEntries, "_rels/.rels").content
  );
  const documentXml = packageEntry(outputEntries, "word/document.xml").content.toString("utf8");
  assert.match(documentXml, /<w:sdt>/u);
  assert.match(documentXml, /w:tag w:val="aifield:field-recipient-name"/u);
  assert.match(documentXml, /w:alias w:val="ФИО получателя"/u);
  assert.match(documentXml, /<w:t>ФИО получателя<\/w:t>/u);
  assert.match(documentXml, /<w:t>Неизменяемый текст<\/w:t>/u);
});

test("DOCX text-range compiler wraps only selected adjacent runs", async () => {
  const input = await docxTextRangeInput();
  const first = await compileScalarField({
    source: input.source,
    fileName: "Кадровая карточка.docx",
    expectedSourceSha256: input.structure.sourceSha256,
    expectedStructureSha256: input.structure.structureSha256,
    field: input.field
  });
  const second = await compileScalarField({
    source: input.source,
    fileName: "Кадровая карточка.docx",
    expectedSourceSha256: input.structure.sourceSha256,
    expectedStructureSha256: input.structure.structureSha256,
    field: input.field
  });

  assert.deepEqual(first.output, second.output);
  assert.equal(first.technicalBinding.target, "абзац 1, знаки 12–15");
  const entries = await readOoxmlPackage(first.output);
  const xml = packageEntry(entries, "word/document.xml").content.toString("utf8");
  assert.match(xml, /<w:tbl><w:tr><w:tc><w:p>/u);
  assert.match(xml, /<w:t xml:space="preserve">Должность: <\/w:t>/u);
  assert.match(xml, /<w:sdt>.*aifield:field-position.*<w:sdtContent><w:r><w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">__<\/w:t><\/w:r><w:r><w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">__<\/w:t><\/w:r><\/w:sdtContent><\/w:sdt>/u);
  assert.match(xml, /<w:t xml:space="preserve"> \/ штатная<\/w:t>/u);
  assert.match(xml, /<w:t>Неизменяемый текст<\/w:t>/u);

  const singleRun = await docxTextRangeInput(
    '<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Должность: ____ / штатная</w:t></w:r>'
  );
  const singleRunResult = await compileScalarField({
    source: singleRun.source,
    fileName: "Кадровая карточка.docx",
    expectedSourceSha256: singleRun.structure.sourceSha256,
    expectedStructureSha256: singleRun.structure.structureSha256,
    field: singleRun.field
  });
  const singleRunXml = packageEntry(
    await readOoxmlPackage(singleRunResult.output),
    "word/document.xml"
  ).content.toString("utf8");
  assert.match(singleRunXml, /Должность: /u);
  assert.match(singleRunXml, / \/ штатная/u);
  assert.equal((singleRunXml.match(/<w:sdt>/gu) ?? []).length, 1);
});

test("DOCX text-range compiler rejects stale, mixed and complex selections", async () => {
  const input = await docxTextRangeInput();
  await assert.rejects(
    compileScalarField({
      source: input.source,
      fileName: "Кадровая карточка.docx",
      expectedSourceSha256: input.structure.sourceSha256,
      expectedStructureSha256: input.structure.structureSha256,
      field: {
        ...input.field,
        binding: { ...input.field.binding, selectedText: "----" }
      }
    }),
    (error: unknown) =>
      error instanceof TemplateCompilerError && error.code === "text_range_mismatch"
  );

  const mixed = await docxTextRangeInput(
    '<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Должность: __</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>__</w:t></w:r>'
  );
  await assert.rejects(
    compileScalarField({
      source: mixed.source,
      fileName: "Кадровая карточка.docx",
      expectedSourceSha256: mixed.structure.sourceSha256,
      expectedStructureSha256: mixed.structure.structureSha256,
      field: mixed.field
    }),
    (error: unknown) =>
      error instanceof TemplateCompilerError &&
      error.code === "mixed_text_range_formatting"
  );

  const complex = await docxTextRangeInput(
    '<w:r><w:t xml:space="preserve">Должность: </w:t></w:r><w:hyperlink w:anchor="target"><w:r><w:t>____</w:t></w:r></w:hyperlink>'
  );
  await assert.rejects(
    compileScalarField({
      source: complex.source,
      fileName: "Кадровая карточка.docx",
      expectedSourceSha256: complex.structure.sourceSha256,
      expectedStructureSha256: complex.structure.structureSha256,
      field: complex.field
    }),
    (error: unknown) =>
      error instanceof TemplateCompilerError &&
      error.code === "unsupported_text_range" &&
      /сложный объект/u.test(error.userMessage)
  );
});

test("XLSX compiler creates a defined name and preserves worksheet bytes", async () => {
  const input = await xlsxInput();
  const result = await compileScalarField({
    source: input.source,
    fileName: "Сотрудники.xlsx",
    expectedSourceSha256: input.structure.sourceSha256,
    expectedStructureSha256: input.structure.structureSha256,
    field: input.field
  });

  assert.equal(result.technicalBinding.kind, "xlsx.defined-name");
  assert.equal(result.technicalBinding.target, "'Отдел ''А'''!$B$7");
  assert.match(result.technicalBinding.identifier, /^_DOCOMATOR_[A-F0-9]{24}$/u);

  const sourceEntries = await readOoxmlPackage(input.source);
  const outputEntries = await readOoxmlPackage(result.output);
  assert.deepEqual(
    packageEntry(outputEntries, "xl/worksheets/sheet1.xml").content,
    packageEntry(sourceEntries, "xl/worksheets/sheet1.xml").content
  );
  const workbookXml = packageEntry(outputEntries, "xl/workbook.xml").content.toString("utf8");
  assert.match(workbookXml, /<definedNames><definedName name="_DOCOMATOR_[A-F0-9]{24}">/u);
  assert.match(workbookXml, /'Отдел ''А'''!\$B\$7<\/definedName>/u);
  assert.ok(workbookXml.indexOf("</sheets>") < workbookXml.indexOf("<definedNames>"));
  assert.ok(workbookXml.indexOf("</definedNames>") < workbookXml.indexOf("<calcPr"));
});

test("compiler rejects stale structure and invented coordinates", async () => {
  const input = await docxInput();
  await assert.rejects(
    compileScalarField({
      source: input.source,
      fileName: "Письмо.docx",
      expectedSourceSha256: input.structure.sourceSha256,
      expectedStructureSha256: "0".repeat(64),
      field: input.field
    }),
    (error: unknown) =>
      error instanceof TemplateCompilerError &&
      error.code === "structure_checksum_mismatch" &&
      /Структура исходника изменилась/u.test(error.userMessage)
  );

  await assert.rejects(
    compileScalarField({
      source: input.source,
      fileName: "Письмо.docx",
      expectedSourceSha256: input.structure.sourceSha256,
      expectedStructureSha256: input.structure.structureSha256,
      field: {
        ...input.field,
        binding: {
          ...input.field.binding,
          index: 99
        }
      }
    }),
    (error: unknown) =>
      error instanceof TemplateCompilerError &&
      error.code === "binding_coordinate_mismatch"
  );
});

test("OOXML reader and deterministic writer preserve ordered entry contents", async () => {
  const source = docxFixture();
  const entries = await readOoxmlPackage(source);
  const first = writeOoxmlPackage(entries);
  const second = writeOoxmlPackage(entries);
  assert.deepEqual(first, second);

  const reread = await readOoxmlPackage(first);
  assert.deepEqual(
    reread.map((entry) => [entry.name, entry.content.toString("hex")]),
    entries.map((entry) => [entry.name, entry.content.toString("hex")])
  );
});
