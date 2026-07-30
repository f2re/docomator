import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";

import { parseAlignedXlsxImport } from "./aligned-xlsx-import.js";

function workbook(sheetXml: string, sharedStringsXml?: string): Buffer {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
    ),
    "_rels/.rels": strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    ),
    "xl/workbook.xml": strToU8(
      '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Лист1" sheetId="1" r:id="rId1"/></sheets></workbook>'
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'
    ),
    "xl/worksheets/sheet1.xml": strToU8(sheetXml)
  };
  if (sharedStringsXml) files["xl/sharedStrings.xml"] = strToU8(sharedStringsXml);
  return Buffer.from(zipSync(files, { level: 1 }));
}

test("XLSX cell references keep blank cells in the middle and at row end", () => {
  const shared =
    '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>ФИО</t></si><si><t>Телефон</t></si><si><t>Должность</t></si><si><t>Иванов Иван Иванович</t></si><si><t>Инженер</t></si><si><t>Петров Пётр Петрович</t></si><si><t>Аналитик</t></si></sst>';
  const sheet =
    '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>' +
    '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="C2" t="s"><v>4</v></c></row>' +
    '<row r="3"><c r="A3" t="s"><v>5</v></c><c r="B3"/><c r="C3" t="s"><v>6</v></c></row>' +
    '</sheetData></worksheet>';

  assert.deepEqual(parseAlignedXlsxImport(workbook(sheet, shared)), {
    headers: ["ФИО", "Телефон", "Должность"],
    rows: [
      {
        ФИО: "Иванов Иван Иванович",
        Телефон: "",
        Должность: "Инженер"
      },
      {
        ФИО: "Петров Пётр Петрович",
        Телефон: "",
        Должность: "Аналитик"
      }
    ]
  });
});

test("entirely blank physical rows do not move values between records", () => {
  const sheet =
    '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
    '<row r="1"><c r="A1" t="inlineStr"><is><t>Код</t></is></c><c r="B1" t="inlineStr"><is><t>Название</t></is></c><c r="C1" t="inlineStr"><is><t>Комментарий</t></is></c></row>' +
    '<row r="2"><c r="A2" t="inlineStr"><is><t>A-01</t></is></c><c r="B2" t="inlineStr"><is><t>Первая запись</t></is></c></row>' +
    '<row r="3"></row>' +
    '<row r="4"><c r="A4" t="inlineStr"><is><t>A-02</t></is></c><c r="C4" t="inlineStr"><is><t>Текст справа</t></is></c></row>' +
    '</sheetData></worksheet>';

  assert.deepEqual(parseAlignedXlsxImport(workbook(sheet)), {
    headers: ["Код", "Название", "Комментарий"],
    rows: [
      { Код: "A-01", Название: "Первая запись", Комментарий: "" },
      { Код: "A-02", Название: "", Комментарий: "Текст справа" }
    ]
  });
});

test("blank and duplicate headers receive stable positional names without shifting data", () => {
  const sheet =
    '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
    '<row r="1"><c r="A1" t="inlineStr"><is><t>Код</t></is></c><c r="C1" t="inlineStr"><is><t>Код</t></is></c></row>' +
    '<row r="2"><c r="A2"><v>1</v></c><c r="B2"><v>2</v></c><c r="C2"><v>3</v></c></row>' +
    '</sheetData></worksheet>';
  assert.deepEqual(parseAlignedXlsxImport(workbook(sheet)), {
    headers: ["Код", "Колонка 2", "Код (2)"],
    rows: [{ Код: "1", "Колонка 2": "2", "Код (2)": "3" }]
  });
});
