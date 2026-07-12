import assert from "node:assert/strict";
import test from "node:test";

import { DocumentIntakeError } from "./intake.js";
import { analyzeOoxmlBuffer } from "./document-ir.js";
import {
  buildZipFixture,
  minimalDocxEntries,
  minimalXlsxEntries,
  type ZipFixtureEntry
} from "./zip-fixture.js";

function replaceEntry(
  entries: readonly ZipFixtureEntry[],
  name: string,
  content: string
): ZipFixtureEntry[] {
  return entries.map((entry) =>
    entry.name === name ? { ...entry, content } : { ...entry }
  );
}

function structuredDocx(): Buffer {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Вводный текст</w:t></w:r></w:p>
    <w:tbl>
      <w:tr><w:tc>
        <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Иванов &amp; Петров</w:t></w:r></w:p>
      </w:tc></w:tr>
    </w:tbl>
  </w:body>
</w:document>`;
  return buildZipFixture(replaceEntry(minimalDocxEntries(), "word/document.xml", xml));
}

function structuredXlsx(): Buffer {
  const workbook = `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
 <sheets><sheet name="Сотрудники" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
  const workbookRelationships = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;
  const sharedStrings = `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
 <si><t>Иванов Иван</t></si>
</sst>`;
  const worksheet = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
 <sheetData><row r="1">
  <c r="A1" t="s"><v>0</v></c>
  <c r="B1"><f>1+2</f><v>3</v></c>
  <c r="C1" t="inlineStr"><is><t>Отдел</t></is></c>
 </row></sheetData>
</worksheet>`;
  return buildZipFixture([
    ...replaceEntry(minimalXlsxEntries(), "xl/workbook.xml", workbook),
    { name: "xl/_rels/workbook.xml.rels", content: workbookRelationships },
    { name: "xl/sharedStrings.xml", content: sharedStrings },
    { name: "xl/worksheets/sheet1.xml", content: worksheet }
  ]);
}

test("DOCX analysis returns stable paragraphs, runs and table coordinates", async () => {
  const buffer = structuredDocx();
  const first = await analyzeOoxmlBuffer({ buffer, fileName: "Письмо.docx" });
  const second = await analyzeOoxmlBuffer({ buffer, fileName: "Письмо.docx" });

  assert.equal(first.structure.format, "docx");
  assert.equal(first.structure.totals.paragraphs, 2);
  assert.equal(first.structure.totals.runs, 2);
  assert.equal(first.structure.truncated, false);
  const paragraphs = first.structure.docx?.parts[0]?.paragraphs;
  assert.equal(paragraphs?.length, 2);
  assert.equal(paragraphs?.[0]?.text, "Вводный текст");
  assert.equal(paragraphs?.[1]?.text, "Иванов & Петров");
  assert.deepEqual(paragraphs?.[1]?.tableLocation, {
    tableIndex: 0,
    rowIndex: 0,
    columnIndex: 0
  });
  assert.equal(paragraphs?.[1]?.runs[0]?.bold, true);
  assert.deepEqual(
    first.structure.docx?.parts[0]?.paragraphs.map((item) => item.id),
    second.structure.docx?.parts[0]?.paragraphs.map((item) => item.id)
  );
});

test("XLSX analysis resolves shared strings, formulas and inline text", async () => {
  const result = await analyzeOoxmlBuffer({
    buffer: structuredXlsx(),
    fileName: "Сотрудники.xlsx"
  });

  assert.equal(result.structure.format, "xlsx");
  assert.equal(result.structure.totals.sheets, 1);
  assert.equal(result.structure.totals.cells, 3);
  const sheet = result.structure.xlsx?.sheets[0];
  assert.equal(sheet?.name, "Сотрудники");
  assert.deepEqual(
    sheet?.cells.map((cell) => [cell.address, cell.value, cell.valueKind]),
    [
      ["A1", "Иванов Иван", "text"],
      ["B1", "3", "formula"],
      ["C1", "Отдел", "text"]
    ]
  );
  assert.equal(sheet?.cells[1]?.formula, "1+2");
});

test("analysis limits returned elements and reports truncation", async () => {
  const result = await analyzeOoxmlBuffer({
    buffer: structuredXlsx(),
    fileName: "Сотрудники.xlsx",
    maxElements: 1
  });

  assert.equal(result.structure.totals.cells, 3);
  assert.equal(result.structure.totals.returnedElements, 1);
  assert.equal(result.structure.truncated, true);
  assert.equal(result.structure.xlsx?.sheets[0]?.cells.length, 1);
});

test("analysis rejects XML declarations that can define entities", async () => {
  const unsafeXml = `<?xml version="1.0"?><!DOCTYPE w:document [<!ENTITY hidden "text">]>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>`;
  const buffer = buildZipFixture(
    replaceEntry(minimalDocxEntries(), "word/document.xml", unsafeXml)
  );

  await assert.rejects(
    analyzeOoxmlBuffer({ buffer, fileName: "Небезопасный.docx" }),
    (error: unknown) =>
      error instanceof DocumentIntakeError && error.code === "unsafe_xml_declaration"
  );
});
