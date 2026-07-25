import assert from "node:assert/strict";
import test from "node:test";

import { writeOoxmlPackage, type OoxmlPackageEntry } from "@docomator/template-compiler";

import { parseXlsxImport } from "./xlsx-import-parser.js";

function part(name: string, content: string): OoxmlPackageEntry {
  return { name, content: Buffer.from(content, "utf8"), isDirectory: false };
}

test("XLSX import converts Excel dates and preserves zero-padded identifiers", async () => {
  const workbook = writeOoxmlPackage([
    part(
      "xl/workbook.xml",
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><workbookPr date1904="0"/></workbook>'
    ),
    part(
      "xl/styles.xml",
      `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <numFmts count="1"><numFmt numFmtId="164" formatCode="0000 000000"/></numFmts>
        <cellXfs count="3">
          <xf numFmtId="0"/>
          <xf numFmtId="14"/>
          <xf numFmtId="164"/>
        </cellXfs>
      </styleSheet>`
    ),
    part(
      "xl/worksheets/sheet1.xml",
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
        <row r="1">
          <c r="A1" t="inlineStr"><is><t>Дата рождения</t></is></c>
          <c r="B1" t="inlineStr"><is><t>Серия и номер паспорта</t></is></c>
        </row>
        <row r="2">
          <c r="A2" s="1"><v>45292</v></c>
          <c r="B2" s="2"><v>123456789</v></c>
        </row>
      </sheetData></worksheet>`
    )
  ]);

  assert.deepEqual(await parseXlsxImport(workbook), [
    ["Дата рождения", "Серия и номер паспорта"],
    ["2024-01-01", "0123 456789"]
  ]);
});

test("XLSX import respects the 1904 date system and cached date-time values", async () => {
  const workbook = writeOoxmlPackage([
    part(
      "xl/workbook.xml",
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><workbookPr date1904="true"/></workbook>'
    ),
    part(
      "xl/styles.xml",
      `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <numFmts count="1"><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm"/></numFmts>
        <cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="165"/></cellXfs>
      </styleSheet>`
    ),
    part(
      "xl/worksheets/sheet1.xml",
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
        <row r="1"><c r="A1" t="inlineStr"><is><t>Дата и время</t></is></c></row>
        <row r="2"><c r="A2" s="1"><v>0.5</v></c></row>
      </sheetData></worksheet>`
    )
  ]);

  assert.deepEqual(await parseXlsxImport(workbook), [
    ["Дата и время"],
    ["1904-01-01T12:00:00.000Z"]
  ]);
});
