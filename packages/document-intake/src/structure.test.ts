import assert from "node:assert/strict";
import test from "node:test";

import { analyzeOoxmlBuffer } from "./structure.js";
import {
  buildZipFixture,
  minimalDocxEntries,
  minimalXlsxEntries,
  type ZipFixtureEntry
} from "./zip-fixture.js";

function docxFixture(): Buffer {
  const entries = minimalDocxEntries().map((entry) =>
    entry.name === "word/document.xml"
      ? {
          ...entry,
          content: `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Обычный текст</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Иванов</w:t></w:r><w:r><w:t xml:space="preserve"> Иван</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
  </w:body>
</w:document>`
        }
      : entry
  );
  entries.push({
    name: "word/header1.xml",
    content:
      '<?xml version="1.0"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:i/><w:t>Верхний колонтитул</w:t></w:r></w:p></w:hdr>'
  });
  return buildZipFixture(entries);
}

function xlsxEntries(): ZipFixtureEntry[] {
  return [
    ...minimalXlsxEntries().map((entry) =>
      entry.name === "xl/workbook.xml"
        ? {
            ...entry,
            content:
              '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Сотрудники" sheetId="1" r:id="rId1"/></sheets></workbook>'
          }
        : entry
    ),
    {
      name: "xl/_rels/workbook.xml.rels",
      content:
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>'
    },
    {
      name: "xl/sharedStrings.xml",
      content:
        '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Иванов Иван</t></si></sst>'
    },
    {
      name: "xl/worksheets/sheet1.xml",
      content:
        '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>3</v></c><c r="C1"><f>B1*2</f><v>6</v></c></row></sheetData></worksheet>'
    }
  ];
}

test("DOCX structure contains stable paragraphs, runs and table coordinates", async () => {
  const buffer = docxFixture();
  const first = await analyzeOoxmlBuffer({ buffer, fileName: "Письмо.docx" });
  const second = await analyzeOoxmlBuffer({ buffer, fileName: "Письмо.docx" });

  assert.equal(first.format, "docx");
  assert.equal(first.summary.paragraphs, 3);
  assert.equal(first.summary.runs, 4);
  assert.equal(first.truncated, false);
  assert.deepEqual(
    first.elements.map((element) => element.id),
    second.elements.map((element) => element.id)
  );

  const tableParagraph = first.elements.find(
    (element) => element.kind === "paragraph" && element.text === "Иванов Иван"
  );
  assert.ok(tableParagraph);
  assert.equal(tableParagraph.kind, "paragraph");
  assert.deepEqual(tableParagraph.tableLocation, {
    tableIndex: 0,
    rowIndex: 0,
    columnIndex: 0
  });
  assert.equal(tableParagraph.runs[0]?.bold, true);
  assert.equal(tableParagraph.runs[1]?.text, " Иван");

  const header = first.elements.find(
    (element) => element.kind === "paragraph" && element.part === "word/header1.xml"
  );
  assert.ok(header);
  assert.equal(header.kind, "paragraph");
  assert.equal(header.runs[0]?.italic, true);
});

test("XLSX structure resolves shared strings, values and formulas", async () => {
  const buffer = buildZipFixture(xlsxEntries());
  const report = await analyzeOoxmlBuffer({ buffer, fileName: "Список.xlsx" });

  assert.equal(report.format, "xlsx");
  assert.equal(report.summary.sheets, 1);
  assert.equal(report.summary.cells, 3);
  assert.equal(report.summary.formulas, 1);
  const cells = report.elements.filter((element) => element.kind === "cell");
  assert.deepEqual(
    cells.map((cell) => [cell.address, cell.value, cell.valueKind]),
    [
      ["A1", "Иванов Иван", "text"],
      ["B1", "3", "number"],
      ["C1", "6", "formula"]
    ]
  );
  assert.equal(cells[2]?.formula, "B1*2");
});

test("structure response is truncated without losing total counters", async () => {
  const buffer = buildZipFixture(xlsxEntries());
  const report = await analyzeOoxmlBuffer({
    buffer,
    fileName: "Список.xlsx",
    maxElements: 2
  });
  assert.equal(report.elements.length, 2);
  assert.equal(report.summary.totalElements, 3);
  assert.equal(report.summary.shownElements, 2);
  assert.equal(report.truncated, true);
});

test("unsafe XML declarations are rejected before structural parsing", async () => {
  const entries = minimalDocxEntries().map((entry) =>
    entry.name === "word/document.xml"
      ? {
          ...entry,
          content:
            '<!DOCTYPE w:document [<!ENTITY hidden "опасно">]><w:document xmlns:w="urn:test"><w:body><w:p><w:r><w:t>&hidden;</w:t></w:r></w:p></w:body></w:document>'
        }
      : entry
  );
  await assert.rejects(
    analyzeOoxmlBuffer({
      buffer: buildZipFixture(entries),
      fileName: "Опасный.docx"
    }),
    /запрещённое объявление XML/u
  );
});
